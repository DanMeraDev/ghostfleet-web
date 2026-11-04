import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { STATUS, statusOf, Btn } from './ui.jsx';
import { plainText, browserCanHear, PAUSES } from './voice.js';
import { useAgent, talk, stop, submit, setTarget, setOption, canHear, busy, unframe } from './agent.js';
import { VoicePicker } from './voices.jsx';

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

const STATE_WORDS = { listening: 'Te escucho…', hearing: 'Transcribiendo…', routing: 'Viendo a dónde va…', sending: 'Enviando…', starting: 'Despertando al líder…',
                      thinking: 'Pensando…', acting: 'Trabajando', speaking: 'Hablando', idle: 'Listo', off: 'Sin líder abierto' };

export function shipStateOf(S) {
  if (['listening', 'hearing', 'routing', 'sending', 'starting', 'speaking'].includes(S.phase)) return S.phase;
  const master = S.cards.find(c => c.lead);
  if (!master) return 'off';
  const st = statusOf(master);
  if (st === 'working') return S.focus !== master.name ? 'acting' : 'thinking';
  return st === 'need-you' ? 'thinking' : 'idle';
}

// Projects in the order a person is likeliest to want them: what is moving, then the rest.
export function rankedProjects(projects) {
  const last = (p) => Math.max(0, ...p.sessions.map(s => s.ts || 0));
  return [...(projects || [])].sort((a, b) => (b.counts.need_you - a.counts.need_you) || (last(b) - last(a)) || a.name.localeCompare(b.name));
}

