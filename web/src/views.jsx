import { useState } from 'preact/hooks';
import { api } from './api.js';
import { Avatar, Btn, usePoll, clock, toast } from './ui.jsx';
import { HomeAgent } from './assistant.jsx';
import { Board } from './board.jsx';

export function Home({ ctx, projects }) {
  return (
    <div class="page home">
      <HomeAgent ctx={ctx} projects={projects} />
      <Board ctx={ctx} projects={projects} />
    </div>
  );
}

const VERBS = {
  fleet_send: 'le escribió a', attach: 'adjuntó un archivo a', fleet_answer: 'respondió un pedido de', fleet_interrupt: 'interrumpió a',
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
