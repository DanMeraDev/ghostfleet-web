// server/fleet.mjs — the REAL fleet, read and driven through the installed ghostfleet.
//
// Nothing here decides what a session is doing. Reads are the same three things
// bin/fleet-serve.mjs proxies (fleet-grid.mjs --json, fleet-read --json through fleet_read,
// tmux capture-pane), and every action goes through mcp/fleet-dispatch.mjs by its MCP tool
// name — the same planner and argument checks the MCP server and the phone use. A second
// implementation of "what is this card" would drift from the grid's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const GF_HOME = process.env.GHOSTFLEET_HOME
  || path.join(os.homedir(), '.local', 'libexec', 'ghostfleet');

const need = (rel) => {
  const p = path.join(GF_HOME, rel);
  if (!fs.existsSync(p)) throw new Error(`ghostfleet no está instalado en ${GF_HOME} (falta ${rel}). Definí GHOSTFLEET_HOME o usá el modo demo.`);
  return pathToFileURL(p).href;
};
const dispatch = await import(need('mcp/fleet-dispatch.mjs'));
const perm = await import(need('lib/permission-dialog.mjs'));
const GRID = path.join(GF_HOME, 'bin', 'fleet-grid.mjs');
const TMUX_CONF = path.join(GF_HOME, 'tmux', 'cf.tmux.conf');

const NINE = new Set(['need-you', 'working', 'ready', 'parked', 'idle', 'starting', 'unknown', 'limit', 'interrupted']);

function target(name) {
  const t = dispatch.projects().find(p => p.name === name);
  if (!t) throw Object.assign(new Error(`no existe el proyecto '${name}'`), { status: 404 });
  return t;
}

const gridEnv = (t) => ({
  ...process.env, TMUX: '',
  CLAUDE_CONFIG_DIR: t.cfg, CLAUDE_FLEET_DIR: path.join(t.cfg, 'fleet'),
  CLAUDE_FLEET_PROFILE: t.profile, CLAUDE_FLEET_SCOPE: t.name,
  CLAUDE_FLEET_ROOT: t.path, CLAUDE_FLEET_SOCK: t.sock,
  CLAUDE_FLEET_AGENT: t.agent || 'claude',
});

const toText = (out) => (typeof out === 'string' ? out : String(out?.text ?? ''));

// Several browsers poll the same thing; one child process answers all of them.
function cached(ms, fn) {
  const memo = new Map();
  return (key, ...args) => {
    const hit = memo.get(key);
    if (hit && hit.until > Date.now()) return hit.p;
    const p = fn(...args).catch((e) => { memo.delete(key); throw e; });
    memo.set(key, { p, until: Date.now() + ms });
    return p;
  };
}

const digest = cached(4000, async () => {
  const out = await dispatch.callToolAsync('fleet_digest', { json: true, peek: true }, { timeout: 30000 });
  return JSON.parse(toText(out));
});

export async function projects() {
  const d = await digest('all');
  return (d.projects || []).map(p => {
    const counts = { need_you: 0, working: 0, ready: 0, parked: 0, lost: 0, total: 0 };
    for (const s of p.sessions || []) {
      counts.total++;
      if (s.status === 'need-you') counts.need_you++;
      else if (s.status in counts) counts[s.status]++;
    }
    return { name: p.name, path: p.path, profile: p.profile, counts,
             sessions: (p.sessions || []).map(s => ({ name: s.name, status: s.status, ts: s.ts, lead: !!s.lead })) };
  });
}

const gridRun = cached(1500, (t) => new Promise((resolve, reject) => {
  execFile(process.execPath, [GRID, t.sock, TMUX_CONF, '--json'],
    { encoding: 'utf8', env: gridEnv(t), timeout: 20000, maxBuffer: 64 * 1024 * 1024 },
    (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(`fleet-grid --json falló: ${(stderr || err.message).trim().split('\n')[0]}`));
      try {
        const j = JSON.parse(stdout);
        for (const c of j.cards || []) if (!NINE.has(c.status)) c.status = 'unknown';
        resolve(j);
      } catch { reject(new Error(`fleet-grid --json no devolvió JSON: ${String(stdout).slice(0, 200)}`)); }
    });
}));

export const grid = (project) => { const t = target(project); return gridRun(t.name, t); };

export async function session(project, name, before) {
  const t = target(project);
  const out = await dispatch.callToolAsync('fleet_read',
    { project: t.name, session: name, json: true, limit: 30, ...(before ? { before: String(before) } : {}) },
    { timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  const text = toText(out);
  try { return JSON.parse(text); } catch { throw new Error(`fleet-read --json: ${text.trim().slice(0, 200)}`); }
}

export async function queue(project, name) {
  const t = target(project);
  const out = await dispatch.callToolAsync('fleet_queue', { project: t.name, session: name }, { timeout: 10000 });
  const q = [];
  for (const line of toText(out).split('\n')) {
    const [at, b64, kind] = line.split('\t');
    if (!b64 || !/^\d+$/.test(at) || kind === 'nudge') continue;
    q.push({ at: Number(at), text: Buffer.from(b64, 'base64').toString('utf8') });
  }
  return q;
}

// capture-pane READS. It never attaches and never resizes: either would change the pane the
// desk is looking at and can blind the status detectors that read it.
export function pane(project, name) {
  const t = target(project);
  return new Promise((resolve, reject) => {
    execFile('tmux', ['-L', t.sock, 'capture-pane', '-p', '-e', '-t', name],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error(`tmux capture-pane: ${(stderr || err.message).trim().split('\n')[0]}`));
        let prompt = null;
        try { prompt = perm.promptSummary(stdout); } catch {}
        resolve({ pane: String(stdout), prompt });
      });
  });
}

// Writes run one at a time: two spawns racing for the same free worktree is a bug that
// costs a checkout to discover.
let chain = Promise.resolve();
const serialize = (fn) => (chain = chain.then(fn, fn));

export function act(tool, args) {
  return serialize(async () => {
    // human:true — the request comes from a person who read the dialog in the browser,
    // which is the one thing fleet-answer lets approve a permission prompt.
    const out = await dispatch.callToolAsync(tool, args,
      { timeout: 15 * 60 * 1000, human: true, status: tool === 'fleet_send' });
    const text = toText(out);
    const undelivered = tool === 'fleet_send' && typeof out === 'object' && !out.isError && out.code !== 0;
    const refused = undelivered || (typeof out === 'object' && out.isError === true);
    const changed = tool === 'fleet_answer' && /^fleet-answer: the prompt changed/m.test(text);
    const queued = !refused && tool === 'fleet_send'
      ? (/queued #\d+ behind a question/.test(text) ? 'question' : /queued #\d+/.test(text) ? 'turn' : undefined)
      : undefined;
    return { ok: !refused && !changed, text, changed, queued };
  });
}

export const mode = 'real';