export function Console({ projects, big }) {
  const S = useAgent();
  const [typed, setTyped] = useState('');
  const [choosing, setChoosing] = useState(false);
  const listening = S.phase === 'listening' || S.phase === 'hearing';
  const active = busy() || listening;
  const local = !!S.vs?.hear?.ready;
  return (
    <div class={`console${big ? ' big' : ''}`}>
      <div class="console-row">
        <button class={`mic${listening ? ' on' : ''}`} disabled={!canHear() || S.phase === 'hearing'} onClick={talk}
                aria-label={listening ? 'Terminar de hablar' : 'Hablar'}>
          <span class="mic-ico">{S.phase === 'hearing' ? '…' : listening ? '✓' : '🎙'}</span>
          <span>{S.phase === 'hearing' ? 'Transcribiendo…' : listening ? (S.pause === 'manual' ? 'Te escucho — toca cuando termines' : 'Te escucho — habla tranquilo') : 'Hablar'}</span>
          {S.phase === 'listening' && local ? <span class="meter"><i style={{ width: `${Math.round(S.level * 100)}%` }} /></span> : null}
        </button>
        {active ? <button class="stop-all" onClick={stop} aria-label="Detener todo">■ Detener</button> : null}
      </div>
      <form class="row" onSubmit={(e) => { e.preventDefault(); const t = typed; setTyped(''); submit(t, false); }}>
        <input class="grow" value={typed} onInput={(e) => setTyped(e.currentTarget.value)}
               placeholder={big ? 'Escríbele: “vamos a practiq, revisa los tests de pagos”…' : '…o escríbele aquí'} />
        <Btn kind="primary" type="submit" disabled={!typed.trim()}>Enviar</Btn>
      </form>
      <Btn kind="sm voice-choose" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>{choosing ? 'Cerrar voces' : 'Elegir voz'}</Btn>
      {choosing ? <VoicePicker /> : null}
      <details class="voice-opts">
      <summary>⚙ Opciones de voz</summary>
      <p class="voice-src muted small">
        {S.vs == null ? 'Revisando la voz…'
          : local ? '🔒 Voz local: se transcribe en esta máquina, el audio no sale de aquí.'
          : browserCanHear ? 'Voz del navegador (Chrome la procesa en sus servidores).'
          : 'Este navegador no trae dictado y no hay voz local instalada: escríbele.'}
      </p>
      {S.phase === 'listening' ? <p class="listen-hint small">{S.pause === 'manual'
        ? 'No te corto aunque hagas pausas. Toca ✓ cuando termines.'
        : `Puedes pausar para pensar: envío cuando calles ${S.pause === 'larga' ? '4,5' : '2,5'} segundos, o toca ✓.`}</p> : null}
      <label class="pause-pick small">Cuando hago una pausa:
        <select value={S.pause} onChange={(e) => setOption('pause', e.currentTarget.value)}>
          {Object.entries(PAUSES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
      </label>
      <div class="toggles">
        <label><input type="checkbox" checked={S.voiceOut} onChange={(e) => setOption('voiceOut', e.currentTarget.checked)} /> Responder en voz alta</label>
        <label><input type="checkbox" checked={S.handsFree} onChange={(e) => setOption('handsFree', e.currentTarget.checked)} /> Conversación (vuelve a escucharte después de responder)</label>
        <label><input type="checkbox" checked={S.follow} onChange={(e) => setOption('follow', e.currentTarget.checked)} /> Llevarme a la sesión donde está trabajando</label>
      </div>
      </details>
    </div>
  );
}

export function Feed({ ctx, limit, empty }) {
  const S = useAgent();
  const ref = useRef(null);
  const rows = limit ? S.feed.slice(-limit) : S.feed;
  useEffect(() => { const n = ref.current; if (n) n.scrollTop = n.scrollHeight; }, [S.feed.length, S.interim]);
  return (
    <div class="as-feed" ref={ref}>
      {!rows.length && !S.interim ? empty : null}
      {rows.map(e => (
        <div key={e.id} class={`as-row ${e.kind}${e.bad ? ' bad' : ''}${e.ask ? ' ask-row' : ''}`}
             onClick={e.session && e.project ? () => ctx.go(`/p/${encodeURIComponent(e.project)}/s/${encodeURIComponent(e.session)}`) : undefined}>
          {e.kind === 'me' ? <><span class="tag-me">{e.voice ? '🎙 tú' : 'tú'}</span> {unframe(e.text)}</>
            : e.kind === 'ai' ? <><span class="tag-ai">{e.project || 'líder'}</span>{e.title ? <em class="tag-about"> {e.title}</em> : null} {plainText(e.text)}</>
            : <><span class="tag-ev">{e.ask ? 'pregunta' : 'en vivo'}</span> {e.text}</>}
        </div>
      ))}
      {S.interim ? <div class="as-row me live"><span class="tag-me">🎙</span> {S.interim}…</div> : null}
    </div>
  );
}

function Sea({ ctx }) {
  const S = useAgent();
  const state = shipStateOf(S);
  const lane = [...S.cards].sort((a, b) => Number(b.lead) - Number(a.lead));
  const at = Math.max(0, lane.findIndex(c => c.name === S.focus));
  return (
    <div class={`sea st-${state}`}>
      <div class="ship-track" style={{ '--i': at, '--n': Math.max(lane.length, 1) }}>
        <Ship size={58} state={state} />
        <span class="ship-say">{STATE_WORDS[state]}{state === 'acting' && S.focus ? ` en ${S.focus}` : ''}</span>
      </div>
      <div class="lane" style={{ '--n': Math.max(lane.length, 1) }}>
        {!lane.length ? <span class="muted small lane-empty">Sin sesiones abiertas: al pedirle algo arranco su líder.</span> : null}
        {lane.map(c => {
          const s = statusOf(c);
          return (
            <button key={c.name} class={`buoy c-${(STATUS[s] || STATUS.unknown).color}${c.name === S.focus ? ' on' : ''}`}
                    title={`${c.label || c.name} · ${(STATUS[s] || STATUS.unknown).label}`}
                    onClick={() => ctx.go(`/p/${encodeURIComponent(S.target)}/s/${encodeURIComponent(c.name)}`)}>
              <b>{(STATUS[s] || STATUS.unknown).glyph}</b><span>{c.lead ? 'líder' : c.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const HINT = (
  <div class="as-hint">
    <p><b>Háblale como a un compañero.</b></p>
    <p class="muted">“Vamos a practiq” · “En vault invers revisa el KPI de Belgrano” · “Abre la sesión stripe” · “Muéstrame el mapa”.</p>
    <p class="muted">Todo pasa primero por quien reparte: mira la conversación y decide un solo destino. Si no está seguro, te pregunta antes de mandar.</p>
  </div>
);

export function Assistant({ ctx, projects, onClose, chip }) {
  const S = useAgent();
  const list = useMemo(() => rankedProjects(projects), [projects]);
  return (
    <aside class="assistant" aria-label="Asistente">
      <header class="as-head">
        <div><b>Asistente</b><small>decide a dónde va cada cosa y, si duda, te pregunta</small></div>
        <span class="as-head-end">{chip}<button class="x" aria-label="Cerrar asistente" onClick={onClose}>✕</button></span>
      </header>
      <label class="field as-target"><span>Le hablas al líder de</span>
        <select value={S.target} onChange={(e) => setTarget(e.currentTarget.value)}>
          {!S.target ? <option value="">elige un proyecto…</option> : null}
          {list.map(p => <option key={p.name} value={p.name}>{p.name}{p.sessions.some(s => s.lead) ? '' : ' (sin líder abierto)'}</option>)}
        </select>
      </label>
      <Sea ctx={ctx} />
      <Feed ctx={ctx} empty={HINT} />
      <div class="as-controls"><Console projects={projects} /></div>
    </aside>
  );
}

// The first thing on the home page: talk or type, right away.
export function HomeAgent({ ctx, projects }) {
  const S = useAgent();
  return (
    <section class="home-agent">
      <div class="home-agent-head">
        <Ship size={54} state={shipStateOf(S)} />
        <div>
          <h2>¿Qué hacemos hoy?</h2>
        </div>
      </div>
      <Console projects={projects} big />
      {S.feed.length || S.interim ? <Feed ctx={ctx} limit={8} /> : null}
    </section>
  );
}

// Wherever the person is, a conversation in progress can be seen and stopped. Without this,
// one started on the home page went on listening after the page moved to a project, with
// no Stop on screen.
export function VoiceBar({ onOpen }) {
  const S = useAgent();
  const state = shipStateOf(S);
  const live = ['listening', 'hearing', 'routing', 'sending', 'starting', 'speaking'].includes(S.phase) || S.conversing;
  if (!live) return null;
  return (
    <div class={`voicebar st-${state}`} role="status">
      <Ship size={30} state={state} />
      <span class="vb-text">
        {STATE_WORDS[state] || 'Listo'}{S.conversing && state === 'idle' ? ' · en conversación' : ''}
        {S.interim ? <em> “{S.interim}”</em> : null}
      </span>
      {S.phase === 'listening' && S.vs?.hear?.ready ? <span class="vb-meter"><i style={{ width: `${Math.round(S.level * 100)}%` }} /></span> : null}
      {S.phase === 'listening' ? <button class="vb-btn" onClick={talk}>✓ Ya terminé</button> : null}
      <button class="vb-btn" onClick={onOpen}>Abrir</button>
      <button class="vb-stop" onClick={stop}>■ Detener</button>
    </div>
  );
}
