// shared/automations.js — what an automation IS, for the server that runs it and the page that
// edits it: the shapes, the one function that cleans what a person (or the AI) wrote into a
// shape the runner can trust, when it fires next, and how it reads out loud in a sentence.
//
// An automation is a trigger and a list of steps, run top to bottom:
//   { id, name, owner, visibility: 'personal'|'team', enabled,
//     trigger: { type: 'schedule', mode: 'once'|'days'|'every', date, at, days, minutes }
//            | { type: 'event', event, project, session, cooldown },
//     steps: [{ action, project, session, prompt, name, branch, minutes, text, confirmed }] }
// A step's project/session can be the literal '{proyecto}' / '{sesion}': the session the
// event happened to. Prompts, names and notices can use {fecha} {hora} {proyecto} {sesion}.

export const EVENTS = {
  finished:  { label: 'Termina de trabajar',  hint: 'pasa de trabajando a lista' },
  'need-you': { label: 'Te necesita',          hint: 'espera una respuesta o un permiso' },
  started:   { label: 'Empieza a trabajar',   hint: 'arranca un turno' },
  limit:     { label: 'Se queda sin cupo',    hint: 'llega al límite de uso de la cuenta' },
  lost:      { label: 'Se cae',               hint: 'la máquina cerró su proceso' },
};

// Each action: the words, the MCP tool it becomes, and which fields it needs.
export const ACTIONS = {
  send:      { label: 'Mandar un prompt',   icon: '✉', tool: 'fleet_send',      needs: ['project', 'session', 'prompt'] },
  spawn:     { label: 'Crear una sesión',   icon: '＋', tool: 'fleet_spawn',     needs: ['project', 'name'], optional: ['prompt', 'branch'] },
  pause:     { label: 'Pausar',             icon: '⏸', tool: 'fleet_pause',     needs: ['project', 'session'] },
  resume:    { label: 'Reanudar',           icon: '▶', tool: 'fleet_resume',    needs: ['project', 'session'], optional: ['prompt'] },
  wake:      { label: 'Despertar',          icon: '☀', tool: 'fleet_wake',      needs: ['project', 'session'] },
  interrupt: { label: 'Interrumpir',        icon: '✋', tool: 'fleet_interrupt', needs: ['project', 'session'] },
  reopen:    { label: 'Reabrir si se cayó', icon: '↻', tool: 'fleet_reopen',    needs: ['project', 'session'] },
  stop:      { label: 'Detener',            icon: '■', tool: 'fleet_stop',      needs: ['project', 'session'], danger: true },
  check:     { label: 'Seguir solo si…',    icon: '❓', tool: null,              needs: ['project', 'session', 'status'] },
  notify:    { label: 'Avisarme',           icon: '🔔', tool: null,              needs: ['text'] },
  wait:      { label: 'Esperar',            icon: '⏱', tool: null,              needs: ['minutes'] },
};

// What a "Seguir solo si…" step can ask a session to be (the digest's statuses).
export const STATES = {
  'need-you': 'te necesita', working: 'trabajando', ready: 'lista', idle: 'inactiva', parked: 'en pausa',
  limit: 'sin cupo', interrupted: 'interrumpida', asleep: 'dormida', lost: 'caída',
};

export const LIMITS = { steps: 20, prompt: 4000, name: 80, text: 300, waitMin: 60, cooldownMin: 1440 };
export const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const SESSION_OK = /^[A-Za-z0-9][A-Za-z0-9 ._~-]{0,47}$/;
const TEMPLATE_OK = /^[A-Za-z0-9{}][A-Za-z0-9 ._~{}-]{0,79}$/;     // a name that may hold {fecha}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const bad = (text) => Object.assign(new Error(text), { status: 400 });

export const blankTrigger = (type = 'schedule') => (type === 'event'
  ? { type: 'event', event: 'finished', project: '*', session: '*', cooldown: 10 }
  : { type: 'schedule', mode: 'days', at: '10:00', days: [1, 2, 3, 4, 5], date: '', minutes: 60 });
export const blankStep = (action) => ({ action, project: '', session: '', prompt: '', name: '', branch: '',
  minutes: action === 'wait' ? 5 : 0, text: '', status: action === 'check' ? ['need-you'] : [], confirmed: false });

