// server/automations.mjs — the runner behind the Automatizaciones page: a clock for the
// scheduled ones, a watcher of the fleet's statuses for the event ones, and a log of every
// run. It decides WHEN; every step it takes goes through `perform` (index.mjs), the same
// allowlist, argument checks, owners and activity log as a click in the browser.
//
// A schedule that comes due while this server is not running is NOT run late: it is logged
// as skipped and its owner gets a notice. Work that lands hours after it was meant to is the
// surprise this avoids.
import crypto from 'node:crypto';
import { claudeJson } from './claude.mjs';
import { ACTIONS, EVENTS, STATES, normalize, nextAfter, describeTrigger, describeStep, fill } from '../shared/automations.js';

const now = () => Math.floor(Date.now() / 1000);
const GRACE = 120;                 // a due run later than this was missed, not late
const MAX_PER_HOUR = 30;           // a loop (an event its own steps cause) stops itself here

export function createEngine({ fleet, readJson, writeJson, appendLine, readLines, perform, users }) {
  let list = readJson('automations.json', { automations: [] }).automations;
  let notices = readJson('notices.json', { notices: [] }).notices;
  const save = () => writeJson('automations.json', { automations: list });
  const saveNotices = () => writeJson('notices.json', { notices: notices.slice(-200) });
  const running = new Set();
  const lastFire = new Map();      // `${id}|${project}/${session}` -> epoch, for the cooldown
  const recent = new Map();        // id -> [epoch…] in the last hour

  const canSee = (a, user) => a.owner === user || a.visibility === 'team';
  const canEdit = canSee;
  const ownerName = (id) => users().find(u => u.id === id)?.name || id;

  function notice(a, text, kind = 'info') {
    notices.push({ id: crypto.randomBytes(6).toString('hex'), at: now(), auto: a?.id || null, autoName: a?.name || '',
                   owner: a?.owner || null, visibility: a?.visibility || 'team', text, kind });
    saveNotices();
  }
  function logRun(row) { appendLine('automation-runs.jsonl', { at: now(), ...row }); }

  // ── the clock: compute the next run for every schedule; on boot, what came due while off ──
  function arm(a, from = now()) {
    a.nextRun = a.enabled && a.trigger.type === 'schedule' ? nextAfter(a.trigger, from, a.anchor || from) : null;
  }
  for (const a of list) if (a.enabled && a.trigger.type === 'schedule' && a.nextRun == null) arm(a);
  save();

  function tick() {
    const t = now();
    let dirty = false;
    for (const a of list) {
      if (!a.enabled || a.trigger.type !== 'schedule' || !a.nextRun || a.nextRun > t) continue;
      const due = a.nextRun;
      if (t - due > GRACE) {
        const when = new Date(due * 1000).toLocaleString('es', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        logRun({ auto: a.id, name: a.name, owner: a.owner, status: 'skipped', trigger: describeTrigger(a.trigger), due,
                 text: 'el servidor estaba apagado a esa hora' });
        notice(a, `«${a.name}» no se ejecutó el ${when}: ghostfleet web estaba apagado a esa hora. No la corrí tarde.`, 'warn');
      } else {
        run(a, { why: describeTrigger(a.trigger), at: due });
      }
      if (a.trigger.mode === 'once') { a.enabled = false; a.nextRun = null; }
      else arm(a, t);
      dirty = true;
    }
    if (dirty) save();
  }

  // ── the watcher: a status that CHANGED is an event; the first look only learns the fleet ──
  let seen = null;
  const fromTo = {
    finished: (a, b) => a === 'working' && (b === 'ready' || b === 'idle'),
    'need-you': (a, b) => b === 'need-you' && a !== 'need-you',
    started: (a, b) => b === 'working' && a !== 'working',
    limit: (a, b) => b === 'limit' && a !== 'limit',
    lost: (a, b) => b === 'lost' && a !== 'lost',
  };
  async function watch() {
    const listeners = list.filter(a => a.enabled && a.trigger.type === 'event');
    if (!listeners.length) { seen = null; return; }
    let projects;
    try { projects = await fleet.projects(); } catch { return; }
    const cur = new Map();
    for (const p of projects) for (const s of p.sessions) cur.set(`${p.name}/${s.name}`, { project: p.name, session: s.name, status: s.status });
    if (seen) {
      for (const [k, c] of cur) {
        const before = seen.get(k)?.status;
        if (before === undefined || before === c.status) continue;
        for (const a of listeners) {
          const tr = a.trigger;
          if (!fromTo[tr.event]?.(before, c.status)) continue;
          if (tr.project !== '*' && tr.project !== c.project) continue;
          if (tr.session !== '*' && tr.session !== c.session) continue;
          const ck = `${a.id}|${k}`;
          if (now() - (lastFire.get(ck) || 0) < tr.cooldown * 60) continue;
          lastFire.set(ck, now());
          run(a, { why: `${c.project}/${c.session}: ${EVENTS[tr.event].label.toLowerCase()}`, project: c.project, session: c.session, at: now() });
        }
      }
    }
    seen = cur;
  }

  // ── a run: the steps in order; the first that fails stops the rest ─────────────────────
  async function run(a, ctx) {
    if (running.has(a.id)) {
      logRun({ auto: a.id, name: a.name, owner: a.owner, status: 'skipped', trigger: ctx.why, text: 'la ejecución anterior todavía no terminaba' });
      return { ok: false, text: 'ya se está ejecutando' };
    }
    const hour = (recent.get(a.id) || []).filter(x => now() - x < 3600);
    if (hour.length >= MAX_PER_HOUR) {
      a.enabled = false; arm(a); save();
      notice(a, `Apagué «${a.name}»: se disparó ${MAX_PER_HOUR} veces en una hora, parece un bucle. Revísala y vuelve a encenderla.`, 'bad');
      return { ok: false, text: 'apagada por exceso de ejecuciones' };
    }
    recent.set(a.id, [...hour, now()]);
    running.add(a.id);
    const steps = [];
    let ok = true;
    try {
      for (const s of a.steps) {
        const r = await step(a, s, ctx).catch(e => ({ ok: false, text: e.message }));
        const v = { at: ctx.at, project: ctx.project, session: ctx.session };
        const shown = { ...s, project: fill(s.project, v), session: fill(s.session, v), prompt: fill(s.prompt, v), name: fill(s.name, v), text: fill(s.text, v) };
        steps.push({ action: s.action, what: describeStep(shown), ok: r.ok, text: String(r.text || '').slice(0, 300) });
        if (!r.ok) { ok = false; break; }
        if (r.halt) { steps.at(-1).halt = true; break; }
      }
    } finally { running.delete(a.id); }
    a.lastRun = { at: now(), ok };
    save();
    logRun({ auto: a.id, name: a.name, owner: a.owner, status: ok ? 'ok' : 'error', trigger: ctx.why, steps });
    if (!ok) notice(a, `«${a.name}» falló en «${steps.at(-1)?.what}»: ${steps.at(-1)?.text || 'sin detalle'}`, 'bad');
    return { ok, steps };
  }

  async function step(a, s, ctx) {
    const v = { at: ctx.at, project: ctx.project, session: ctx.session };
    if (s.action === 'wait') { await new Promise(r => setTimeout(r, s.minutes * 60000)); return { ok: true, text: `esperé ${s.minutes} min` }; }
    if (s.action === 'notify') { notice(a, fill(s.text, v), 'info'); return { ok: true, text: 'aviso creado' }; }
    const project = s.project === '{proyecto}' ? ctx.project : s.project;
    const session = s.session === '{sesion}' ? ctx.session : s.session;
    if (!project) return { ok: false, text: 'no hay proyecto: el paso usa el del evento y esto no vino de un evento' };
    // A condition: the rest runs only if the session is in one of these states right now.
    if (s.action === 'check') {
      const st = (await fleet.projects()).find(p => p.name === project)?.sessions.find(x => x.name === session)?.status || 'lost';
      return s.status.includes(st)
        ? { ok: true, text: `está ${STATES[st] || st}: sigo` }
        : { ok: true, halt: true, text: `está ${STATES[st] || st}: no sigo con los pasos de abajo` };
    }
    const args = { project };
    if (s.action === 'spawn') {
      args.name = fill(s.name, v).replace(/[^A-Za-z0-9 ._~-]/g, '-').slice(0, 48);
      if (s.prompt) args.prompt = fill(s.prompt, v);
      if (s.branch) args.branch = fill(s.branch, v);
    } else {
      if (!session) return { ok: false, text: 'no hay sesión: el paso usa la del evento y esto no vino de un evento' };
      args.session = session;
      if (s.prompt) args.prompt = fill(s.prompt, v);
      // The lead has to be up before it can be written to (the assistant does the same).
      if (s.action === 'send') {
        const lead = (await fleet.projects()).find(p => p.name === project)?.sessions.find(x => x.lead)?.name;
        if (session === lead || session === 'master') {
          const r = await fleet.ensureLead(project);
          if (!r.ok) return { ok: false, text: r.text || 'no pude arrancar al líder' };
        }
      }
    }
    return perform(a.owner, ACTIONS[s.action].tool, args, { confirm: s.confirmed === true, via: a.name });
  }

  // ── what the page asks ─────────────────────────────────────────────────────────────────
  return {
    start() {
      tick();
      setInterval(tick, 15000).unref();
      setInterval(() => { watch().catch(() => {}); }, 8000).unref();
      watch().catch(() => {});
    },
    view(user) {
      const mine = list.filter(a => canSee(a, user));
      const ids = new Set(mine.map(a => a.id));
      const runs = readLines('automation-runs.jsonl', 400).filter(r => ids.has(r.auto)).slice(0, 60);
      const visibleNotices = notices.filter(n => n.owner === user || (n.visibility === 'team' && (!n.auto || ids.has(n.auto)))).slice(-40).reverse();
      return { automations: mine.map(a => ({ ...a, ownerName: ownerName(a.owner), running: running.has(a.id), mine: a.owner === user })),
               runs, notices: visibleNotices };
    },
    upsert(user, raw) {
      const clean = normalize(raw, { strict: raw?.enabled !== false });
      const old = clean.id && list.find(a => a.id === clean.id);
      if (old && !canEdit(old, user)) throw Object.assign(new Error('esa automatización es personal de otra persona'), { status: 403 });
      // Only its owner makes a personal one public or a public one personal.
      if (old && old.owner !== user) clean.visibility = old.visibility;
      const a = { ...(old || { created: now(), owner: user }), ...clean, id: old?.id || crypto.randomBytes(5).toString('hex'), updated: now() };
      const timing = JSON.stringify(old?.trigger) !== JSON.stringify(a.trigger) || !old?.enabled;
      if (timing) a.anchor = now();
      arm(a, now());
      if (old) list[list.indexOf(old)] = a; else list.push(a);
      save();
      return a;
    },
    remove(user, id) {
      const a = list.find(x => x.id === id);
      if (!a || !canSee(a, user)) throw Object.assign(new Error('no existe esa automatización'), { status: 404 });
      if (a.owner !== user && a.visibility !== 'team') throw Object.assign(new Error('solo quien la creó puede borrarla'), { status: 403 });
      list = list.filter(x => x !== a); save();
      return a;
    },
    async runNow(user, id) {
      const a = list.find(x => x.id === id);
      if (!a || !canSee(a, user)) throw Object.assign(new Error('no existe esa automatización'), { status: 404 });
      if (a.trigger.type === 'event' && a.steps.some(s => s.project === '{proyecto}' || s.session === '{sesion}'))
        return { ok: false, text: 'usa «la sesión del evento»: solo puede correr cuando pase el evento' };
      return run(a, { why: `a mano, ${ownerName(user)}`, at: now() });
    },
    get(id) { return list.find(a => a.id === id); },
  };
}

// ── the AI tab: a one-shot Claude that turns a sentence into a draft ─────────────────────
// No tools, no MCP, no settings (so no ghostfleet hooks treat it as a fleet session), no
// transcript kept. It only WRITES A DRAFT: the person still sees it in the editor and saves.
const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'lo que le dices a la persona, breve, en español neutro con tú' },
    automation: {
      type: ['object', 'null'],
      properties: {
        name: { type: 'string' },
        trigger: { type: 'object' },
        steps: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  required: ['reply', 'automation'],
};

export async function askAI({ messages, draft, projects, nowText }) {
  const fleetText = projects.map(p => `- ${p.name}: ${p.sessions.map(s => `${s.name}${s.lead ? ' (líder)' : ''} [${s.status}]`).join(', ') || 'sin sesiones'}`).join('\n');
  const system = `Eres el asistente que arma AUTOMATIZACIONES en ghostfleet web, una página para manejar una flota de sesiones de Claude Code (workers) organizadas por proyecto. Cada proyecto tiene un líder llamado normalmente "master" y workers con nombre.

Una automatización es un disparador y una lista de pasos en orden. Devuelves SIEMPRE el JSON pedido: "reply" (breve, en español neutro con tú: qué armaste o qué te falta saber) y "automation" (el borrador completo, o null si solo conversas o te falta un dato imprescindible).

Formato de "automation":
{ "name": "nombre corto",
  "trigger": UNO de:
    { "type":"schedule", "mode":"days", "at":"HH:MM", "days":[0..6] }   (0=domingo … 6=sábado; lunes a viernes = [1,2,3,4,5])
    { "type":"schedule", "mode":"once", "date":"YYYY-MM-DD", "at":"HH:MM" }
    { "type":"schedule", "mode":"every", "minutes": N }   (N ≥ 15)
    { "type":"event", "event": "finished"|"need-you"|"started"|"limit"|"lost", "project": "nombre o *", "session": "nombre o *", "cooldown": minutos }
  "steps": lista de:
    { "action":"send", "project", "session", "prompt" }        mandar un prompt a una sesión
    { "action":"spawn", "project", "name", "prompt"?, "branch"? }  crear una sesión nueva (worktree) con una tarea
    { "action":"pause"|"wake"|"interrupt"|"reopen"|"stop", "project", "session" }
    { "action":"resume", "project", "session", "prompt"? }
    { "action":"notify", "text" }                              avisarle a la persona en la página
    { "action":"wait", "minutes": 1..60 }
    { "action":"check", "project", "session", "status": [estados] }   seguir con los pasos de abajo SOLO si la sesión está en alguno de esos estados; si no, la ejecución termina ahí sin error. Estados: "need-you" (te necesita), "working", "ready", "idle", "parked", "limit", "interrupted", "asleep", "lost". Úsalo para "si sigue igual…", "si todavía…".
}
Con un disparador de evento, "project":"{proyecto}" y "session":"{sesion}" en un paso significan la sesión donde pasó el evento. En prompts, nombres y avisos puedes usar {fecha} {hora} {proyecto} {sesion}. Para "stop" no pongas "confirmed": la persona lo confirma en el editor.
Usa SOLO proyectos y sesiones que existen (abajo), salvo en "spawn", que crea una nueva. Si la persona dice "el líder" usa la sesión marcada como líder. Si modifica un borrador existente, devuelve el borrador completo con el cambio. Si falta algo que no puedes deducir, pregunta en "reply" y deja "automation" en null o con lo que sí sabes.

Ahora es ${nowText}.
La flota ahora:
${fleetText || '(no se pudo leer)'}`;
  const convo = messages.slice(-12).map(m => `${m.role === 'user' ? 'PERSONA' : 'ASISTENTE'}: ${String(m.text).slice(0, 2000)}`).join('\n\n');
  const prompt = `${draft ? `Borrador actual en el editor:\n${JSON.stringify(draft)}\n\n` : ''}Conversación:\n${convo}\n\nResponde al último mensaje de la PERSONA.`;
  const r = await claudeJson({ system, prompt, schema: DRAFT_SCHEMA });
  if (!r.ok) return r;
  let automation = null, problem = '';
  if (r.data.automation) {
    try { automation = normalize(r.data.automation, { strict: false }); delete automation.id; }
    catch (e) { problem = e.message; }
  }
  return { ok: true, reply: problem ? `${r.data.reply}\n\n(El borrador vino con un problema: ${problem})` : r.data.reply, automation };
}
