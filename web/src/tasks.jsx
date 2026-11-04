import { useState } from 'preact/hooks';
import { useAgent, place, tickOff } from './agent.js';
import { plainText } from './voice.js';

// Everything asked of the assistant and where it stands. It is beside whatever page is open, so
// that hopping between projects while talking does not lose anything along the way.
const STATES = {
  ask: { label: '¿A dónde va?', color: 'yellow', rank: 0 },
  failed: { label: 'No llegó', color: 'red', rank: 0 },
  'need-you': { label: 'Te necesita', color: 'red', rank: 1 },
  replied: { label: 'Respondió', color: 'green', rank: 2 },
  working: { label: 'Trabajando', color: 'cyan', rank: 3 },
  sent: { label: 'Enviada', color: 'grey', rank: 4 },
  sending: { label: 'Mandando…', color: 'grey', rank: 4 },
};
const shown = (S) => S.tasks.filter(t => !t.hidden).sort((a, b) => STATES[a.status].rank - STATES[b.status].rank || a.at - b.at);
const hhmm = (ts) => new Date(ts * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

function Places({ task, projects }) {
  const [all, setAll] = useState(false);
  const names = (projects || []).map(p => p.name).sort((a, b) => a.localeCompare(b));
  const list = all || !task.options.length ? names : task.options;
  return (
    <div class="tk-places">
      {list.map(n => <button key={n} class="pchip" onClick={() => place(task, n)}>{n}</button>)}
      {task.options.length && !all ? <button class="pchip more" onClick={() => setAll(true)}>otro…</button> : null}
    </div>
  );
}

function Task({ ctx, task, projects }) {
  const [open, setOpen] = useState(false);
  const st = STATES[task.status];
  const last = task.replies[task.replies.length - 1];
  const where = task.session || 'líder';
  const waiting = task.status === 'ask' || task.status === 'failed';
  const goTo = () => ctx.go(`/p/${encodeURIComponent(task.project)}${task.session ? `/s/${encodeURIComponent(task.session)}` : ''}`);
  return (
    <li class={`tk c-${st.color}`}>
      <div class="tk-top">
        <span class="tk-state">{st.label}</span>
        <small class="tk-time">{hhmm(task.at)}</small>
        <button class="tk-ok" aria-label={`Marcar como lista: ${task.title}`} title="Ya está, sacarla de la lista" onClick={() => tickOff(task.id)}>✓</button>
      </div>
      <button class="tk-title" aria-expanded={open} onClick={() => setOpen(o => !o)}>{task.title}</button>
      {task.project ? <button class="tk-place" onClick={goTo}>{task.project} · {where}</button> : null}
      {waiting ? <><p class="tk-q">{task.error || task.question}</p><Places task={task} projects={projects} /></> : null}
      {last && !open ? <p class="tk-reply">{plainText(last.text).slice(0, 110)}</p> : null}
      {open ? (
        <div class="tk-more">
          <p class="tk-said">“{task.text}”</p>
          {task.replies.map(r => <p key={r.ts} class="tk-reply full">{plainText(r.text)}</p>)}
        </div>
      ) : null}
    </li>
  );
}

export function TaskRail({ ctx, projects, onClose }) {
  const S = useAgent();
  const list = shown(S);
  const replied = list.filter(t => t.status === 'replied').length;
  return (
    <aside class="rail" aria-label="Pedidos">
      <header class="rail-head">
        <b>Pedidos</b><span class="n">{list.length}</span>
        <span class="grow" />
        {replied > 1 ? <button class="rail-clear" onClick={() => tickOff('')}>Quitar respondidas</button> : null}
        <button class="x" aria-label="Ocultar pedidos" onClick={onClose}>✕</button>
      </header>
      <ul class="tk-list">
        {list.map(t => <Task key={t.id} ctx={ctx} task={t} projects={projects} />)}
        {S.deciding.map(d => <li key={d.id} class="tk c-grey deciding"><span class="tk-state">Viendo a dónde va…</span><p class="tk-said">“{d.text}”</p></li>)}
      </ul>
    </aside>
  );
}

export function TaskChip({ onClick, floating }) {
  const S = useAgent();
  const list = shown(S);
  const waiting = list.filter(t => STATES[t.status].rank < 2).length;
  return (
    <button class={`tk-chip${floating ? ' floating' : ''}`} onClick={onClick} aria-label={`Ver pedidos: ${list.length}`}>
      Pedidos {list.length + S.deciding.length}{waiting ? <span class="badge bad">{waiting}</span> : null}
    </button>
  );
}
