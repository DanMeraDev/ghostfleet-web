// The assistant, once for the whole app. The home page and the side panel are two views of
// this one object, so a conversation started on one is the same conversation on the other.
//
// A CONVERSATION HAS ONE OFF SWITCH. Hands-free used to re-arm the microphone from three
// places (after a reply was read, after a send, after silence), and "stop" only stopped the
// one in progress — so it went on listening, or started talking again. Now every re-arm
// asks `S.conversing` first, and stop() clears it, cancels every timer and silences
// everything at once.
import { useState, useEffect } from 'preact/hooks';
import { api } from './api.js';
import { STATUS, statusOf } from './ui.jsx';
import { voiceStatus, listenLocal, listenBrowser, browserCanHear, speak, stopSpeaking, warmVad, PAUSES } from './voice.js';
import { resolve } from './resolve.js';

const store = {
  get: (k, d) => { try { const v = localStorage.getItem(`gfw.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`gfw.${k}`, JSON.stringify(v)); } catch {} },
};

export const S = {
  target: store.get('target', ''),      // the project whose lead is being talked to
  targetAt: 0,                          // when it was last chosen, explicitly
  feed: [],
  phase: 'idle',                        // listening | hearing | sending | starting | speaking | idle
  level: 0, interim: '',
  cards: [], focus: 'master',
  pending: null,                        // work said before saying where
  conversing: false,
  voiceOut: store.get('voiceOut', true),
  handsFree: store.get('handsFree', false),
  follow: store.get('follow', true),
  pause: PAUSES[store.get('pause', 'normal')] ? store.get('pause', 'normal') : 'normal',   // key of PAUSES
  vs: null,
};
const subs = new Set();
function set(patch) { Object.assign(S, patch); for (const f of subs) f(); }
export function useAgent() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(x => x + 1); subs.add(f); return () => subs.delete(f); }, []);
  return S;
}

let ctx = null;              // { go, me, projects, route }
let mic = null;
// Bumped by stop(). Anything started before it — a transcript still on its way back from
// whisper, a sentence Kokoro is still making, a re-arm on a timer — checks it and drops itself,
// so nothing said before "Detener" can act after it.
let gen = 0;
const timers = new Set();
const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
const push = (e) => set({ feed: [...S.feed.slice(-60), { id: Math.random(), at: Date.now(), ...e }] });
const projects = () => ctx?.projects || [];
const go = (to) => ctx?.go(to);

// What the lead is told along with the words, so it answers in a way that reads aloud well
// and treats a big ask as work to hand out rather than to do in its own turn.
const frame = (text, voice) =>
  `${voice ? '🎙' : '💬'} ${ctx.me.name}, ${voice ? 'por voz' : 'por el asistente'} desde ghostfleet web. ` +
  `Responde breve y en español (se lee en voz alta). Si la tarea es grande, repártela en sesiones nuevas (fleet_spawn) ` +
  `y dime qué abriste.\n\n${text}`;
export const unframe = (t) => String(t || '').replace(/^(🎙|💬)[^\n]*\n\n/, '');

// ── settings ────────────────────────────────────────────────────────────────────────────
export function setOption(k, v) {
  store.set(k, v);
  set({ [k]: v });
  if (k === 'handsFree' && !v) set({ conversing: false });
  if (k === 'voiceOut' && !v) { stopSpeaking(); if (S.phase === 'speaking') set({ phase: 'idle' }); }
}
export function setTarget(project, explicit = true) {
  if (!project) return;
  if (project !== S.target) { store.set('target', project); set({ target: project, cards: [], focus: 'master' }); resetWatch(); }
  if (explicit) set({ targetAt: Date.now() });
}

// ── voice in ────────────────────────────────────────────────────────────────────────────
export const canHear = () => !!S.vs?.hear?.ready || browserCanHear;
export function talk() {                      // the big button: start, or finish what is being said
  if (mic) { mic.stop(); return; }
  set({ conversing: S.handsFree });
  listen();
}
function listen() {
  if (mic) return;
  stopSpeaking();
  set({ interim: '', level: 0, phase: 'listening' });
  const my = gen;
  const common = {
    pauseMs: PAUSES[S.pause].ms,
    onState: (s) => { if (my === gen) set({ phase: s }); },
    onError: (m) => { if (my !== gen) return; push({ kind: 'event', text: m, bad: true }); set({ conversing: false }); },
    onText: (t) => {
      if (my !== gen) return;
      mic = null;
      set({ level: 0, interim: '', phase: 'idle' });
      if (t) heard(t, true);
      else if (S.conversing) { set({ conversing: false }); push({ kind: 'event', text: 'No escuché nada, dejo de escuchar. Toca Hablar para seguir.' }); }
    },
  };
  mic = S.vs?.hear?.ready
    ? listenLocal({ ...common, onLevel: (l) => { if (my === gen) set({ level: l }); } })
    : listenBrowser({ ...common, onInterim: (t) => { if (my === gen) set({ interim: t }); } });
}
const again = () => { const my = gen; if (S.conversing && S.handsFree) later(450, () => { if (my === gen && S.conversing) listen(); }); };

// Stop everything: the microphone, the voice, the hands-free loop, anything scheduled.
export function stop() {
  gen++;
  set({ conversing: false });
  for (const t of timers) clearTimeout(t);
  timers.clear();
  if (mic) { const m = mic; mic = null; m.cancel(); }
  stopSpeaking();
  set({ phase: 'idle', interim: '', level: 0 });
}
export const busy = () => !!mic || S.phase === 'speaking' || S.conversing;

// ── voice out ───────────────────────────────────────────────────────────────────────────
function say(text, then) {
  if (!S.voiceOut) { then?.(); return; }
  const my = gen;
  set({ phase: 'speaking' });
  speak(text, () => { if (my !== gen) return; if (S.phase === 'speaking') set({ phase: 'idle' }); then?.(); });
}

// ── understanding ───────────────────────────────────────────────────────────────────────
// The project in front of the person, or the one they picked in the last quarter hour.
const context = () => ctx?.route?.project || (S.target && Date.now() - S.targetAt < 15 * 60e3 ? S.target : null);

export function submit(text, voice = false) {
  const t = String(text || '').trim();
  if (t) heard(t, voice);
}
export function choose(project) {           // a project tapped in the list
  setTarget(project);
  if (S.pending) { const p = S.pending; set({ pending: null }); deliver(project, p.text, p.voice); return; }
  go(`/p/${encodeURIComponent(project)}`);
  push({ kind: 'event', text: `Le hablas al líder de ${project}.` });
}

function heard(text, voice) {
  push({ kind: 'me', text, voice });
  const r = resolve(text, projects(), context());
  if (!r) return;
  if (r.kind === 'go') {
    if (r.go) go(r.go);
    if (r.project) setTarget(r.project, false);
    if (r.session) set({ focus: r.session });
    push({ kind: 'event', text: r.say });
    say(r.say, again);
    return;
  }
  if (r.kind === 'place') {
    setTarget(r.project);
    go(`/p/${encodeURIComponent(r.project)}`);
    if (S.pending) { const p = S.pending; set({ pending: null }); deliver(r.project, p.text, p.voice); return; }
    push({ kind: 'event', text: r.say });
    say(r.say, again);
    return;
  }
  if (r.kind === 'ask') {
    set({ pending: { text, voice } });
    push({ kind: 'event', text: r.say, ask: true });
    say(r.say, again);
    return;
  }
  setTarget(r.project);
  deliver(r.project, text, voice);
}

async function deliver(project, text, voice) {
  if (!ctx?.route?.session || ctx.route.project !== project) go(`/p/${encodeURIComponent(project)}`);
  push({ kind: 'event', text: `Se lo paso al líder de ${project}.` });
  set({ phase: 'starting', focus: 'master' });
  let lead = 'master';
  try {
    const l = await api.lead(project);
    if (l.started) push({ kind: 'event', text: l.started === 'start' ? `Arranqué el líder de ${project}.` : `Desperté al líder de ${project}.` });
    lead = l.lead || 'master';
  } catch (e) {
    set({ phase: 'idle' });
    push({ kind: 'event', text: `No pude arrancar el líder de ${project}: ${e.message}`, bad: true });
    say(`No pude arrancar el líder de ${project}.`, again);
    return;
  }
  set({ phase: 'sending' });
  try {
    sentAt = Math.floor(Date.now() / 1000);
    leadName = lead;
    const r = await api.act('fleet_send', { project, session: lead, prompt: frame(text, voice) });
    if (r.queued) push({ kind: 'event', text: r.queued === 'question' ? 'Quedó en cola: el líder tiene una pregunta pendiente.' : 'Quedó en cola: el líder termina su turno y lo toma.' });
    set({ phase: 'idle' });
    if (voice) say(`Listo, se lo pasé al líder de ${project}.`, again); else again();
  } catch (e) {
    set({ phase: 'idle' });
    push({ kind: 'event', text: `No llegó: ${e.message}`, bad: true });
  }
}

// ── watching: the target's fleet, and the lead's replies ────────────────────────────────
let prev = null, sentAt = 0, seenAi = 0, leadName = 'master', lastGo = 0, loop = null;
function resetWatch() { prev = null; seenAi = Math.floor(Date.now() / 1000); }

async function tick() {
  if (!S.target || document.hidden) return;
  const project = S.target;
  let g;
  try { g = await api.grid(project); } catch { return; }
  if (project !== S.target) return;
  const list = g.cards || [];
  set({ cards: list });
  const before = prev;
  prev = Object.fromEntries(list.map(c => [c.name, statusOf(c)]));
  if (before) {
    for (const c of list) {
      const now = statusOf(c), was = before[c.name];
      if (was === now) continue;
      const word = (STATUS[now] || STATUS.unknown).label.toLowerCase();
      push({ kind: 'event', text: was == null ? `Abrió la sesión ${c.name}` : c.lead ? `El líder está ${word}` : `${c.name}: ${word}`, session: c.name, project });
      set({ focus: c.name });
      // A session the lead opened because of what this person asked is that person's.
      if (was == null && !c.lead && !c.owner && sentAt && Date.now() / 1000 - sentAt < 900) api.assign(project, c.name, ctx.me.id).catch(() => {});
      const worth = was == null || now === 'need-you' || (now === 'working' && !c.lead);
      if (S.follow && worth && !c.lead && Date.now() - lastGo > 3000) { lastGo = Date.now(); go(`/p/${encodeURIComponent(project)}/s/${encodeURIComponent(c.name)}`); }
    }
  }
  if (!sentAt) return;
  let s;
  try { s = await api.session(project, leadName); } catch { return; }
  const fresh = (s.messages || []).filter(m => m.role === 'assistant' && m.ts > seenAi && m.ts >= sentAt - 5);
  if (!fresh.length) return;
  seenAi = Math.max(...fresh.map(m => m.ts));
  for (const m of fresh) push({ kind: 'ai', text: m.text, project });
  if (!mic) say(fresh[fresh.length - 1].text, again);
}

export function bind(next) {
  ctx = next;
  if (!loop) {
    loop = setInterval(tick, 2500);
    resetWatch();
    voiceStatus(true).then(vs => { set({ vs }); if (vs.hear?.ready) warmVad(); });
  }
}
export function unbind() { stop(); clearInterval(loop); loop = null; ctx = null; }
