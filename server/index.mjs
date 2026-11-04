#!/usr/bin/env node
// server/index.mjs — ghostfleet web: the fleet, for a small team, from a browser.
//
// THIS ENDPOINT IS REMOTE CODE EXECUTION BY DESIGN, exactly like fleet-serve: a send injects
// a prompt into an agent that runs commands, a spawn creates checkouts. So it binds to
// loopback (or a tailnet address) and nothing else, every request is a logged-in person,
// every write is in the activity log with that person's name, and the destructive verbs
// need an explicit confirmation. Zero dependencies, node builtins only.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ATTACH_MAX_BYTES } from './attach.mjs';
import { createEngine, askAI } from './automations.mjs';
import { describeTrigger } from '../shared/automations.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const MODE = argv.includes('--demo') || process.env.GFW_MODE === 'demo' ? 'demo' : 'real';
const PORT = Number(flag('port', process.env.GFW_PORT || 8790));
const BIND = flag('bind', process.env.GFW_BIND || '127.0.0.1');
const DIST = path.join(ROOT, 'web', 'dist');
const DATA = path.join(process.env.GFW_DATA || path.join(os.homedir(), '.config', 'ghostfleet-web'), MODE);
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });

// ── bind: loopback or the tailnet, never a LAN or the internet ──────────────────────────
function bindable(addr) {
  if (addr === 'localhost' || addr === '::1' || /^127\./.test(addr)) return true;
  const m = /^100\.(\d+)\./.exec(addr);
  if (m && Number(m[1]) >= 64 && Number(m[1]) <= 127) return true;   // 100.64.0.0/10
  return /^fd7a:115c:a1e0:/i.test(addr);
}
if (!bindable(BIND)) {
  console.error(`ghostfleet-web: me niego a escuchar en '${BIND}'. Solo loopback (127.0.0.1) o una IP de Tailscale (100.64.0.0/10):\nquien llegue a este puerto puede ejecutar código en esta máquina.`);
  process.exit(2);
}

// ── Host: binding to loopback is not enough ─────────────────────────────────────────────
// A page on evil.example can point its own name at 127.0.0.1 (DNS rebinding) and then talk
// to this port as same-origin: X-GFW and SameSite do not help, because to the browser it IS
// that origin. What it cannot fake is the Host it sends, so only the names this server is
// reached by are answered. The port is not compared: `pnpm dev` arrives through vite's proxy
// with vite's port, and a rebinding page differs in the NAME. GFW_HOSTS adds more names
// (a MagicDNS name, comma-separated).
const hostName = (h) => String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
const HOSTS = new Set(['127.0.0.1', 'localhost', '::1', hostName(BIND),
  ...String(process.env.GFW_HOSTS || '').split(',').map(hostName).filter(Boolean)]);

const fleet = MODE === 'demo' ? await import('./demo.mjs') : await import('./fleet.mjs');
const voice = await import('./voice.mjs');

