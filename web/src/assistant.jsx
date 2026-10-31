import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { api } from './api.js';
import { STATUS, statusOf, Btn, toast } from './ui.jsx';

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
export function Ship({ size = 64, state = 'idle' }) {
  return (
    <span class={`ship st-${state}`} style={{ width: size, height: size / 2 }}>
      <svg viewBox="0 0 32 16" width={size} height={size / 2} shape-rendering="crispEdges" aria-hidden="true">
        {PIXELS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />)}
      </svg>
    </span>
  );
}

// ── voice in: the browser's own recogniser (Chrome, Edge, Safari) ──────────────────────
const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
function useListener({ lang, onFinal }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const rec = useRef(null);
  const final = useRef('');
  const cb = useRef(onFinal); cb.current = onFinal;
  const start = () => {
    if (!Recognition || listening) return;
    const r = new Recognition();
    r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    final.current = '';
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final.current += t; else live += t;
      }
      setInterim((final.current + ' ' + live).trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed') toast('El navegador no dio permiso al micrófono. Actívalo en el candado de la barra de direcciones.', 'bad');
      else if (e.error === 'network') toast('El dictado del navegador necesita internet (Chrome lo procesa en sus servidores).', 'bad');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast(`Dictado: ${e.error}`, 'bad');
    };
    r.onend = () => {
      setListening(false);
      const t = final.current.trim();
      setInterim('');
      if (t) cb.current(t);
    };
    rec.current = r;
    try { r.start(); setListening(true); } catch { setListening(false); }
  };
  const stop = () => { try { rec.current?.stop(); } catch {} };
  useEffect(() => () => { try { rec.current?.abort(); } catch {} }, []);
  return { supported: !!Recognition, listening, interim, start, stop };
}