// Clean an automation as written into one the runner can trust; throws a 400 with the words
// a person can act on. `strict` (saving an enabled one) also requires every field filled.
export function normalize(raw, { strict = true } = {}) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const name = str(a.name, LIMITS.name) || 'Automatización sin nombre';
  const t = a.trigger && typeof a.trigger === 'object' ? a.trigger : {};
  let trigger;
  if (t.type === 'event') {
    if (!EVENTS[t.event]) throw bad(`evento desconocido: ${t.event}`);
    const project = str(t.project, 80) || '*', session = str(t.session, 48) || '*';
    if (session !== '*' && !SESSION_OK.test(session)) throw bad(`nombre de sesión inválido en el disparador: '${session}'`);
    const cooldown = Math.max(1, Math.min(LIMITS.cooldownMin, Math.round(Number(t.cooldown) || 10)));
    trigger = { type: 'event', event: t.event, project, session, cooldown };
  } else {
    const mode = ['once', 'days', 'every'].includes(t.mode) ? t.mode : 'days';
    const at = HHMM.test(t.at) ? t.at : '10:00';
    const days = [...new Set((Array.isArray(t.days) ? t.days : []).map(Number).filter(d => d >= 0 && d <= 6))].sort();
    const date = DATE.test(t.date) ? t.date : '';
    const minutes = Math.max(15, Math.min(7 * 1440, Math.round(Number(t.minutes) || 60)));
    if (strict && mode === 'once' && !date) throw bad('falta la fecha de la ejecución única');
    if (strict && mode === 'days' && !days.length) throw bad('elige al menos un día de la semana');
    trigger = { type: 'schedule', mode, at, days, date, minutes };
  }
  const list = Array.isArray(a.steps) ? a.steps : [];
  if (list.length > LIMITS.steps) throw bad(`como mucho ${LIMITS.steps} pasos`);
  const steps = list.map((s, i) => {
    const action = s?.action;
    const def = ACTIONS[action];
    if (!def) throw bad(`paso ${i + 1}: acción desconocida '${action}'`);
    const o = { action };
    if (def.needs.includes('project')) o.project = str(s.project, 80);
    if (def.needs.includes('session')) {
      o.session = str(s.session, 48);
      if (o.session && o.session !== '{sesion}' && !SESSION_OK.test(o.session)) throw bad(`paso ${i + 1}: nombre de sesión inválido '${o.session}'`);
    }
    if (def.needs.includes('prompt') || def.optional?.includes('prompt')) o.prompt = str(s.prompt, LIMITS.prompt);
    if (def.needs.includes('name')) {
      o.name = str(s.name, 80);
      if (o.name && !TEMPLATE_OK.test(o.name)) throw bad(`paso ${i + 1}: el nombre de la sesión solo puede tener letras, números, espacios y . _ ~ -`);
    }
    if (def.optional?.includes('branch')) o.branch = str(s.branch, 80);
    if (action === 'wait') o.minutes = Math.max(1, Math.min(LIMITS.waitMin, Math.round(Number(s.minutes) || 1)));
    if (action === 'notify') o.text = str(s.text, LIMITS.text);
    if (action === 'check') o.status = [...new Set((Array.isArray(s.status) ? s.status : []).filter(x => STATES[x]))];
    if (def.danger) o.confirmed = s.confirmed === true;
    if (strict) {
      for (const f of def.needs) if (o[f] === '' || o[f] == null || (Array.isArray(o[f]) && !o[f].length)) throw bad(`paso ${i + 1} (${def.label}): falta ${FIELD[f] || f}`);
      if (def.danger && !o.confirmed) throw bad(`paso ${i + 1}: «${def.label}» necesita que lo confirmes`);
      if ((o.project === '{proyecto}' || o.session === '{sesion}') && trigger.type !== 'event')
        throw bad(`paso ${i + 1}: «la sesión del evento» solo existe cuando el disparador es un evento`);
    }
    return o;
  });
  if (strict && !steps.length) throw bad('agrega al menos una acción');
  return {
    id: str(a.id, 40) || null, name, enabled: a.enabled !== false,
    visibility: a.visibility === 'team' ? 'team' : 'personal', trigger, steps,
  };
}
const FIELD = { status: 'al menos un estado', project: 'el proyecto', session: 'la sesión', prompt: 'el mensaje', name: 'el nombre', text: 'el texto del aviso', minutes: 'los minutos' };