// ── small persistence helpers ───────────────────────────────────────────────────────────
const now = () => Math.floor(Date.now() / 1000);
const file = (n) => path.join(DATA, n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const writeJson = (n, v) => { const f = file(n), tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(tmp, f); };
const appendLine = (n, row) => fs.appendFileSync(file(n), JSON.stringify(row) + '\n', { mode: 0o600 });
function readLines(n, limit) {
  let lines = [];
  try { lines = fs.readFileSync(file(n), 'utf8').trim().split('\n').filter(Boolean); } catch {}
  return lines.slice(-limit).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── people ──────────────────────────────────────────────────────────────────────────────
const COLORS = ['cyan', 'yellow', 'green', 'magenta', 'blue', 'red'];
let users = readJson('users.json', { users: [] }).users;
const saveUsers = () => writeJson('users.json', { users });
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') });
const pwOk = (u, pw) => {
  const h = Buffer.from(crypto.scryptSync(String(pw), u.salt, 64).toString('hex'));
  const ref = Buffer.from(u.hash);
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
};
const publicUser = (u) => u && ({ id: u.id, name: u.name, color: u.color });
// Until the first accounts exist, /api/setup is the one write anyone can make, and whoever
// makes it owns the fleet. So it takes a code that only the terminal running this shows:
// reaching the port (the tailnet, another local user) is not enough to claim it.
let setupCode = users.length ? null : crypto.randomBytes(9).toString('base64url');
const codeOk = (c) => {
  const a = Buffer.from(String(c || '')), b = Buffer.from(setupCode || '');
  return !!setupCode && a.length === b.length && crypto.timingSafeEqual(a, b);
};
function addUser(name, password) {
  const id = slug(name);
  if (!id) throw httpErr(400, 'el nombre no puede estar vacío');
  if (String(password || '').length < 6) throw httpErr(400, 'la contraseña necesita al menos 6 caracteres');
  if (users.some(u => u.id === id)) throw httpErr(409, `ya existe ${name}`);
  const u = { id, name: String(name).trim(), color: COLORS[users.length % COLORS.length], ...hashPw(password) };
  users.push(u); saveUsers();
  return u;
}

// ── login sessions: a cookie, stored only as its hash, idle-expiring ─────────────────────
const IDLE = 12 * 3600;
let logins = readJson('logins.json', {});
let loginsDirty = false;
setInterval(() => { if (loginsDirty) { loginsDirty = false; writeJson('logins.json', logins); } }, 5000).unref();
function mintLogin(user) {
  const tok = crypto.randomBytes(32).toString('base64url');
  logins[sha256(tok)] = { user: user.id, exp: now() + IDLE };
  writeJson('logins.json', logins);
  return tok;
}
function whoIs(req) {
  const m = /(?:^|;\s*)gfw=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const k = sha256(m[1]), s = logins[k];
  if (!s || s.exp <= now()) { if (s) { delete logins[k]; loginsDirty = true; } return null; }
  const u = users.find(x => x.id === s.user);
  if (!u) return null;
  s.exp = now() + IDLE; loginsDirty = true;
  return { user: u, key: k };
}
const cookie = (tok, maxAge) => `gfw=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

// ── who works on what, who is looking at what, and what everyone did ─────────────────────
let state = readJson('state.json', { owners: {} });
const saveState = () => writeJson('state.json', state);
const key = (p, s) => `${p}/${s}`;
const presence = new Map();       // key -> Map(userId -> {at, typing})
function seen(p, s, userId, typing) {
  const k = key(p, s);
  if (!presence.has(k)) presence.set(k, new Map());
  presence.get(k).set(userId, { at: Date.now(), typing: !!typing });
}
function here(p, s) {
  const m = presence.get(key(p, s));
  if (!m) return [];
  const out = [];
  for (const [id, v] of m) if (Date.now() - v.at < 12000) out.push({ user: id, typing: v.typing && Date.now() - v.at < 6000 });
  return out;
}
// The demo opens with the work already split between the people, which is the point it shows.
function seedDemoOwners() {
  const [a, b] = [users[0]?.id, users[1]?.id || users[0]?.id];
  state.owners = {
    'practiq-saas/master': a, 'practiq-saas/onboarding-clinicas': a, 'practiq-saas/stripe-billing': b,
    'practiq-saas/dashboard-ingresos': b, 'vault-invers/kpi-belgrano': a,
  };
  saveState();
}
const audit = (row) => appendLine('activity.jsonl', { ts: now(), ...row });
const activity = (limit = 200) => readLines('activity.jsonl', limit);

// ── the verbs, by MCP tool name — the allowlist IS the enforcement ───────────────────────
const TOOLS = {
  fleet_send:            { fields: ['project', 'session', 'prompt', 'anyway'] },
  fleet_answer:          { fields: ['project', 'session', 'text', 'no_enter', 'expect'] },
  fleet_interrupt:       { fields: ['project', 'session'] },
  fleet_pause:           { fields: ['project', 'session'] },
  fleet_resume:          { fields: ['project', 'session', 'prompt'] },
  fleet_wake:            { fields: ['project', 'session'] },
  fleet_reopen:          { fields: ['project', 'session'] },
  fleet_unqueue:         { fields: ['project', 'session', 'prompt'] },
  fleet_spawn:           { fields: ['project', 'name', 'branch', 'from', 'prompt', 'model', 'reuse', 'force_new'] },
  fleet_rename:          { fields: ['project', 'session', 'new_name'], confirm: true },
  fleet_stop:            { fields: ['project', 'session', 'reclaim', 'force'], confirm: true },
  fleet_worktree_remove: { fields: ['project', 'path', 'force'], confirm: true },
  // ghostfleet-web's own, until ghostfleet has a command that owns these markers.
  gfw_label:             { fields: ['project', 'session', 'text'], local: true },
  gfw_schedule:          { fields: ['project', 'session', 'at', 'msg'], local: true },
  gfw_unschedule:        { fields: ['project', 'session'], local: true },
};
const BOOLS = new Set(['anyway', 'no_enter', 'force_new', 'reclaim', 'force']);
// The gfw_* verbs do not go through ghostfleet's checks: their session becomes part of a FILE
// name (fleet.mjs labelFile/schedFile). fleet-serve's NAME_OK without the `/`, so a name
// cannot climb out of the fleet dir ("x/../../.bashrc").
const SESSION_OK = /^[A-Za-z0-9][A-Za-z0-9 ._~-]{0,47}$/;
function buildArgs(tool, raw) {
  const v = TOOLS[tool];
  if (!v) throw httpErr(400, `acción desconocida: ${tool}`);
  const a = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [k, val] of Object.entries(a)) {
    if (!v.fields.includes(k)) throw httpErr(400, `${tool} no acepta '${k}'`);
    if (val === undefined || val === null || val === '') continue;
    out[k] = BOOLS.has(k) ? val === true : String(val);
  }
  if (!out.project) throw httpErr(400, 'falta el proyecto');
  if (v.local && !out.session) throw httpErr(400, 'falta la sesión');
  if (v.local && !SESSION_OK.test(out.session)) throw httpErr(400, `nombre de sesión inválido: '${out.session.slice(0, 60)}'`);
  return { args: out, v };
}

// ── http plumbing ───────────────────────────────────────────────────────────────────────
function httpErr(status, text) { return Object.assign(new Error(text), { status }); }
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let n = 0; const chunks = [];
  for await (const c of req) { n += c.length; if (n > 256 * 1024) throw httpErr(413, 'body demasiado grande'); chunks.push(c); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpErr(400, 'body no es JSON'); }
}
async function rawBody(req, cap, what = 'el audio') {
  let n = 0; const chunks = [];
  for await (const c of req) { n += c.length; if (n > cap) throw httpErr(413, `${what} pasa el límite de ${Math.round(cap / 1048576)} MB`); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function localAct(tool, a) {
  if (tool === 'gfw_label') return fleet.setLabel(a.project, a.session, a.text || '');
  if (tool === 'gfw_unschedule') return fleet.cancelSchedule(a.project, a.session);
  const at = Number(a.at);
  if (!Number.isInteger(at) || at < now() + 20 || at > now() + 14 * 86400) throw httpErr(400, 'la hora tiene que ser en el futuro y dentro de 14 días');
  const msg = String(a.msg || 'continúa').trim().slice(0, 4000) || 'continúa';
  return fleet.schedule(a.project, a.session, at, msg);
}
// One verb, by whoever asked: a person's click or an automation (`via`, its name). The same
// allowlist, checks, owners and activity row either way — an automation is not a back door.
async function perform(userId, tool, rawArgs, { confirm = false, owner, via } = {}) {
  const { args, v } = buildArgs(tool, rawArgs);
  if (v.confirm && confirm !== true) throw httpErr(428, `${tool} necesita confirmación`);
  // An answer names the prompt it answers: the page drew a pane polled a moment ago, and a
  // "1" + Enter landing after the prompt is gone becomes a MESSAGE in the composer.
  if (tool === 'fleet_answer' && !args.expect)
    return { ok: false, changed: true, text: 'el pedido ya no está en pantalla; nada se envió.' };
  const r = v.local ? await localAct(tool, args) : await fleet.act(tool, args);
  const subject = args.session || args.name || args.path || '-';
  if (r.ok && tool === 'fleet_spawn') { state.owners[key(args.project, args.name)] = String(owner || userId); saveState(); }
  if (r.ok && tool === 'fleet_rename') {
    const from = key(args.project, args.session), to = key(args.project, args.new_name);
    if (state.owners[from]) { state.owners[to] = state.owners[from]; delete state.owners[from]; saveState(); }
  }
  if (r.ok && tool === 'fleet_stop') { delete state.owners[key(args.project, args.session)]; saveState(); }
  audit({ user: userId, verb: tool, project: args.project, subject, ...(via ? { via } : {}),
          args: Object.fromEntries(Object.entries(args).map(([k, val]) => [k, typeof val === 'string' ? val.slice(0, 500) : val])),
          result: r.changed ? 'changed' : r.ok ? 'ran' : 'refused', output: String(r.text || '').slice(0, 500) });
  return r;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
                '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
                '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
function serveStatic(res, pathname) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Falta compilar la interfaz: corre `pnpm build` (o `pnpm dev` para desarrollo).');
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { throw httpErr(400, 'ruta mal codificada'); }
  let f = path.join(DIST, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!f.startsWith(DIST + path.sep) ||!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream',
                       'Cache-Control': f.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
                       'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);   // a stream error is an uncaught throw
}
const q = (url, k) => url.searchParams.get(k) || '';

// ── routes ──────────────────────────────────────────────────────────────────────────────
async function route(req, res, url) {
  const p = url.pathname;
  const ip = req.socket.remoteAddress;

  // A cross-site page cannot set a custom header without a CORS preflight, which this server
  // never answers — so a POST that carries it came from this app. SameSite=Strict covers the rest.
  if (req.method !== 'GET' && req.headers['x-gfw'] !== '1') throw httpErr(403, 'falta X-GFW');

  if (p === '/api/health') {
    const w = whoIs(req);
    return send(res, 200, { ok: true, mode: MODE, setup: users.length === 0, user: publicUser(w?.user) });
  }
  if (p === '/api/setup' && req.method === 'POST') {
    if (users.length) throw httpErr(409, 'las cuentas ya están creadas');
    const b = await body(req);
    if (!codeOk(b.code)) {
      audit({ user: '?', verb: 'setup', ip, result: 'refused' });
      await new Promise(r => setTimeout(r, 600));
      throw httpErr(403, 'el código de instalación no coincide: es el que muestra la terminal donde corre el servidor');
    }
    const list = (b.users || []).filter(u => u && u.name);
    if (!list.length) throw httpErr(400, 'crea al menos una cuenta');
    for (const u of list) addUser(u.name, u.password);
    setupCode = null;
    const first = users[0];
    if (MODE === 'demo') seedDemoOwners();
    audit({ user: first.id, verb: 'setup', subject: users.map(u => u.name).join(', '), result: 'ran' });
    return send(res, 200, { ok: true, user: publicUser(first) }, { 'Set-Cookie': cookie(mintLogin(first), IDLE) });
  }
  if (p === '/api/login' && req.method === 'POST') {
    const b = await body(req);
    const u = users.find(x => x.id === slug(b.name));
    if (!u || !pwOk(u, b.password || '')) {
      audit({ user: slug(b.name) || '?', verb: 'login', ip, result: 'refused' });
      await new Promise(r => setTimeout(r, 600));
      throw httpErr(401, 'nombre o contraseña incorrectos');
    }
    audit({ user: u.id, verb: 'login', ip, result: 'ran' });
    return send(res, 200, { ok: true, user: publicUser(u) }, { 'Set-Cookie': cookie(mintLogin(u), IDLE) });
  }

  const w = whoIs(req);
  if (!w) throw httpErr(401, 'inicia sesión');
  const me = w.user;

  if (p === '/api/logout' && req.method === 'POST') {
    delete logins[w.key]; writeJson('logins.json', logins);
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (p === '/api/users' && req.method === 'GET') return send(res, 200, { users: users.map(publicUser) });
  if (p === '/api/users' && req.method === 'POST') {
    const b = await body(req);
    const u = addUser(b.name, b.password);
    audit({ user: me.id, verb: 'add_user', subject: u.name, result: 'ran' });
    return send(res, 200, { ok: true, user: publicUser(u) });
  }
  if (p === '/api/password' && req.method === 'POST') {
    const b = await body(req);
    if (!pwOk(me, b.old || '')) throw httpErr(401, 'la contraseña actual no coincide');
    if (String(b.new || '').length < 6) throw httpErr(400, 'la contraseña nueva necesita al menos 6 caracteres');
    Object.assign(me, hashPw(b.new)); saveUsers();
    audit({ user: me.id, verb: 'password', subject: me.name, result: 'ran' });
    return send(res, 200, { ok: true });
  }

  if (p === '/api/projects') {
    const list = await fleet.projects();
    for (const pr of list) for (const s of pr.sessions) s.owner = state.owners[key(pr.name, s.name)] || null;
    return send(res, 200, { projects: list });
  }
  if (p === '/api/grid') {
    const project = q(url, 'project');
    const g = await fleet.grid(project);
    for (const c of g.cards || []) { c.owner = state.owners[key(project, c.name)] || null; c.here = here(project, c.name); }
    return send(res, 200, g);
  }
  if (p === '/api/session') {
    const project = q(url, 'project'), s = q(url, 'session');
    const [msgs, queued] = await Promise.all([fleet.session(project, s, q(url, 'before')), fleet.queue(project, s).catch(() => [])]);
    // The transcript says a person typed it, not which one; the activity log does.
    const sent = activity(3000).filter(r => r.project === project && r.result === 'ran' && r.args?.prompt
      && ((r.verb === 'fleet_spawn' && r.subject === s) || (['fleet_send', 'fleet_resume'].includes(r.verb) && r.subject === s)));
    const head = (t) => String(t || '').trim().slice(0, 200);
    for (const m of msgs.messages || []) {
      if (m.role !== 'user') continue;
      const hit = sent.find(r => head(r.args.prompt) && head(m.text).startsWith(head(r.args.prompt).slice(0, 120)));
      if (hit) m.by = hit.user;
    }
    return send(res, 200, { ...msgs, queued, owner: state.owners[key(project, s)] || null, here: here(project, s) });
  }
  if (p === '/api/pane') {
    const project = q(url, 'project'), s = q(url, 'session');
    seen(project, s, me.id, false);
    return send(res, 200, { ...(await fleet.pane(project, s)), here: here(project, s) });
  }
  if (p === '/api/presence' && req.method === 'POST') {
    const b = await body(req);
    if (b.project && b.session) seen(String(b.project), String(b.session), me.id, b.typing);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/assign' && req.method === 'POST') {
    const b = await body(req);
    const k = key(b.project, b.session);
    if (b.owner && !users.some(u => u.id === b.owner)) throw httpErr(400, `no existe la persona '${b.owner}'`);
    if (b.owner) state.owners[k] = b.owner; else delete state.owners[k];
    saveState();
    audit({ user: me.id, verb: 'assign', project: b.project, subject: b.session, args: { owner: b.owner || null }, result: 'ran' });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/activity') return send(res, 200, { rows: activity(Number(q(url, 'limit')) || 200) });

  if (p === '/api/usage') return send(res, 200, fleet.usage());
  if (p === '/api/voice') return send(res, 200, voice.status());
  if (p === '/api/lead' && req.method === 'POST') {
    const b = await body(req);
    const r = await fleet.ensureLead(String(b.project || ''));
    if (r.started) audit({ user: me.id, verb: `lead_${r.started}`, project: b.project, subject: 'master', result: r.ok ? 'ran' : 'refused', output: r.text || '' });
    return send(res, r.ok ? 200 : 502, r);
  }
  if (p === '/api/hear' && req.method === 'POST') {
    const wav = await rawBody(req, 8 * 1048576);
    let words = [];
    try { words = (await fleet.projects()).flatMap(pr => [pr.name, ...pr.sessions.map(x => x.name)]); } catch {}
    const t0 = Date.now();
    const r = await voice.hear(wav, [...new Set(words)]);
    console.log(new Date().toISOString().slice(11, 19), `hear: ${Math.round(wav.length / 1024)} KB en ${Date.now() - t0} ms`);
    if (r.error) return send(res, 502, { ok: false, text: r.error });
    return send(res, 200, { ok: true, text: r.text, ms: Date.now() - t0 });
  }
  // A file for a session: the raw bytes in the body, where it goes in the query. It is saved
  // and its path handed back; the message that names it is an ordinary fleet_send.
  if (p === '/api/attach' && req.method === 'POST') {
    const project = q(url, 'project'), session = q(url, 'session'), name = q(url, 'name');
    if (!project) throw httpErr(400, 'falta el proyecto');
    if (!SESSION_OK.test(session)) throw httpErr(400, `nombre de sesión inválido: '${session.slice(0, 60)}'`);
    const buf = await rawBody(req, ATTACH_MAX_BYTES, 'el archivo');
    const r = fleet.attach(project, session, name, buf);
    audit({ user: me.id, verb: 'attach', project, subject: session, result: 'ran', output: `${r.name} (${Math.round(r.size / 1024)} KB)` });
    return send(res, 200, r);
  }
  if (p === '/api/speak' && req.method === 'POST') {
    const b = await body(req);
    const r = voice.plan(b.text, b.more === true);
    return r.error ? send(res, 503, { ok: false, text: r.error }) : send(res, 200, { ok: true, ...r });
  }
  if (p.startsWith('/api/speak/') && req.method === 'GET') {
    const r = await voice.audio(p.slice('/api/speak/'.length));
    if (r.error) return send(res, r.status || 500, { ok: false, text: r.error });
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=3600', 'Content-Length': r.wav.length });
    return res.end(r.wav);
  }

  if (p === '/api/act' && req.method === 'POST') {
    const b = await body(req);
    const r = await perform(me.id, String(b.tool || ''), b.args, { confirm: b.confirm === true, owner: b.owner });
    return send(res, r.changed ? 409 : r.ok ? 200 : 400, r);
  }

  if (p === '/api/automations' && req.method === 'GET') return send(res, 200, autos.view(me.id));
  if (p === '/api/automations' && req.method === 'POST') {
    const b = await body(req);
    const a = autos.upsert(me.id, b.automation);
    audit({ user: me.id, verb: 'auto_save', subject: a.name, result: 'ran', output: `${describeTrigger(a.trigger)} · ${a.steps.length} paso(s)${a.enabled ? '' : ' · apagada'}` });
    return send(res, 200, { ok: true, automation: a });
  }
  if (p === '/api/automations/delete' && req.method === 'POST') {
    const b = await body(req);
    const a = autos.remove(me.id, String(b.id || ''));
    audit({ user: me.id, verb: 'auto_delete', subject: a.name, result: 'ran' });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/automations/run' && req.method === 'POST') {
    const b = await body(req);
    const r = await autos.runNow(me.id, String(b.id || ''));
    return send(res, 200, { ok: r.ok, text: r.text || (r.ok ? 'listo' : 'falló'), steps: r.steps || [] });
  }
  if (p === '/api/automations/ai' && req.method === 'POST') {
    const b = await body(req);
    const messages = (Array.isArray(b.messages) ? b.messages : []).filter(m => m && m.text).map(m => ({ role: m.role === 'ai' ? 'ai' : 'user', text: String(m.text) }));
    if (!messages.length) throw httpErr(400, 'escribe qué quieres automatizar');
    let projects = [];
    try { projects = await fleet.projects(); } catch {}
    const nowText = new Date().toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const r = await askAI({ messages, draft: b.draft || null, projects, nowText });
    return send(res, r.ok ? 200 : 502, r);
  }
  if (p === '/api/demo/reset' && req.method === 'POST' && MODE === 'demo') {
    fleet.reset(); seedDemoOwners();
    return send(res, 200, { ok: true });
  }
  throw httpErr(404, `no existe ${p}`);
}

// Automations run as the person who made them, through perform() like any click.
const autos = createEngine({ fleet, readJson, writeJson, appendLine, readLines, perform, users: () => users });
autos.start();

const server = http.createServer(async (req, res) => {
  if (req.headers.host && !HOSTS.has(hostName(req.headers.host)))
    return send(res, 403, { ok: false, text: `Host inesperado '${req.headers.host}': este servidor responde a ${[...HOSTS].join(', ')} (GFW_HOSTS para sumar otro)` });
  // Everything a request can throw stays in this try: the handler is async, so an escape
  // is an unhandled rejection, and that ends the process — one `GET /%E0%A4%A` used to
  // take the fleet's web down for everyone (decodeURIComponent in serveStatic).
  try {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
    await route(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { ok: false, text: e.message || 'error interno' });
    if (!e.status) console.error(e);
  }
});
server.listen(PORT, BIND, () => {
  const origin = `http://${BIND.includes(':') ? `[${BIND}]` : BIND}:${PORT}`;
  console.log(`ghostfleet web · modo ${MODE === 'demo' ? 'DEMO (datos de ejemplo)' : 'REAL (tu flota)'}`);
  console.log(`  ${origin}`);
  console.log(`  datos: ${DATA}`);
  if (setupCode) console.log(`  primera vez: código de instalación ${setupCode}\n  (o abre ${origin}/#codigo=${setupCode}, que ya lo trae)`);
});
