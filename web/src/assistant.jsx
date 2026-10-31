import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { api } from './api.js';
import { STATUS, statusOf, Btn } from './ui.jsx';
import { voiceStatus, listenLocal, listenBrowser, browserCanHear, speak, stopSpeaking, plainText } from './voice.js';

// ── the avatar: ghostfleet's own SHIP sprite (bin/fleet-grid.mjs), pixel for pixel ─────
// Half-blocks carry two pixel rows per text row: ▀ the top one, ▄ the bottom, █ both.
const SHIP = [
  '         ▄▄▄▄▄▄█                ',
  '         ▀▀▀▀▀ █                ',
  '          ▄▄███████▄▄▄          ',
  '       ▄██████ ███ ████▄      ▄▀',
  '     ▄██████████████████    ▄▀  ',
  '   ▄██▀▀████▀▀████▀▀███   ▄▀    ',
  '▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▀      ',
  '  ▀▀▀█████████████████▀▀        ',
];
const PIXELS = (() => {
  const px = [];
  SHIP.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '▀' || ch === '█') px.push([x, y * 2]);
    if (ch === '▄' || ch === '█') px.push([x, y * 2 + 1]);
  }));
  return px;
})();
export function Ship({ size = 64, state = 'idle', title }) {
  return (
    <span class={`ship st-${state}`} style={{ width: size, height: size / 2 }} title={title}>
      <svg viewBox="0 0 32 16" width={size} height={size / 2} shape-rendering="crispEdges" aria-hidden="true">
        {PIXELS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />)}
      </svg>
    </span>
  );
}