// ── when ─────────────────────────────────────────────────────────────────────────────
const localAt = (y, m, d, hhmm) => { const [h, mi] = hhmm.split(':').map(Number); return Math.floor(new Date(y, m, d, h, mi, 0).getTime() / 1000); };

// The first time the trigger fires strictly after `t` (epoch seconds), or null if never.
// `anchor` is when an "every N minutes" one started counting.
export function nextAfter(trigger, t, anchor = t) {
  if (!trigger || trigger.type !== 'schedule') return null;
  if (trigger.mode === 'once') {
    if (!trigger.date) return null;
    const [y, m, d] = trigger.date.split('-').map(Number);
    const at = localAt(y, m - 1, d, trigger.at);
    return at > t ? at : null;
  }
  if (trigger.mode === 'every') {
    const step = trigger.minutes * 60;
    const k = Math.floor((t - anchor) / step) + 1;
    return anchor + Math.max(1, k) * step;
  }
  const base = new Date(t * 1000);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (!trigger.days.includes(d.getDay())) continue;
    const at = localAt(d.getFullYear(), d.getMonth(), d.getDate(), trigger.at);
    if (at > t) return at;
  }
  return null;
}

// ── words ────────────────────────────────────────────────────────────────────────────
const anyOr = (v, word) => (!v || v === '*' ? word : v);
function daysWords(days) {
  const s = [...days].sort().join(',');
  if (s === '0,1,2,3,4,5,6') return 'todos los días';
  if (s === '1,2,3,4,5') return 'de lunes a viernes';
  if (s === '0,6') return 'los fines de semana';
  return 'los ' + days.map(d => DAY_NAMES[d]).join(', ');
}
export function describeTrigger(t) {
  if (!t) return '';
  if (t.type === 'event') {
    const who = t.session && t.session !== '*' ? `la sesión ${t.session}` : 'cualquier sesión';
    return `Cuando ${who} de ${anyOr(t.project, 'cualquier proyecto')} ${EVENTS[t.event]?.label.toLowerCase() || t.event}`;
  }
  if (t.mode === 'once') return `Una vez, el ${t.date ? t.date.split('-').reverse().join('/') : '?'} a las ${t.at}`;
  if (t.mode === 'every') {
    const m = t.minutes;
    return `Cada ${m % 1440 === 0 ? `${m / 1440} día${m > 1440 ? 's' : ''}` : m % 60 === 0 ? `${m / 60} h` : `${m} min`}`;
  }
  return `${daysWords(t.days)[0].toUpperCase()}${daysWords(t.days).slice(1)} a las ${t.at}`;
}
const where = (s) => `${s.session === '{sesion}' ? 'la sesión del evento' : s.session || '?'}${s.project && s.project !== '{proyecto}' ? ` (${s.project})` : ''}`;
export function describeStep(s) {
  const d = ACTIONS[s.action];
  if (!d) return s.action;
  switch (s.action) {
    case 'send': return `Mandar a ${where(s)}: «${String(s.prompt || '').slice(0, 60)}${(s.prompt || '').length > 60 ? '…' : ''}»`;
    case 'spawn': return `Crear la sesión ${s.name || '?'} en ${s.project || '?'}${s.prompt ? ' con una tarea' : ''}`;
    case 'notify': return `Avisarme: «${String(s.text || '').slice(0, 60)}»`;
    case 'wait': return `Esperar ${s.minutes} min`;
    case 'check': return `Seguir solo si ${where(s)} está ${(s.status || []).map(x => STATES[x] || x).join(' o ') || '?'}`;
    default: return `${d.label} ${where(s)}`;
  }
}

// {fecha} {hora} {proyecto} {sesion} in a prompt, a name or a notice.
export function fill(text, ctx) {
  const d = new Date((ctx.at || Date.now() / 1000) * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  const vars = { fecha: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, hora: `${p2(d.getHours())}:${p2(d.getMinutes())}`,
                 proyecto: ctx.project || '', sesion: ctx.session || '' };
  return String(text || '').replace(/\{(fecha|hora|proyecto|sesion)\}/g, (_, k) => vars[k]);
}
