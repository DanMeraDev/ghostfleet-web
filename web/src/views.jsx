import { useState } from 'preact/hooks';

const seenHelp = () => { try { return localStorage.getItem('gfw.help') === 'off'; } catch { return false; } };
import { api } from './api.js';
import { StatusPill, Avatar, Btn, usePoll, sinceTs, clock, toast } from './ui.jsx';
import { HomeAgent } from './assistant.jsx';

function Row({ ctx, p, s }) {
  const owner = s.owner ? ctx.usersById[s.owner] : null;
  return (
    <button class="row-item" onClick={() => ctx.go(`/p/${encodeURIComponent(p)}/s/${encodeURIComponent(s.name)}`)}>
      <StatusPill status={s.status} small />
      <span class="grow"><b>{s.name}</b> <span class="muted">en {p}</span></span>
      <span class="muted small">{sinceTs(s.ts)}</span>
      <Avatar user={owner} size={22} />
    </button>
  );
}

export function Home({ ctx, projects }) {
  const all = (projects || []).flatMap(p => p.sessions.map(s => ({ p: p.name, s })));
  const mine = (x) => x.s.owner === ctx.me.id;
  const need = all.filter(x => x.s.status === 'need-you').sort((a, b) => Number(mine(b)) - Number(mine(a)));
  const ready = all.filter(x => x.s.status === 'ready' && !x.s.lead).sort((a, b) => b.s.ts - a.s.ts);
  const working = all.filter(x => x.s.status === 'working');
  const lost = all.filter(x => x.s.status === 'lost');
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  return (
    <div class="page">
      <header class="page-head"><div><h1>{hello}, {ctx.me.name.split(' ')[0]}</h1>
        <p class="muted">Lo que está pasando en la flota ahora.</p></div></header>
      <HomeAgent ctx={ctx} projects={projects} />
      <Help />
      <div class="stats">
        <div class={`stat${need.length ? ' hot' : ''}`}><b>{need.length}</b><span>te necesitan</span></div>
        <div class="stat"><b>{working.length}</b><span>trabajando</span></div>
        <div class="stat"><b>{ready.length}</b><span>listas para revisar</span></div>
        <div class="stat"><b>{(projects || []).filter(p => p.sessions.length).length}</b><span>proyectos activos</span></div>
      </div>
      {projects == null ? <p class="muted">Leyendo la flota…</p> : null}
      <section class="group g-need">
        <h2>Te necesitan <span class="count">{need.length}</span><small>Primero las tuyas</small></h2>
        {need.length ? <div class="rows">{need.map(x => <Row key={x.p + x.s.name} ctx={ctx} {...x} />)}</div>
          : <p class="muted pad">Nadie está esperando una respuesta. 👌</p>}
      </section>
      <section class="group g-ready">
        <h2>Listas para revisar <span class="count">{ready.length}</span><small>Terminaron su turno</small></h2>
        {ready.length ? <div class="rows">{ready.slice(0, 12).map(x => <Row key={x.p + x.s.name} ctx={ctx} {...x} />)}</div>
          : <p class="muted pad">Nada pendiente de revisar.</p>}
      </section>
      {working.length ? (
        <section class="group g-work">
          <h2>Trabajando ahora <span class="count">{working.length}</span></h2>
          <div class="rows">{working.map(x => <Row key={x.p + x.s.name} ctx={ctx} {...x} />)}</div>
        </section>
      ) : null}
      {lost.length ? (
        <section class="group">
          <h2>Perdidas <span class="count">{lost.length}</span><small>Se cerraron con un reinicio; se pueden reabrir o detener</small></h2>
          <div class="rows">{lost.map(x => <Row key={x.p + x.s.name} ctx={ctx} {...x} />)}</div>
        </section>
      ) : null}
    </div>
  );
}

function Help() {
  const [off, setOff] = useState(seenHelp());
  if (off) return null;
  const close = () => { try { localStorage.setItem('gfw.help', 'off'); } catch {} setOff(true); };
  return (
    <div class="help">
      <button class="x" aria-label="Cerrar la guía" onClick={close}>✕</button>
      <b>Cómo funciona</b>
      <ol>
        <li><b>Elige un proyecto</b> a la izquierda. Cada tarjeta es un Claude trabajando en su propia carpeta y rama, así no se pisan entre ustedes.</li>
        <li><b>Pide lo que necesitas</b> en el cuadro de arriba, hablando o escribiendo: “vamos a practiq, arregla los tests de pagos”. Entiendo el proyecto y se lo paso a su líder, que reparte el trabajo. También puedes abrir una sesión a mano con <i>+ Nueva sesión</i>.</li>
        <li><b>Cuando una sesión te necesite</b> se pone en rojo: entra y responde con un clic. Las verdes ya terminaron y esperan tu revisión.</li>
      </ol>
    </div>
  );
}

