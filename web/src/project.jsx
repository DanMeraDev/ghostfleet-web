import { useState, useMemo } from 'preact/hooks';
import { api } from './api.js';
import { STATUS, statusOf, StatusPill, Avatar, Btn, usePoll, ago, toast, Modal, Confirm } from './ui.jsx';
import { SessionView } from './session.jsx';

// Grouped by what each one asks of a person, in the order it should be looked at.
const GROUPS = [
  { id: 'need', title: 'Te necesitan', hint: 'Esperan una respuesta o un permiso', has: (s) => s === 'need-you' },
  { id: 'work', title: 'Trabajando', hint: 'En medio de un turno', has: (s) => s === 'working' || s === 'starting' },
  { id: 'ready', title: 'Listas para revisar', hint: 'Terminaron su turno', has: (s) => s === 'ready' || s === 'interrupted' || s === 'limit' },
  { id: 'rest', title: 'En pausa o inactivas', hint: 'No están gastando cupo', has: () => true },
];

export function Card({ c, ctx, active, compact, onOpen }) {
  const st = statusOf(c);
  const owner = c.owner ? ctx.usersById[c.owner] : null;
  const others = (c.here || []).filter(h => h.user !== ctx.me.id);
  return (
    <article class={`card s-${(STATUS[st] || STATUS.unknown).color}${active ? ' active' : ''}${compact ? ' compact' : ''}`}
             tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div class="card-top">
        <StatusPill status={st} small />
        <span class="age">{c.age != null ? ago(c.age) : ''}</span>
      </div>
      <h3>{c.name}{c.lead ? <span class="tag">líder</span> : null}</h3>
      {c.label ? <span class="card-label">🏷 {c.label}</span> : null}
      <div class="card-meta">
        <span class="branch" title="Rama">⎇ {c.branch || '—'}</span>
        {c.pr ? <span class="tag pr">PR {c.pr}</span> : null}
        {c.queued ? <span class="tag">{c.queued} en cola</span> : null}
        {c.sched ? <span class="tag sched" title={c.sched.msg || ''}>⏰ {new Date(c.sched.at * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span> : null}
      </div>
      {!compact && c.msg ? <p class="card-msg">{c.msg}</p> : null}
      <div class="card-foot">
        <span class="owner"><Avatar user={owner} size={22} /> {owner ? owner.name : 'Sin responsable'}</span>
        {others.length ? (
          <span class="here" title="También están viendo esta sesión">
            {others.map(h => <Avatar key={h.user} user={ctx.usersById[h.user]} size={18} />)}
            {others.some(h => h.typing) ? ' escribiendo…' : ' mirando'}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function ProjectView({ ctx, project, session }) {
  const { data: g, error, reload } = usePoll(() => api.grid(project), 3000, [project]);
  const [filter, setFilter] = useState('all');
  const [spawn, setSpawn] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const cards = useMemo(() => (g?.cards || []).filter(c =>
    filter === 'all' ? true : filter === 'none' ? !c.owner : c.owner === filter), [g, filter]);
  const counts = useMemo(() => {
    const o = { all: g?.cards?.length || 0, none: 0 };
    for (const c of g?.cards || []) { if (!c.owner) o.none++; else o[c.owner] = (o[c.owner] || 0) + 1; }
    return o;
  }, [g]);
  const open = (name) => ctx.go(`/p/${encodeURIComponent(project)}/s/${encodeURIComponent(name)}`);
  const current = session && g ? g.cards.find(c => c.name === session) : null;

  const removeWorktree = (w) => setConfirm({
    title: 'Borrar worktree libre', action: 'Borrar worktree', danger: true,
    body: <p>Se borra la carpeta <code>{w.path}</code> (rama <code>{w.branch}</code>). ghostfleet se niega si tiene cambios sin guardar o sin subir, y te dice por qué.</p>,
    onYes: async () => {
      try { const r = await api.act('fleet_worktree_remove', { project, path: w.path }, { confirm: true }); toast(r.text || 'Worktree borrado', 'good'); }
      catch (e) { toast(e.message, 'bad'); }
      reload();
    },
  });

  const lead = (g?.cards || []).find(c => c.lead);
  const leadUp = lead && !lead.lost && !lead.asleep && statusOf(lead) !== 'parked';
  const [waking, setWaking] = useState(false);
  const wake = async () => {
    setWaking(true);
    try { const r = await api.lead(project); toast(r.started ? 'El líder ya está listo.' : 'El líder ya estaba abierto.', 'good'); reload(); }
    catch (e) { toast(`No se pudo arrancar el líder: ${e.message}`, 'bad'); }
    finally { setWaking(false); }
  };
  const header = (
    <header class="page-head">
      <div>
        <h1>{project}</h1>
        <p class="muted">{g ? `${g.cards.length} sesiones · ${g.free_worktrees?.length || 0} worktrees libres` : 'Cargando…'}</p>
      </div>
      <div class="row wrap">
        {g && !leadUp ? (
          <Btn kind="ghost" disabled={waking} onClick={wake} title="El líder es el Claude del proyecto que reparte el trabajo">
            {waking ? 'Arrancando…' : !lead ? '▶ Arrancar el líder' : lead.lost ? '↺ Reabrir el líder' : lead.asleep ? '☾ Despertar al líder' : '▶ Reanudar al líder'}
          </Btn>
        ) : null}
        <Btn kind="primary" icon="+" onClick={() => setSpawn({})}>Nueva sesión</Btn>
      </div>
    </header>
  );
  const filters = (
    <div class="chips" role="tablist" aria-label="Filtrar por responsable">
      <button class={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Todas <b>{counts.all}</b></button>
      <button class={filter === ctx.me.id ? 'on' : ''} onClick={() => setFilter(ctx.me.id)}>Mías <b>{counts[ctx.me.id] || 0}</b></button>
      {ctx.users.filter(u => u.id !== ctx.me.id).map(u => (
        <button key={u.id} class={filter === u.id ? 'on' : ''} onClick={() => setFilter(u.id)}>De {u.name} <b>{counts[u.id] || 0}</b></button>
      ))}
      <button class={filter === 'none' ? 'on' : ''} onClick={() => setFilter('none')}>Sin responsable <b>{counts.none}</b></button>
    </div>
  );
  const modals = (
    <>
      {spawn ? <NewSession ctx={ctx} project={project} free={g?.free_worktrees || []} preset={spawn}
                           onClose={() => setSpawn(null)} onDone={(name) => { setSpawn(null); reload(); open(name); }} /> : null}
      {confirm ? <Confirm {...confirm} onClose={() => setConfirm(null)} /> : null}
    </>
  );

  if (error && !g) return <div class="page">{header}<p class="err">No se pudo leer la flota de {project}: {error.message}</p></div>;

  if (session) {
    return (
      <div class="split">
        <aside class="split-list">
          <div class="split-head">
            <button class="link" onClick={() => ctx.go(`/p/${encodeURIComponent(project)}`)}>← {project}</button>
            <Btn kind="ghost sm" icon="+" onClick={() => setSpawn({})}>Nueva</Btn>
          </div>
          {(g?.cards || []).map(c => <Card key={c.name} c={c} ctx={ctx} compact active={c.name === session} onOpen={() => open(c.name)} />)}
        </aside>
        <SessionView key={`${project}/${session}`} ctx={ctx} project={project} name={session} card={current}
                     onChanged={reload} onGone={() => ctx.go(`/p/${encodeURIComponent(project)}`)} />
        {modals}
      </div>
    );
  }

  return (
    <div class="page">
      {header}
      {filters}
      {g && !g.cards.length ? (
        <div class="empty">
          <p><b>No hay sesiones abiertas en este proyecto.</b></p>
          <p class="muted">Una sesión es un Claude trabajando en su propio worktree, con su propia rama. Así dos personas avanzan en paralelo sin pisarse.</p>
          <Btn kind="primary" icon="+" onClick={() => setSpawn({})}>Abrir la primera</Btn>
        </div>
      ) : null}
      {GROUPS.map((gr, i) => {
        const taken = new Set(GROUPS.slice(0, i).flatMap(x => cards.filter(c => x.has(statusOf(c))).map(c => c.name)));
        const list = cards.filter(c => !taken.has(c.name) && gr.has(statusOf(c)));
        if (!list.length) return null;
        return (
          <section key={gr.id} class={`group g-${gr.id}`}>
            <h2>{gr.title} <span class="count">{list.length}</span><small>{gr.hint}</small></h2>
            <div class="cards">{list.map(c => <Card key={c.name} c={c} ctx={ctx} onOpen={() => open(c.name)} />)}</div>
          </section>
        );
      })}
      {g && (g.cards.length || g.free_worktrees?.length) ? (
        <section class="group">
          <h2>Árbol del proyecto <small>El líder en la carpeta principal y cada sesión en su propio worktree (sus “hijos”)</small></h2>
          <Tree ctx={ctx} g={g} open={open} onReuse={(w) => setSpawn({ reuse: w.path })} onRemove={removeWorktree} />
        </section>
      ) : null}
      {modals}
    </div>
  );
}

// Who hangs from whom: the lead, the workers it (or a person) opened, the sub-workers a
// worker opened in turn (card.parent), and the folders nobody is using.
function Tree({ ctx, g, open, onReuse, onRemove }) {
  const cards = g.cards || [];
  const lead = cards.find(c => c.lead);
  const kids = (name) => cards.filter(c => !c.lead && (c.parent || null) === name);
  const top = cards.filter(c => !c.lead && (!c.parent || !cards.some(x => x.name === c.parent)));
  const Row = ({ c, depth }) => {
    const st = statusOf(c), meta = STATUS[st] || STATUS.unknown;
    const owner = c.owner ? ctx.usersById[c.owner] : null;
    return (
      <>
        <button class={`tree-row c-${meta.color}`} style={{ '--d': depth }} onClick={() => open(c.name)}>
          <span class="tree-branch">{depth ? '└─' : ''}</span>
          <b class="tree-glyph">{meta.glyph}</b>
          <span class="tree-name">{c.lead ? 'líder' : c.name}{c.label ? <em> · {c.label}</em> : null}</span>
          <span class="tree-meta">📁 {c.folder || '—'} · ⎇ {c.branch || '—'}</span>
          <span class="tree-st">{meta.label}</span>
          <Avatar user={owner} size={18} />
        </button>
        {kids(c.name).map(k => <Row key={k.name} c={k} depth={depth + 1} />)}
      </>
    );
  };
  return (
    <div class="tree">
      {lead ? <Row c={lead} depth={0} /> : <div class="tree-row static"><span class="muted">Sin líder abierto en la carpeta principal.</span></div>}
      {top.map(c => <Row key={c.name} c={c} depth={1} />)}
      {(g.free_worktrees || []).map(w => (
        <div class="tree-row free-row" key={w.path} style={{ '--d': 1 }}>
          <span class="tree-branch">└─</span>
          <b class="tree-glyph">○</b>
          <span class="tree-name">{w.path.split('/').pop()} <em class="muted">libre</em></span>
          <span class="tree-meta">⎇ {w.branch} · {w.path}</span>
          <span class="row">
            <Btn kind="ghost sm" onClick={() => onReuse(w)}>Abrir una sesión aquí</Btn>
            <Btn kind="ghost sm danger" onClick={() => onRemove(w)}>Borrar</Btn>
          </span>
        </div>
      ))}
    </div>
  );
}

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function NewSession({ ctx, project, free, preset, onClose, onDone }) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [owner, setOwner] = useState(ctx.me.id);
  const [where, setWhere] = useState(preset.reuse || 'new');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = slugify(name);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const args = { project, name: n, prompt: prompt.trim() || undefined, model: model || undefined,
                   branch: branch.trim() || undefined, from: from.trim() || undefined };
    if (where === 'new') { if (free.length) args.force_new = true; } else args.reuse = where;
    try { const r = await api.act('fleet_spawn', args, { owner }); toast(r.text?.split('\n')[0] || 'Sesión creada', 'good'); onDone(n); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Nueva sesión" onClose={onClose} wide>
      <form onSubmit={submit} class="stack modal-body">
        <p class="muted">Se crea un worktree con su propia rama y se abre un Claude ahí. Así cada persona trabaja en paralelo sin pisar el trabajo del otro.</p>
        <label class="field"><span>Nombre</span>
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Ej. login-con-google" autoFocus />
          {name && n !== name ? <small class="muted">Se va a llamar <code>{n}</code></small> : null}</label>
        <label class="field"><span>¿Qué tiene que hacer?</span>
          <textarea rows={5} value={prompt} onInput={(e) => setPrompt(e.currentTarget.value)}
                    placeholder="Describe la tarea completa: qué construir, dónde y cómo saber que está lista. Lo puedes dejar vacío y escribirle después." /></label>
        <div class="grid2">
          <label class="field"><span>Responsable</span>
            <select value={owner} onChange={(e) => setOwner(e.currentTarget.value)}>
              {ctx.users.map(u => <option key={u.id} value={u.id}>{u.id === ctx.me.id ? `${u.name} (yo)` : u.name}</option>)}
            </select></label>
          <label class="field"><span>Dónde</span>
            <select value={where} onChange={(e) => setWhere(e.currentTarget.value)}>
              <option value="new">Worktree nuevo</option>
              {free.map(w => <option key={w.path} value={w.path}>Reusar {w.path.split('/').pop()} ({w.branch})</option>)}
            </select></label>
        </div>
        <details class="advanced">
          <summary>Opciones avanzadas</summary>
          <div class="grid3">
            <label class="field"><span>Rama</span><input value={branch} onInput={(e) => setBranch(e.currentTarget.value)} placeholder={n || 'igual al nombre'} /></label>
            <label class="field"><span>Partir de</span><input value={from} onInput={(e) => setFrom(e.currentTarget.value)} placeholder="rama base del repo" /></label>
            <label class="field"><span>Modelo</span>
              <select value={model} onChange={(e) => setModel(e.currentTarget.value)}>
                <option value="">El de la cuenta</option><option value="opus">Opus</option><option value="sonnet">Sonnet</option><option value="haiku">Haiku</option>
              </select></label>
          </div>
        </details>
        {err ? <p class="err">{err}</p> : null}
        <footer>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn kind="primary" type="submit" disabled={!n || busy}>{busy ? 'Creando…' : 'Crear sesión'}</Btn>
        </footer>
      </form>
    </Modal>
  );
}
