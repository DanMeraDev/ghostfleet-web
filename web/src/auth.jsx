import { useState } from 'preact/hooks';
import { api } from './api.js';
import { Btn, Logo } from './ui.jsx';

function Shell({ mode, children }) {
  return (
    <div class="auth">
      <div class="auth-card">
        <div class="brand big"><Logo size={44} /><div><b>ghostfleet</b><small>la flota de Claude Code del equipo</small></div></div>
        {mode === 'demo' ? <p class="demo-note">Modo demo: datos de ejemplo, nada de lo que hagas toca sesiones reales.</p> : null}
        {children}
      </div>
    </div>
  );
}

export function Setup({ mode, onDone }) {
  const [rows, setRows] = useState([{ name: '', password: '' }, { name: '', password: '' }]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setRows(r => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api.setup(rows.filter(r => r.name.trim())); onDone(r.user); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Shell mode={mode}>
      <h1>Crea las cuentas del equipo</h1>
      <p class="muted">Una por persona que va a usar la flota. Cada acción queda registrada con su nombre, y cada sesión tiene un responsable.</p>
      <form onSubmit={submit} class="stack">
        {rows.map((r, i) => (
          <fieldset class="person" key={i}>
            <legend>Persona {i + 1}</legend>
            <label class="field"><span>Nombre</span>
              <input value={r.name} onInput={(e) => set(i, 'name', e.currentTarget.value)} placeholder={i ? 'Ej. Camilo' : 'Ej. Daniel'} autoFocus={i === 0} /></label>
            <label class="field"><span>Contraseña</span>
              <input type="password" value={r.password} onInput={(e) => set(i, 'password', e.currentTarget.value)} placeholder="Mínimo 6 caracteres" /></label>
          </fieldset>
        ))}
        <button type="button" class="link" onClick={() => setRows(r => [...r, { name: '', password: '' }])}>+ Agregar otra persona</button>
        {err ? <p class="err">{err}</p> : null}
        <Btn kind="primary" type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear cuentas y entrar'}</Btn>
      </form>
    </Shell>
  );
}

export function Login({ mode, onDone }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api.login(name, password); onDone(r.user); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Shell mode={mode}>
      <h1>Entrar</h1>
      <form onSubmit={submit} class="stack">
        <label class="field"><span>Nombre</span><input value={name} onInput={(e) => setName(e.currentTarget.value)} autoFocus autocomplete="username" /></label>
        <label class="field"><span>Contraseña</span><input type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="current-password" /></label>
        {err ? <p class="err">{err}</p> : null}
        <Btn kind="primary" type="submit" disabled={busy || !name || !password}>{busy ? 'Entrando…' : 'Entrar'}</Btn>
      </form>
    </Shell>
  );
}
