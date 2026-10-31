import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { render as renderMd } from './vendor/md.js';

// The nine statuses, with the TUI's own glyphs and colours (bin/fleet-grid.mjs's STATUS
// table) and words a person reads without a legend. Plus the two the cards carry as flags.
export const STATUS = {
  'need-you':  { glyph: '●', label: 'Te necesita',  color: 'red',    hint: 'Está esperando una respuesta o un permiso' },
  working:     { glyph: '◆', label: 'Trabajando',   color: 'cyan',   hint: 'Claude está en medio de un turno' },
  ready:       { glyph: '✓', label: 'Lista',        color: 'green',  hint: 'Terminó su turno, revisa lo que hizo' },
  parked:      { glyph: '⏸', label: 'En pausa',     color: 'grey',   hint: 'Pausada a propósito, no gasta cupo' },
  idle:        { glyph: '·', label: 'Inactiva',     color: 'grey',   hint: 'Abierta, sin tarea' },
  starting:    { glyph: '…', label: 'Arrancando',   color: 'yellow', hint: 'Se está abriendo' },
  limit:       { glyph: '⧗', label: 'Sin cupo',     color: 'yellow', hint: 'Llegó al límite de uso de la cuenta' },
  interrupted: { glyph: '⚠', label: 'Interrumpida', color: 'yellow', hint: 'Su turno se cortó' },
  unknown:     { glyph: '?', label: 'Sin datos',    color: 'yellow', hint: 'No se pudo leer su estado' },
  asleep:      { glyph: '☾', label: 'Dormida',      color: 'grey',   hint: 'Hibernada; se despierta con un clic' },
  lost:        { glyph: '✕', label: 'Perdida',      color: 'grey',   hint: 'La máquina cerró su proceso; se puede reabrir' },
};
export const statusOf = (c) => (c.lost ? 'lost' : c.asleep ? 'asleep' : c.status) || 'unknown';

export function StatusPill({ status, small }) {
  const s = STATUS[status] || STATUS.unknown;
  return <span class={`pill c-${s.color}${small ? ' sm' : ''}`} title={s.hint}><b>{s.glyph}</b> {s.label}</span>;
}

export function Avatar({ user, size = 26, title }) {
  if (!user) return <span class="avatar none" style={{ width: size, height: size }} title={title || 'Sin responsable'}>?</span>;
  const initials = user.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return <span class={`avatar c-${user.color}`} style={{ width: size, height: size, fontSize: size * 0.42 }} title={title || user.name}>{initials}</span>;
}

export function Btn({ kind = '', icon, children, ...rest }) {
  return <button type="button" class={`btn ${kind}`} {...rest}>{icon ? <span class="ico">{icon}</span> : null}{children}</button>;
}

export function Logo({ size = 28 }) {
  return <img src="/icons/icon-192.png" width={size} height={size} alt="" class="logo" />;
}

export function ago(sec) {
  if (sec == null) return '';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return 'ahora';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
export const sinceTs = (ts) => (ts ? ago(Date.now() / 1000 - ts) : '');
export const clock = (ts) => new Date(ts * 1000).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// Re-run `fn` every `ms` while mounted, and right away when `deps` change. Errors are kept,
// not thrown, so a flaky poll shows a line instead of blanking the screen.
export function usePoll(fn, ms, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const live = useRef(0);
  const run = useCallback(async () => {
    const id = live.current;
    try { const d = await fn(); if (id === live.current) { setData(d); setError(null); } }
    catch (e) { if (id === live.current) setError(e); }
    finally { if (id === live.current) setLoading(false); }
  }, deps);
  useEffect(() => {
    live.current++; setLoading(true); setData(null);
    run();
    if (!ms) return undefined;
    const t = setInterval(() => { if (!document.hidden) run(); }, ms);
    return () => clearInterval(t);
  }, [run]);
  return { data, error, loading, reload: run };
}

export function Markdown({ text }) {
  const ref = useRef(null);
  useEffect(() => {
    const n = ref.current;
    if (!n) return;
    n.replaceChildren();
    try { n.append(renderMd(String(text || ''), document)); } catch { n.textContent = text; }
  }, [text]);
  return <div class="md" ref={ref} />;
}

// ── modal, confirm, toast: one of each at a time, driven from anywhere ─────────────────
let pushToast = () => {};
export const toast = (text, kind = '') => pushToast({ text, kind, id: Math.random() });
export function Toasts() {
  const [list, setList] = useState([]);
  pushToast = (t) => { setList(l => [...l, t]); setTimeout(() => setList(l => l.filter(x => x.id !== t.id)), t.kind === 'bad' ? 7000 : 3500); };
  return <div class="toasts">{list.map(t => <div key={t.id} class={`toast ${t.kind}`}>{t.text}</div>)}</div>;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div class="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button class="x" aria-label="Cerrar" onClick={onClose}>✕</button></header>
        {children}
      </div>
    </div>
  );
}

// A destructive step names what it destroys and needs a second, deliberate click. When
// `typed` is set the person types it, for the ones that delete uncommitted work.
export function Confirm({ title, body, action, danger, typed, onYes, onClose }) {
  const [busy, setBusy] = useState(false);
  const [txt, setTxt] = useState('');
  const ok = !typed || txt.trim() === typed;
  return (
    <Modal title={title} onClose={onClose}>
      <div class="modal-body">{body}</div>
      {typed ? (
        <label class="field">
          <span>Escribe <code>{typed}</code> para confirmar</span>
          <input value={txt} onInput={(e) => setTxt(e.currentTarget.value)} autoFocus />
        </label>
      ) : null}
      <footer>
        <Btn onClick={onClose}>Cancelar</Btn>
        <Btn kind={danger ? 'danger' : 'primary'} disabled={!ok || busy}
             onClick={async () => { setBusy(true); try { await onYes(); onClose(); } finally { setBusy(false); } }}>
          {busy ? 'Un momento…' : action}
        </Btn>
      </footer>
    </Modal>
  );
}