const store = {
  get: (k, d) => { try { const v = localStorage.getItem(`gfw.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`gfw.${k}`, JSON.stringify(v)); } catch {} },
};

// What the lead is told along with the words, so it answers in a way that reads aloud well
// and treats a big ask as work to hand out rather than to do in its own turn.
const frame = (me, text, voice) =>
  `${voice ? '🎙' : '💬'} ${me.name}, ${voice ? 'por voz' : 'por el asistente'} desde ghostfleet web. ` +
  `Responde breve y en español (se lee en voz alta). Si la tarea es grande, repártela en sesiones nuevas (fleet_spawn) ` +
  `y dime qué abriste.\n\n${text}`;
const unframe = (t) => String(t || '').replace(/^(🎙|💬)[^\n]*\n\n/, '');

// ── what the app does itself, without asking anybody: getting around ───────────────────
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Names are matched loosely on purpose: whisper hears "stripe-billing" as "stripe bilging".
const grams = (s) => { const t = ` ${s} `; const g = new Map(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
function dice(a, b) {
  const A = grams(a), B = grams(b); let both = 0, n = 0;
  for (const [k, v] of A) { n += v; both += Math.min(v, B.get(k) || 0); }
  for (const v of B.values()) n += v;
  return n ? (2 * both) / n : 0;
}
function best(name, options) {
  const n = norm(name);
  if (!n) return null;
  let hit = null, score = 0;
  for (const o of options) {
    const k = norm(o);
    const s = k === n ? 2 : (k.startsWith(n) || n.startsWith(k)) && Math.min(k.length, n.length) >= 3 ? 1.5 : dice(k, n);
    if (s > score) { hit = o; score = s; }
  }
  return score >= 0.6 ? hit : null;
}
export function intentOf(text, projects, target) {
  const t = norm(text);
  if (t.split(' ').length > 9) return null;
  if (/^(muestrame |abre |ve a |ir a |vamos a |llevame a )?(el )?mapa( en vivo)?$/.test(t)) return { go: '/mapa', say: 'Abro el mapa en vivo.' };
  if (/^(ve |vamos |llevame |volver )?(al )?inicio$/.test(t)) return { go: '/', say: 'Vamos al inicio.' };
  if (/^(muestrame |abre |ve a )?(la )?actividad$/.test(t)) return { go: '/actividad', say: 'Abro la actividad.' };
  const names = (projects || []).map(p => p.name);
  let m = /^(?:habla(?:me)? con|hablar con|cambia(?:te)? al?) (?:el )?lider (?:de|del) (?:proyecto )?(.+)$/.exec(t);
  if (m) { const p = best(m[1], names); if (p) return { target: p, go: `/p/${encodeURIComponent(p)}`, say: `Ahora le hablas al líder de ${p}.` }; }
  m = /^(?:abre|ve a|vamos a|llevame a|muestrame|ensename|cambia a|pasa a|anda a) (?:la )?sesion (.+)$/.exec(t);
  if (m) {
    // this project's sessions first, then everybody's
    const here = (projects || []).find(p => p.name === target)?.sessions.map(s => s.name) || [];
    let s = best(m[1], here), where = target;
    if (!s) {
      const all = (projects || []).flatMap(p => p.sessions.map(x => ({ p: p.name, s: x.name })));
      const k = best(m[1], all.map(x => `${x.s}`));
      const hit = k && all.find(x => x.s === k);
      if (hit) { s = hit.s; where = hit.p; }
    }
    if (s && where) return { go: `/p/${encodeURIComponent(where)}/s/${encodeURIComponent(s)}`, say: `Abro ${s}${where !== target ? ` en ${where}` : ''}.` };
    return { say: `No encontré una sesión parecida a “${m[1]}”.` };
  }
  m = /^(?:abre|ve a|vamos a|llevame a|muestrame|ensename|cambia a|pasa a|anda a) (?:el )?(?:proyecto )?(.+)$/.exec(t);
  if (m) {
    const p = best(m[1], names);
    if (p) return { go: `/p/${encodeURIComponent(p)}`, target: (projects.find(x => x.name === p)?.sessions || []).some(s => s.lead) ? p : null, say: `Vamos a ${p}.` };
  }
  return null;
}

const STATE_WORDS = { listening: 'Te escucho…', hearing: 'Transcribiendo…', sending: 'Enviando…', thinking: 'Pensando…',
                      acting: 'Trabajando', speaking: 'Hablando', idle: 'Listo', off: 'Sin líder' };

export function Assistant({ ctx, route, projects, onClose }) {
  const leads = useMemo(() => (projects || []).filter(p => p.sessions.some(s => s.lead)).map(p => p.name), [projects]);
  const [target, setTarget] = useState(() => store.get('target', ''));
  useEffect(() => {
    if (target && leads.includes(target)) return;
    const pick = leads.includes('jarvis') ? 'jarvis' : route.project && leads.includes(route.project) ? route.project : leads[0] || '';
    if (pick) setTarget(pick);
  }, [leads.join(','), route.project]);
  useEffect(() => { if (target) store.set('target', target); }, [target]);

  const [voiceOut, setVoiceOut] = useState(() => store.get('voiceOut', true));
  const [handsFree, setHandsFree] = useState(() => store.get('handsFree', false));
  const [follow, setFollow] = useState(() => store.get('follow', true));
  useEffect(() => store.set('voiceOut', voiceOut), [voiceOut]);
  useEffect(() => store.set('handsFree', handsFree), [handsFree]);
  useEffect(() => store.set('follow', follow), [follow]);

  const [vs, setVs] = useState(null);
  useEffect(() => { voiceStatus(true).then(setVs); }, []);
  const local = !!vs?.hear?.ready;
  const canHear = local || browserCanHear;

  const [feed, setFeed] = useState([]);
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState('idle');   // listening | hearing | sending | speaking | idle
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [cards, setCards] = useState([]);
  const [focus, setFocus] = useState('master');
  const sentAt = useRef(0);
  const seenAi = useRef(0);
  const prev = useRef(null);
  const lastGo = useRef(0);
  const mic = useRef(null);
  const live = useRef({});
  live.current = { handsFree, voiceOut, follow, target, projects };
  const push = (e) => setFeed(f => [...f.slice(-50), { id: Math.random(), at: Date.now(), ...e }]);

  const say = (text, then) => {
    if (!live.current.voiceOut) { then?.(); return; }
    setPhase('speaking');
    speak(text, () => { setPhase('idle'); then?.(); });
  };
  const rearm = () => { if (live.current.handsFree) setTimeout(() => startListening(), 400); };

  function startListening() {
    if (mic.current) return;
    stopSpeaking();
    setInterim(''); setLevel(0);
    const common = {
      onState: (s) => setPhase(s),
      onError: (m) => push({ kind: 'event', text: m, bad: true }),
      onText: (t) => { mic.current = null; setLevel(0); setInterim(''); setPhase('idle'); if (t) heard(t, true); else if (live.current.handsFree) rearm(); },
    };
    mic.current = local
      ? listenLocal({ ...common, onLevel: setLevel })
      : listenBrowser({ ...common, onInterim: setInterim });
  }
  const stopListening = () => mic.current?.stop();

  function heard(text, voice) {
    const it = intentOf(text, live.current.projects, live.current.target);
    if (it) {
      push({ kind: 'me', text, voice });
      if (it.target) setTarget(it.target);
      if (it.go) {
        ctx.go(it.go);
        const m = /^\/p\/([^/]+)\/s\/(.+)$/.exec(it.go);
        if (m && decodeURIComponent(m[1]) === live.current.target) setFocus(decodeURIComponent(m[2]));
      }
      push({ kind: 'event', text: it.say });
      say(it.say, rearm);
      return;
    }
    send(text, voice);
  }

  // The fleet, watched: every new session and every change of status is an event the ship
  // sails to — and, when following, the page goes there too.
  useEffect(() => {
    if (!target) return undefined;
    prev.current = null; setCards([]); seenAi.current = Math.floor(Date.now() / 1000);
    let alive = true;
    const tick = async () => {
      let g;
      try { g = await api.grid(target); } catch { return; }
      if (!alive) return;
      const list = g.cards || [];
      setCards(list);
      const before = prev.current;
      prev.current = Object.fromEntries(list.map(c => [c.name, statusOf(c)]));
      if (!before) return;
      for (const c of list) {
        const now = statusOf(c), was = before[c.name];
        if (was === now) continue;
        const word = (STATUS[now] || STATUS.unknown).label.toLowerCase();
        const text = was == null ? `Abrió la sesión ${c.name}` : c.lead ? `El líder está ${word}` : `${c.name}: ${word}`;
        push({ kind: 'event', text, session: c.name, status: now });
        setFocus(c.name);
        // A session the lead opened because of what this person asked is that person's.
        if (was == null && !c.lead && !c.owner && sentAt.current && Date.now() / 1000 - sentAt.current < 900)
          api.assign(target, c.name, ctx.me.id).catch(() => {});
        const worth = was == null || now === 'need-you' || (now === 'working' && !c.lead);
        if (live.current.follow && worth && !c.lead && Date.now() - lastGo.current > 3000) {
          lastGo.current = Date.now();
          ctx.go(`/p/${encodeURIComponent(target)}/s/${encodeURIComponent(c.name)}`);
        }
      }
    };
    tick();
    const t = setInterval(() => { if (!document.hidden) tick(); }, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [target]);

  // The lead's replies: anything it says after an instruction from here is shown, and read.
  useEffect(() => {
    if (!target) return undefined;
    let alive = true;
    const tick = async () => {
      if (!sentAt.current) return;
      let s;
      try { s = await api.session(target, 'master'); } catch { return; }
      if (!alive) return;
      const fresh = (s.messages || []).filter(m => m.role === 'assistant' && m.ts > seenAi.current && m.ts >= sentAt.current - 5);
      if (!fresh.length) return;
      seenAi.current = Math.max(...fresh.map(m => m.ts));
      for (const m of fresh) push({ kind: 'ai', text: m.text });
      if (!mic.current) say(fresh[fresh.length - 1].text, rearm);
    };
    const t = setInterval(() => { if (!document.hidden) tick(); }, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [target]);

  useEffect(() => () => { mic.current?.cancel(); stopSpeaking(); }, []);

  async function send(text, voice) {
    const t = String(text || '').trim();
    if (!t || !target) return;
    stopSpeaking();
    push({ kind: 'me', text: t, voice });
    setPhase('sending'); setFocus('master');
    try {
      sentAt.current = Math.floor(Date.now() / 1000);
      const r = await api.act('fleet_send', { project: target, session: 'master', prompt: frame(ctx.me, t, voice) });
      if (r.queued) push({ kind: 'event', text: r.queued === 'question' ? 'Quedó en cola: el líder tiene una pregunta pendiente.' : 'Quedó en cola: el líder termina su turno y lo toma.' });
    } catch (e) { push({ kind: 'event', text: `No llegó: ${e.message}`, bad: true }); }
    setPhase('idle');
    if (live.current.handsFree) rearm();
  }

  const master = cards.find(c => c.lead);
  const mst = master ? statusOf(master) : null;
  const state = ['listening', 'hearing', 'sending', 'speaking'].includes(phase) ? phase
    : !master ? 'off' : mst === 'working' ? (focus !== 'master' ? 'acting' : 'thinking') : mst === 'need-you' ? 'thinking' : 'idle';
  const lane = [...cards].sort((a, b) => Number(b.lead) - Number(a.lead));
  const at = Math.max(0, lane.findIndex(c => c.name === focus));
  const feedRef = useRef(null);
  useEffect(() => { const n = feedRef.current; if (n) n.scrollTop = n.scrollHeight; }, [feed.length, interim]);
  const listening = phase === 'listening' || phase === 'hearing';

  return (
    <aside class="assistant" aria-label="Asistente">
      <header class="as-head">
        <div><b>Asistente</b><small>{target === 'jarvis' ? 'Jarvis · todos los proyectos' : 'el líder del proyecto reparte el trabajo'}</small></div>
        <button class="x" aria-label="Cerrar asistente" onClick={onClose}>✕</button>
      </header>

      <label class="field as-target"><span>Le hablas a</span>
        <select value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
          {!leads.length ? <option value="">Ningún proyecto tiene su líder abierto</option> : null}
          {leads.map(n => <option key={n} value={n}>{n === 'jarvis' ? 'Jarvis (todos los proyectos)' : `Líder de ${n}`}</option>)}
        </select>
      </label>

      <div class={`sea st-${state}`}>
        <div class="ship-track" style={{ '--i': at, '--n': Math.max(lane.length, 1) }}>
          <Ship size={58} state={state} />
          <span class="ship-say">{STATE_WORDS[state]}{state === 'acting' && focus ? ` en ${focus}` : ''}</span>
        </div>
        <div class="lane" style={{ '--n': Math.max(lane.length, 1) }}>
          {lane.map(c => {
            const s = statusOf(c);
            return (
              <button key={c.name} class={`buoy c-${(STATUS[s] || STATUS.unknown).color}${c.name === focus ? ' on' : ''}`}
                      title={`${c.label || c.name} · ${(STATUS[s] || STATUS.unknown).label}`}
                      onClick={() => { setFocus(c.name); ctx.go(`/p/${encodeURIComponent(target)}/s/${encodeURIComponent(c.name)}`); }}>
                <b>{(STATUS[s] || STATUS.unknown).glyph}</b><span>{c.lead ? 'líder' : c.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div class="as-feed" ref={feedRef}>
        {!feed.length ? (
          <div class="as-hint">
            <p><b>Dile qué necesitas, como a un compañero.</b></p>
            <p class="muted">“Revisa los tests de pagos y arregla los que fallen” · “Abre una sesión para el login con Google”.</p>
            <p class="muted">También te muevo yo: “ve a vault-invers”, “abre la sesión stripe”, “muéstrame el mapa”, “habla con el líder de cotizador”.</p>
          </div>
        ) : null}
        {feed.map(e => (
          <div key={e.id} class={`as-row ${e.kind}${e.bad ? ' bad' : ''}`}
               onClick={e.session ? () => ctx.go(`/p/${encodeURIComponent(target)}/s/${encodeURIComponent(e.session)}`) : undefined}>
            {e.kind === 'me' ? <><span class="tag-me">{e.voice ? '🎙 tú' : 'tú'}</span> {unframe(e.text)}</>
              : e.kind === 'ai' ? <><span class="tag-ai">líder</span> {plainText(e.text)}</>
              : <><span class="tag-ev">en vivo</span> {e.text}</>}
          </div>
        ))}
        {interim ? <div class="as-row me live"><span class="tag-me">🎙</span> {interim}…</div> : null}
      </div>

      <div class="as-controls">
        <button class={`mic${listening ? ' on' : ''}`} disabled={!canHear || !target || phase === 'hearing'}
                onClick={() => (mic.current ? stopListening() : startListening())}
                aria-label={listening ? 'Terminar' : 'Hablar'}>
          <span class="mic-ico">{phase === 'hearing' ? '…' : listening ? '■' : '🎙'}</span>
          <span>{phase === 'hearing' ? 'Transcribiendo…' : listening ? 'Te escucho · termina solo cuando dejas de hablar' : 'Hablar'}</span>
          {phase === 'listening' && local ? <span class="meter"><i style={{ width: `${Math.round(level * 100)}%` }} /></span> : null}
        </button>
        <p class="voice-src muted small">
          {vs == null ? 'Revisando la voz…'
            : local ? '🔒 Voz local: se transcribe en esta máquina con whisper, el audio no sale de aquí.'
            : browserCanHear ? 'Voz del navegador (Chrome la procesa en sus servidores).'
            : 'Este navegador no trae dictado y no hay voz local instalada: escríbele abajo.'}
          {vs?.speak?.ready ? ' Responde con la voz de Kokoro.' : ''}
        </p>
        <form class="row" onSubmit={(e) => { e.preventDefault(); const t = typed; setTyped(''); const it = intentOf(t, projects, target); if (it) heard(t, false); else send(t, false); }}>
          <input class="grow" value={typed} onInput={(e) => setTyped(e.currentTarget.value)} placeholder="…o escríbele aquí" disabled={!target} />
          <Btn kind="primary" type="submit" disabled={!typed.trim() || !target}>Enviar</Btn>
        </form>
        <div class="toggles">
          <label><input type="checkbox" checked={voiceOut} onChange={(e) => { setVoiceOut(e.currentTarget.checked); if (!e.currentTarget.checked) stopSpeaking(); }} /> Responder en voz alta</label>
          <label><input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.currentTarget.checked)} /> Manos libres (vuelve a escuchar solo)</label>
          <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.currentTarget.checked)} /> Seguirlo en vivo por las sesiones</label>
        </div>
      </div>
    </aside>
  );
}