const VERBS = {
  fleet_send: 'le escribió a', fleet_answer: 'respondió un pedido de', fleet_interrupt: 'interrumpió a',
  fleet_pause: 'pausó', fleet_resume: 'reanudó', fleet_wake: 'despertó', fleet_reopen: 'reabrió',
  fleet_spawn: 'creó la sesión', fleet_stop: 'detuvo', fleet_rename: 'renombró', fleet_worktree_remove: 'borró el worktree',
  fleet_unqueue: 'sacó de la cola un mensaje de', assign: 'cambió el responsable de', login: 'entró', setup: 'creó las cuentas',
  add_user: 'agregó a', password: 'cambió su contraseña',
};
const RESULT = { ran: ['hecho', 'good'], refused: ['rechazado', 'bad'], changed: ['el pedido cambió', 'warn'] };

export function Activity({ ctx }) {
  const { data, error } = usePoll(() => api.activity(), 5000, []);
  const [who, setWho] = useState('all');
  const rows = (data?.rows || []).filter(r => who === 'all' || r.user === who);
  return (
    <div class="page">
      <header class="page-head"><div><h1>Actividad</h1><p class="muted">Todo lo que se hizo desde la web, con nombre y hora.</p></div></header>
      <div class="chips">
        <button class={who === 'all' ? 'on' : ''} onClick={() => setWho('all')}>Todos</button>
        {ctx.users.map(u => <button key={u.id} class={who === u.id ? 'on' : ''} onClick={() => setWho(u.id)}>{u.name}</button>)}
      </div>
      {error ? <p class="err">{error.message}</p> : null}
      <div class="log">
        {rows.map((r, i) => {
          const u = ctx.usersById[r.user];
          const [rl, rk] = RESULT[r.result] || [r.result, ''];
          const target = r.subject && r.subject !== '-' ? r.subject : '';
          const detail = r.args?.prompt || r.args?.text || r.args?.new_name || (r.args?.owner !== undefined ? (ctx.usersById[r.args.owner]?.name || 'nadie') : '');
          return (
            <details class="log-row" key={i}>
              <summary>
                <span class="when">{clock(r.ts)}</span>
                <Avatar user={u} size={20} />
                <span class="grow"><b>{u?.name || r.user}</b> {VERBS[r.verb] || r.verb} {target ? <b>{target}</b> : null}
                  {r.project ? <span class="muted"> · {r.project}</span> : null}</span>
                <span class={`badge ${rk}`}>{rl}</span>
              </summary>
              {detail ? <p class="log-detail">“{String(detail)}”</p> : null}
              {r.output ? <pre class="log-out">{r.output}</pre> : null}
            </details>
          );
        })}
        {data && !rows.length ? <p class="muted pad">Todavía no hay actividad.</p> : null}
      </div>
    </div>
  );
}

export function Settings({ ctx, onUsers }) {
  const [old, setOld] = useState(''); const [nw, setNw] = useState('');
  const [nName, setNName] = useState(''); const [nPw, setNPw] = useState('');
  return (
    <div class="page narrow">
      <header class="page-head"><div><h1>Ajustes</h1></div></header>
      <section class="panel">
        <h2>Equipo</h2>
        <div class="rows">{ctx.users.map(u => <div class="row-item static" key={u.id}><Avatar user={u} /> <b class="grow">{u.name}</b>{u.id === ctx.me.id ? <span class="muted">tú</span> : null}</div>)}</div>
        <form class="row wrap" onSubmit={async (e) => {
          e.preventDefault();
          try { await api.addUser(nName, nPw); setNName(''); setNPw(''); toast('Persona agregada', 'good'); onUsers(); } catch (x) { toast(x.message, 'bad'); }
        }}>
          <input placeholder="Nombre" value={nName} onInput={(e) => setNName(e.currentTarget.value)} />
          <input type="password" placeholder="Contraseña inicial" value={nPw} onInput={(e) => setNPw(e.currentTarget.value)} />
          <Btn kind="ghost" type="submit" disabled={!nName || nPw.length < 6}>Agregar persona</Btn>
        </form>
      </section>
      <section class="panel">
        <h2>Tu contraseña</h2>
        <form class="row wrap" onSubmit={async (e) => {
          e.preventDefault();
          try { await api.password(old, nw); setOld(''); setNw(''); toast('Contraseña cambiada', 'good'); } catch (x) { toast(x.message, 'bad'); }
        }}>
          <input type="password" placeholder="Actual" value={old} onInput={(e) => setOld(e.currentTarget.value)} />
          <input type="password" placeholder="Nueva (mín. 6)" value={nw} onInput={(e) => setNw(e.currentTarget.value)} />
          <Btn kind="ghost" type="submit" disabled={!old || nw.length < 6}>Cambiar</Btn>
        </form>
      </section>
      <section class="panel">
        <h2>Conexión</h2>
        <p>{ctx.mode === 'demo'
          ? <>Estás en <b>modo demo</b>: una flota de ejemplo en memoria. Nada de lo que hagas toca sesiones reales.</>
          : <>Conectado a la flota real de esta máquina a través de ghostfleet. Cada acción corre con la cuenta de Claude de la máquina.</>}</p>
        {ctx.mode === 'demo' ? <Btn kind="ghost" onClick={async () => { await api.resetDemo(); toast('Demo reiniciado', 'good'); }}>Reiniciar datos del demo</Btn> : null}
      </section>
    </div>
  );
}