// ── voice out: speechSynthesis, a Spanish voice when the machine has one ───────────────
const plainText = (md) => String(md || '')
  .replace(/```[\s\S]*?```/g, ' (código) ')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/[*_#>|]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
function speak(text, onEnd) {
  const s = window.speechSynthesis;
  if (!s) { onEnd?.(); return; }
  s.cancel();
  const u = new SpeechSynthesisUtterance(plainText(text).slice(0, 900));
  const v = s.getVoices().find(v => /^es(-|_)(419|MX|US|EC|CO|AR)/i.test(v.lang)) || s.getVoices().find(v => /^es/i.test(v.lang));
  if (v) u.voice = v;
  u.lang = v?.lang || 'es-ES'; u.rate = 1.05;
  u.onend = () => onEnd?.(); u.onerror = () => onEnd?.();
  s.speak(u);
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

const STATE_WORDS = { listening: 'Te escucho…', sending: 'Enviando…', thinking: 'Pensando…', acting: 'Trabajando', speaking: 'Hablando', idle: 'Listo', off: 'Sin líder' };

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

  const [feed, setFeed] = useState([]);
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState('idle');     // sending | speaking | idle (listening comes from the hook)
  const [cards, setCards] = useState([]);
  const [focus, setFocus] = useState('master');
  const sentAt = useRef(0);
  const seenAi = useRef(0);
  const prev = useRef(null);
  const lastGo = useRef(0);
  const push = (e) => setFeed(f => [...f.slice(-40), { id: Math.random(), at: Date.now(), ...e }]);

  const listener = useListener({ lang: 'es-ES', onFinal: (t) => send(t, true) });

  // The fleet, watched: every new session and every change of status is an event the ship
  // sails to — and, when following, the page goes there too.
  useEffect(() => {
    if (!target) return undefined;
    prev.current = null; setCards([]); setFeed([]); seenAi.current = Math.floor(Date.now() / 1000);
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
        // A session the lead opened because of what this person asked is that person's.
        if (was == null && !c.lead && !c.owner && sentAt.current && Date.now() / 1000 - sentAt.current < 900)
          api.assign(target, c.name, ctx.me.id).catch(() => {});
        setFocus(c.name);
        const worth = was == null || now === 'need-you' || (now === 'working' && !c.lead);
        if (follow && worth && !c.lead && Date.now() - lastGo.current > 3000) {
          lastGo.current = Date.now();
          ctx.go(`/p/${encodeURIComponent(target)}/s/${encodeURIComponent(c.name)}`);
        }
      }
    };
    tick();
    const t = setInterval(() => { if (!document.hidden) tick(); }, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [target, follow]);

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
      const last = fresh[fresh.length - 1].text;
      if (voiceOut) {
        setPhase('speaking');
        speak(last, () => { setPhase('idle'); if (handsFree) setTimeout(() => listener.start(), 350); });
      } else if (handsFree) setTimeout(() => listener.start(), 350);
    };
    const t = setInterval(() => { if (!document.hidden) tick(); }, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [target, voiceOut, handsFree]);

  async function send(text, voice) {
    const t = String(text || '').trim();
    if (!t || !target) return;
    window.speechSynthesis?.cancel();
    push({ kind: 'me', text: t, voice });
    setPhase('sending'); setFocus('master');
    try {
      sentAt.current = Math.floor(Date.now() / 1000);
      const r = await api.act('fleet_send', { project: target, session: 'master', prompt: frame(ctx.me, t, voice) });
      if (r.queued) push({ kind: 'event', text: r.queued === 'question' ? 'Quedó en cola: el líder tiene una pregunta pendiente.' : 'Quedó en cola: el líder termina su turno y lo toma.' });
    } catch (e) { push({ kind: 'event', text: `No llegó: ${e.message}`, bad: true }); }
    setPhase('idle');
  }

  const master = cards.find(c => c.lead);
  const mst = master ? statusOf(master) : null;
  const state = listener.listening ? 'listening'
    : phase === 'sending' ? 'sending' : phase === 'speaking' ? 'speaking'
    : !master ? 'off' : mst === 'working' ? (focus !== 'master' ? 'acting' : 'thinking') : mst === 'need-you' ? 'thinking' : 'idle';
  const lane = [...cards].sort((a, b) => Number(b.lead) - Number(a.lead));
  const at = Math.max(0, lane.findIndex(c => c.name === focus));
  const feedRef = useRef(null);
  useEffect(() => { const n = feedRef.current; if (n) n.scrollTop = n.scrollHeight; }, [feed.length]);

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
                      title={`${c.name} · ${(STATUS[s] || STATUS.unknown).label}`}
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
            <p class="muted">Por ejemplo: “Revisa los tests de pagos y arregla los que fallen” o “Abre una sesión para el login con Google y otra para el PDF de cotización”.</p>
            <p class="muted">El líder decide, abre las sesiones que hagan falta y te va contando. El barco va a donde está trabajando.</p>
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
        {listener.interim ? <div class="as-row me live"><span class="tag-me">🎙</span> {listener.interim}…</div> : null}
      </div>

      <div class="as-controls">
        <button class={`mic${listener.listening ? ' on' : ''}`} disabled={!listener.supported || !target}
                onClick={() => (listener.listening ? listener.stop() : listener.start())}
                aria-label={listener.listening ? 'Dejar de escuchar' : 'Hablar'}>
          <span class="mic-ico">{listener.listening ? '■' : '🎙'}</span>
          <span>{listener.listening ? 'Escuchando… (clic para terminar)' : 'Hablar'}</span>
        </button>
        {!listener.supported ? <p class="muted small">Este navegador no permite dictado. Usa Chrome o Edge, o escríbele abajo.</p> : null}
        <form class="row" onSubmit={(e) => { e.preventDefault(); send(typed, false); setTyped(''); }}>
          <input class="grow" value={typed} onInput={(e) => setTyped(e.currentTarget.value)} placeholder="…o escríbele aquí" disabled={!target} />
          <Btn kind="primary" type="submit" disabled={!typed.trim() || !target}>Enviar</Btn>
        </form>
        <div class="toggles">
          <label><input type="checkbox" checked={voiceOut} onChange={(e) => setVoiceOut(e.currentTarget.checked)} /> Responder en voz alta</label>
          <label><input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.currentTarget.checked)} /> Manos libres (vuelve a escuchar)</label>
          <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.currentTarget.checked)} /> Seguirlo en vivo por las sesiones</label>
        </div>
      </div>
    </aside>
  );
}
