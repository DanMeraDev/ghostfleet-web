// The home page as a picture of the fleet: every fleet with something open is a tile, every
// session a boat in the colour of what it is doing. Words only where a click is needed — a
// name on hover, and on the boats that are waiting for an answer.
import { useState } from 'preact/hooks';
import { Ship } from './assistant.jsx';

const FRESH_S = 15 * 60;        // "just finished": ready, and its turn ended this recently

// What a person needs to tell apart at a glance, in order of urgency.
export const LOOKS = {
  need:  { label: 'Te necesita',    color: 'red',    ship: 'need' },
  work:  { label: 'Trabajando',     color: 'cyan',   ship: 'work' },
  fresh: { label: 'Recién terminó', color: 'green',  ship: 'fresh' },
  warn:  { label: 'Sin cupo / cortada', color: 'yellow', ship: 'warn' },
  open:  { label: 'Abierta',        color: 'white',  ship: 'open' },
  off:   { label: 'Inactiva',       color: 'grey',   ship: 'off' },
};
const ORDER = Object.keys(LOOKS);

export function lookOf(s, now = Date.now() / 1000) {
  switch (s.status) {
    case 'need-you': return 'need';
    case 'working': case 'starting': return 'work';
    case 'ready': return s.ts && now - s.ts < FRESH_S ? 'fresh' : 'open';
    case 'limit': case 'interrupted': case 'unknown': return 'warn';
    case 'idle': return 'open';
    default: return 'off';                     // lost, asleep, parked
  }
}

const sessionHref = (p, s) => `#/p/${encodeURIComponent(p)}/s/${encodeURIComponent(s)}`;
const projectHref = (p) => `#/p/${encodeURIComponent(p)}`;

export function Board({ ctx, projects }) {
  const [showQuiet, setShowQuiet] = useState(false);
  const now = Date.now() / 1000;
  const fleets = (projects || []).map(p => {
    const boats = p.sessions.map(s => ({ ...s, look: lookOf(s, now) }))
      .sort((a, b) => ORDER.indexOf(a.look) - ORDER.indexOf(b.look) || Number(b.lead) - Number(a.lead));
    const n = Object.fromEntries(ORDER.map(k => [k, boats.filter(b => b.look === k).length]));
    const top = ORDER.find(k => n[k]) || 'off';
    const last = Math.max(0, ...p.sessions.map(s => s.ts || 0));
    return { name: p.name, boats, n, top, last };
  });
  const live = fleets.filter(f => f.top !== 'off')
    .sort((a, b) => ORDER.indexOf(a.top) - ORDER.indexOf(b.top) || b.n.need - a.n.need || b.n.work - a.n.work || b.last - a.last);
  const quiet = fleets.filter(f => f.top === 'off').sort((a, b) => b.boats.length - a.boats.length || a.name.localeCompare(b.name));
  const total = Object.fromEntries(ORDER.map(k => [k, fleets.reduce((x, f) => x + f.n[k], 0)]));

  if (projects == null) return <p class="muted">Leyendo la flota…</p>;
  return (
    <section class="board">
      <div class="legend" role="list">
        {ORDER.filter(k => total[k]).map(k => (
          <span key={k} role="listitem" class={`lg c-${LOOKS[k].color} lk-${k}`}><i />{total[k]} <small>{LOOKS[k].label}</small></span>
        ))}
      </div>
      {live.length ? (
        <div class="fleets">
          {live.map(f => (
            <article key={f.name} class={`fleet c-${LOOKS[f.top].color} lk-${f.top}`}>
              <a class="fleet-name" href={projectHref(f.name)} title={`Abrir ${f.name}`}>{f.name}</a>
              <div class="fleet-sea">
                {f.boats.map(b => {
                  const owner = b.owner ? ctx.usersById?.[b.owner] : null;
                  return (
                    <a key={b.name} class={`fboat c-${LOOKS[b.look].color} lk-${b.look}`} href={sessionHref(f.name, b.name)}
                       title={`${b.lead ? 'líder' : b.name} · ${LOOKS[b.look].label}${owner ? ` · ${owner.name}` : ''}`}>
                      <Ship size={b.lead ? 60 : 46} state={`b-${LOOKS[b.look].ship}`} />
                      {b.look === 'need' ? <span class="fboat-name">{b.lead ? 'líder' : b.name}</span> : null}
                      {owner ? <i class={`fboat-owner c-${owner.color}`} /> : null}
                    </a>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      ) : <p class="muted pad">Ninguna flota está trabajando ahora.</p>}
      {quiet.length ? (
        <div class={`quiet${showQuiet ? ' open' : ''}`}>
          <button class="quiet-toggle" onClick={() => setShowQuiet(v => !v)} aria-expanded={showQuiet}>
            <i class="qdot" /> {quiet.length} quietas {showQuiet ? '▴' : '▾'}
          </button>
          {showQuiet ? quiet.map(f => <a key={f.name} class="qchip" href={projectHref(f.name)}>{f.name}</a>) : null}
        </div>
      ) : null}
    </section>
  );
}
