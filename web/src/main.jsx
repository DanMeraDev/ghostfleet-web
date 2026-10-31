import { render } from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { api } from './api.js';
import { Setup, Login } from './auth.jsx';
import { ProjectView } from './project.jsx';
import { Home, Activity, Settings } from './views.jsx';
import { Avatar, Logo, Toasts, usePoll, toast } from './ui.jsx';
import { Assistant, Ship, VoiceBar } from './assistant.jsx';
import { bind, unbind } from './agent.js';
import { FleetMap } from './map.jsx';
import './styles.css';

// Hash routes, so the back button works and a link pasted to a teammate opens the same view.
function parse(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (parts[0] === 'p' && parts[1]) return { view: 'project', project: parts[1], session: parts[2] === 's' ? parts[3] : null };
  if (parts[0] === 'actividad') return { view: 'activity' };
  if (parts[0] === 'mapa') return { view: 'map' };
  if (parts[0] === 'ajustes') return { view: 'settings' };
  return { view: 'home' };
}
function useRoute() {
  const [r, setR] = useState(parse(location.hash));
  useEffect(() => { const f = () => setR(parse(location.hash)); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}

function Sidebar({ ctx, route, projects, open, onClose, onAssistant }) {
  const [q, setQ] = useState('');
  const list = (projects || [])
    .filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.counts.need_you - a.counts.need_you) || (b.counts.total - a.counts.total) || a.name.localeCompare(b.name));
  const need = (projects || []).reduce((n, p) => n + p.counts.need_you, 0);
  const link = (to, active, children) => <a href={`#${to}`} class={`nav${active ? ' on' : ''}`} onClick={onClose}>{children}</a>;
  return (
    <nav class={`side${open ? ' open' : ''}`} aria-label="Navegación">
      <div class="brand"><Logo /><div><b>ghostfleet</b><small>{ctx.mode === 'demo' ? 'modo demo' : 'tu flota'}</small></div></div>
      {link('/', route.view === 'home', <><span class="ico">⌂</span> Inicio {need ? <span class="badge bad">{need}</span> : null}</>)}
      {link('/mapa', route.view === 'map', <><span class="ico">⛵</span> Mapa en vivo</>)}
      {link('/actividad', route.view === 'activity', <><span class="ico">≡</span> Actividad</>)}
      <button class="nav as-nav" onClick={() => { onClose(); onAssistant(); }}><span class="ico">🎙</span> Asistente de voz</button>
      <div class="side-sec">
        <span>Proyectos</span>
        <input class="search" placeholder="Buscar…" value={q} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Buscar proyecto" />
      </div>
      <div class="side-list">
        {projects == null ? <p class="muted pad">Cargando…</p> : null}
        {list.map(p => link(`/p/${encodeURIComponent(p.name)}`, route.view === 'project' && route.project === p.name, (
          <>
            <span class={`dot${p.counts.need_you ? ' bad' : p.counts.working ? ' work' : p.counts.total ? ' on' : ''}`} />
            <span class="grow ellipsis">{p.name}</span>
            {p.counts.need_you ? <span class="badge bad">{p.counts.need_you}</span> : p.counts.total ? <span class="n">{p.counts.total}</span> : null}
          </>
        )))}
      </div>
      <div class="side-foot">
        <Avatar user={ctx.me} size={28} />
        <span class="grow ellipsis">{ctx.me.name}</span>
        <a href="#/ajustes" class="icon-btn" title="Ajustes" onClick={onClose}>⚙</a>
        <button class="icon-btn" title="Salir" onClick={ctx.logout}>⎋</button>
      </div>
    </nav>
  );
}

function Shell({ me, mode, onLogout }) {
  const route = useRoute();
  const [users, setUsers] = useState([me]);
  const [menu, setMenu] = useState(false);
  const [asOpen, setAsOpen] = useState(() => { try { return localStorage.getItem('gfw.asOpen') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('gfw.asOpen', asOpen ? '1' : '0'); } catch {} }, [asOpen]);
  const loadUsers = useCallback(() => api.users().then(r => setUsers(r.users)).catch(() => {}), []);
  useEffect(() => { loadUsers(); }, []);
  const { data: pj } = usePoll(() => api.projects(), 4000, []);
  const usersById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);
  const ctx = {
    me, mode, users, usersById,
    go: (to) => { location.hash = to; },
    logout: async () => { unbind(); try { await api.logout(); } catch {} onLogout(); },
  };
  // The assistant lives above the pages; it needs to know where the person is.
  bind({ go: ctx.go, me, projects: pj?.projects || [], route });
  const need = (pj?.projects || []).reduce((n, p) => n + p.counts.need_you, 0);
  useEffect(() => { document.title = need ? `(${need}) ghostfleet` : 'ghostfleet'; }, [need]);

  let main;
  if (route.view === 'project') main = <ProjectView key={route.project} ctx={ctx} project={route.project} session={route.session} />;
  else if (route.view === 'activity') main = <Activity ctx={ctx} />;
  else if (route.view === 'map') main = <FleetMap ctx={ctx} projects={pj?.projects ?? null} />;
  else if (route.view === 'settings') main = <Settings ctx={ctx} onUsers={loadUsers} />;
  else main = <Home ctx={ctx} projects={pj?.projects ?? null} />;

  return (
    <div class={`app${mode === 'demo' ? ' is-demo' : ''}${asOpen ? ' with-as' : ''}`}>
      <div class="topbar">
        <button class="icon-btn" aria-label="Menú" onClick={() => setMenu(true)}>☰</button>
        <div class="brand"><Logo size={22} /><b>ghostfleet</b></div>
        {need ? <a class="badge bad" href="#/">{need}</a> : <span />}
      </div>
      {menu ? <div class="side-scrim" onClick={() => setMenu(false)} /> : null}
      <Sidebar ctx={ctx} route={route} projects={pj?.projects ?? null} open={menu} onClose={() => setMenu(false)} onAssistant={() => setAsOpen(true)} />
      <main class="main">
        {mode === 'demo' ? <div class="demo-bar">Modo demo · datos de ejemplo, puedes tocar todo sin miedo</div> : null}
        {main}
      </main>
      {asOpen
        ? <Assistant ctx={ctx} route={route} projects={pj?.projects ?? null} onClose={() => setAsOpen(false)} />
        : <><VoiceBar onOpen={() => setAsOpen(true)} />
            <button class="as-launch" onClick={() => setAsOpen(true)} aria-label="Abrir el asistente de voz"><Ship size={34} /> <span>Asistente</span></button></>}
      <Toasts />
    </div>
  );
}

function App() {
  const [h, setH] = useState(null);
  const [err, setErr] = useState('');
  const check = () => api.health().then(setH).catch(e => setErr(e.message));
  useEffect(() => { check(); }, []);
  if (err) return <div class="auth"><div class="auth-card"><h1>No hay conexión con el servidor</h1><p class="err">{err}</p><p class="muted">¿Está corriendo <code>pnpm start</code>?</p></div></div>;
  if (!h) return <div class="boot"><Logo size={48} /></div>;
  const in_ = (user) => { setH({ ...h, setup: false, user }); toast(`Hola, ${user.name}`, 'good'); };
  if (h.setup) return <><Setup mode={h.mode} onDone={in_} /><Toasts /></>;
  if (!h.user) return <><Login mode={h.mode} onDone={in_} /><Toasts /></>;
  return <Shell me={h.user} mode={h.mode} onLogout={() => setH({ ...h, user: null })} />;
}

render(<App />, document.getElementById('app'));
