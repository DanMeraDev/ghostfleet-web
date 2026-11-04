// Automatizaciones: a trigger and steps, built with blocks you drag (or tap, on a phone), or by
// asking the AI tab beside the editor, which writes the draft into the same blocks. Either way
// the person sees what will run and saves it; the server runs it (server/automations.mjs).
import { useState, useRef, useEffect } from 'preact/hooks';
import { api } from './api.js';
import { Btn, Confirm, usePoll, clock, toast } from './ui.jsx';
import { ACTIONS, EVENTS, STATES, DAY_NAMES, blankTrigger, blankStep, describeTrigger, describeStep } from '../../shared/automations.js';

const EVERY = [15, 30, 60, 120, 180, 360, 720, 1440];
const everyLabel = (m) => (m % 1440 === 0 ? `${m / 1440} día` : m % 60 === 0 ? `${m / 60} h` : `${m} min`);
const blank = () => ({ id: null, name: '', enabled: true, visibility: 'personal', trigger: blankTrigger('schedule'), steps: [] });
const SEEN_KEY = 'gfw.noticesSeen';
export const noticesSeen = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
export const markNoticesSeen = (at) => { try { localStorage.setItem(SEEN_KEY, String(at)); } catch {} };
const short = (ts) => new Date(ts * 1000).toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

// ── the list ─────────────────────────────────────────────────────────────────────────
export function Automations({ ctx, projects, id }) {
  const { data, error, reload } = usePoll(() => api.automations(), 10000, []);
  if (id) return <Editor ctx={ctx} projects={projects} data={data} id={id} onSaved={reload} />;
  const list = data?.automations || [];
  const seenAt = noticesSeen();
  const fresh = (data?.notices || []).filter(n => n.at > seenAt);
  return (
    <div class="page autos">
      <header class="page-head">
        <div><h1>Automatizaciones</h1><p class="muted">Un disparador y unas acciones: a una hora, o cuando a una sesión le pasa algo.</p></div>
        <Btn kind="primary" icon="＋" onClick={() => ctx.go('/automatizaciones/nueva')}>Nueva</Btn>
      </header>
      {error ? <p class="err">{error.message}</p> : null}
      {fresh.length ? (
        <section class="notices">
          {fresh.map(n => <div key={n.id} class={`notice k-${n.kind}`}><span class="when">{clock(n.at)}</span> {n.text}</div>)}
          <Btn kind="ghost sm" onClick={() => { markNoticesSeen(fresh[0].at); reload(); }}>Ya los vi</Btn>
        </section>
      ) : null}
      {data && !list.length ? (
        <div class="empty">
          <b>Todavía no hay automatizaciones</b>
          <span class="muted">Por ejemplo: «de lunes a viernes a las 10:00, mándale al líder de vault-invers que revise los pendientes».</span>
          <Btn kind="primary" onClick={() => ctx.go('/automatizaciones/nueva')}>Crear la primera</Btn>
        </div>
      ) : null}
      <div class="auto-list">
        {list.map(a => <AutoCard key={a.id} a={a} ctx={ctx} onChange={reload} />)}
      </div>
      {(data?.runs || []).length ? (
        <section class="runs">
          <h2>Últimas ejecuciones</h2>
          {data.runs.map((r, i) => (
            <details key={i} class="run">
              <summary>
                <span class={`run-st s-${r.status}`}>{r.status === 'ok' ? '✓' : r.status === 'skipped' ? '↷' : '✕'}</span>
                <span class="when">{clock(r.at)}</span>
                <b class="ellipsis">{r.name}</b>
                <span class="muted ellipsis grow">{r.status === 'skipped' ? `se saltó: ${r.text}` : r.trigger}</span>
              </summary>
              {(r.steps || []).map((s, j) => <div key={j} class={`run-step${s.ok ? '' : ' bad'}`}>{s.halt ? '⏹' : s.ok ? '✓' : '✕'} {s.what}{s.text ? <small> — {s.text}</small> : null}</div>)}
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function AutoCard({ a, ctx, onChange }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    try { await api.saveAutomation({ ...a, enabled: !a.enabled }); onChange(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const runNow = async () => {
    setBusy(true);
    try { const r = await api.runAutomation(a.id); toast(r.ok ? `«${a.name}» corrió` : r.text, r.ok ? 'good' : 'bad'); onChange(); }
    catch (e) { toast(e.message, 'bad'); }
    finally { setBusy(false); }
  };
  return (
    <article class={`auto-card${a.enabled ? '' : ' off'}`}>
      <div class="auto-top">
        <label class="switch" title={a.enabled ? 'Encendida' : 'Apagada'}>
          <input type="checkbox" checked={a.enabled} onChange={toggle} aria-label={`${a.enabled ? 'Apagar' : 'Encender'} ${a.name}`} /><i />
        </label>
        <a class="auto-name" href={`#/automatizaciones/${a.id}`}>{a.name}</a>
        <span class={`tag${a.visibility === 'team' ? ' team' : ''}`}>{a.visibility === 'team' ? 'Equipo' : 'Personal'}</span>
        {!a.mine ? <span class="muted small">de {a.ownerName}</span> : null}
      </div>
      <div class="auto-flow">
        <span class="chip-trigger">{a.trigger.type === 'event' ? '⚡' : '🕑'} {describeTrigger(a.trigger)}</span>
        {a.steps.map((s, i) => <span key={i} class="chip-step"><i>→</i> {ACTIONS[s.action]?.icon} {describeStep(s)}</span>)}
      </div>
      <div class="auto-foot">
        <span class="muted small">
          {a.running ? 'Corriendo ahora…' : a.nextRun ? `Próxima: ${short(a.nextRun)}` : a.trigger.type === 'event' && a.enabled ? 'Esperando el evento' : a.enabled ? '' : 'Apagada'}
          {a.lastRun ? ` · última ${short(a.lastRun.at)} ${a.lastRun.ok ? '✓' : '✕'}` : ''}
        </span>
        <span class="grow" />
        <Btn kind="ghost sm" disabled={busy} onClick={runNow}>{busy ? 'Corriendo…' : '▶ Probar ahora'}</Btn>
        <Btn kind="ghost sm" onClick={() => ctx.go(`/automatizaciones/${a.id}`)}>Editar</Btn>
        <Btn kind="ghost sm" onClick={() => setAsk(true)} aria-label={`Borrar ${a.name}`}>✕</Btn>
      </div>
      {ask ? <Confirm title="Borrar la automatización" danger action="Borrar"
                      body={<p>Se borra <b>{a.name}</b>. Lo que ya corrió queda en el historial.</p>}
                      onYes={async () => { await api.deleteAutomation(a.id); onChange(); }} onClose={() => setAsk(false)} /> : null}
    </article>
  );
}

// ── the editor ───────────────────────────────────────────────────────────────────────
function Editor({ ctx, projects, data, id, onSaved }) {
  const existing = id !== 'nueva' ? data?.automations?.find(a => a.id === id) : null;
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState('edit');             // phones: editor or AI, one at a time
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!draft && (id === 'nueva' || existing)) setDraft(existing ? structuredClone(existing) : blank()); }, [existing, id]);
  if (!draft) return <div class="page"><p class="muted">{data ? 'No encontré esa automatización.' : 'Cargando…'}</p></div>;
  const set = (patch) => setDraft(d => ({ ...d, ...patch }));
  const setTrigger = (patch) => setDraft(d => ({ ...d, trigger: { ...d.trigger, ...patch } }));
  const setStep = (i, patch) => setDraft(d => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const insert = (action, at) => setDraft(d => { const steps = [...d.steps]; steps.splice(at ?? steps.length, 0, blankStep(action)); return { ...d, steps }; });
  const move = (from, to) => setDraft(d => {
    const steps = [...d.steps]; const [s] = steps.splice(from, 1); steps.splice(to > from ? to - 1 : to, 0, s); return { ...d, steps };
  });
  const remove = (i) => setDraft(d => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }));
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.saveAutomation(draft);
      toast(`«${r.automation.name}» guardada${r.automation.enabled ? '' : ' (apagada)'}`, 'good');
      onSaved(); ctx.go('/automatizaciones');
    } catch (e) { toast(e.message, 'bad'); }
    finally { setSaving(false); }
  };
  const isEvent = draft.trigger.type === 'event';
  return (
    <div class="page autos-edit">
      <header class="page-head">
        <div class="grow">
          <a class="muted small" href="#/automatizaciones">← Automatizaciones</a>
          <input class="auto-title" placeholder="Nombre de la automatización" value={draft.name}
                 onInput={(e) => set({ name: e.currentTarget.value })} aria-label="Nombre" />
        </div>
        <div class="row wrap">
          <select value={draft.visibility} onChange={(e) => set({ visibility: e.currentTarget.value })} aria-label="Quién la ve"
                  disabled={existing && !existing.mine}>
            <option value="personal">Personal: solo yo</option>
            <option value="team">Equipo: la ven todos</option>
          </select>
          <label class="switch-l"><span class="switch"><input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.currentTarget.checked })} /><i /></span> Encendida</label>
          <Btn kind="primary" disabled={saving} onClick={save}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
        </div>
      </header>
      <div class="tabs-m" role="tablist">
        <button class={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>Editor</button>
        <button class={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}>✦ Pedírselo a la IA</button>
      </div>
      <div class={`builder show-${tab}`}>
        <Palette onAdd={(a) => insert(a)} onTrigger={(t) => setTrigger(blankTrigger(t))} />
        <div class="flow" aria-label="Flujo">
          <TriggerBlock t={draft.trigger} projects={projects} onChange={setTrigger} onType={(t) => set({ trigger: blankTrigger(t) })} />
          {draft.steps.map((s, i) => (
            <div key={i} class="flow-item">
              <Drop at={i} onAdd={insert} onMove={move} />
              <StepBlock s={s} i={i} n={draft.steps.length} isEvent={isEvent} projects={projects}
                         onChange={(p) => setStep(i, p)} onRemove={() => remove(i)} onMove={move} />
            </div>
          ))}
          <Drop at={draft.steps.length} onAdd={insert} onMove={move} last empty={!draft.steps.length} />
        </div>
        <AIPanel draft={draft} onDraft={(a) => setDraft(d => ({ ...d, ...a, id: d.id, visibility: d.visibility, enabled: d.enabled }))} />
      </div>
    </div>
  );
}

function Palette({ onAdd, onTrigger }) {
  const drag = (e, kind, v) => { e.dataTransfer.setData('text/plain', `${kind}:${v}`); e.dataTransfer.effectAllowed = 'copy'; };
  return (
    <aside class="palette" aria-label="Bloques">
      <h3>Disparadores</h3>
      <button class="blk trig" draggable onDragStart={(e) => drag(e, 'trigger', 'schedule')} onClick={() => onTrigger('schedule')}>🕑 Horario</button>
      <button class="blk trig" draggable onDragStart={(e) => drag(e, 'trigger', 'event')} onClick={() => onTrigger('event')}>⚡ Evento de una sesión</button>
      <h3>Acciones</h3>
      {Object.entries(ACTIONS).map(([k, d]) => (
        <button key={k} class={`blk${d.danger ? ' danger' : ''}`} draggable onDragStart={(e) => drag(e, 'action', k)} onClick={() => onAdd(k)}
                title="Arrástrala al flujo, o tócala para agregarla al final">
          <span class="blk-ico">{d.icon}</span> {d.label}
        </button>
      ))}
      <p class="muted small">Arrastra un bloque al flujo, o tócalo para sumarlo al final.</p>
    </aside>
  );
}

function Drop({ at, onAdd, onMove, last, empty }) {
  const [over, setOver] = useState(false);
  const onDrop = (e) => {
    e.preventDefault(); setOver(false);
    const [kind, v] = e.dataTransfer.getData('text/plain').split(':');
    if (kind === 'action' && ACTIONS[v]) onAdd(v, at);
    if (kind === 'move') onMove(Number(v), at);
  };
  return (
    <div class={`drop${over ? ' over' : ''}${last ? ' last' : ''}${empty ? ' empty' : ''}`}
         onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      {empty ? 'Arrastra aquí una acción de la izquierda (o tócala)' : last ? '＋ suelta aquí para agregar al final' : null}
    </div>
  );
}

function TriggerBlock({ t, projects, onChange, onType }) {
  const [over, setOver] = useState(false);
  const sessions = (projects || []).find(p => p.name === t.project)?.sessions || [];
  return (
    <section class={`node trigger${over ? ' over' : ''}`}
             onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
             onDrop={(e) => { e.preventDefault(); setOver(false); const [k, v] = e.dataTransfer.getData('text/plain').split(':'); if (k === 'trigger') onType(v); }}>
      <header><span class="node-k">Cuándo</span>
        <div class="seg">
          <button class={t.type === 'schedule' ? 'on' : ''} onClick={() => t.type !== 'schedule' && onType('schedule')}>🕑 Horario</button>
          <button class={t.type === 'event' ? 'on' : ''} onClick={() => t.type !== 'event' && onType('event')}>⚡ Evento</button>
        </div>
      </header>
      {t.type === 'schedule' ? (
        <div class="node-body">
          <div class="seg sm">
            <button class={t.mode === 'days' ? 'on' : ''} onClick={() => onChange({ mode: 'days' })}>Ciertos días</button>
            <button class={t.mode === 'once' ? 'on' : ''} onClick={() => onChange({ mode: 'once' })}>Una vez</button>
            <button class={t.mode === 'every' ? 'on' : ''} onClick={() => onChange({ mode: 'every' })}>Cada cierto tiempo</button>
          </div>
          {t.mode === 'days' ? (
            <div class="days" role="group" aria-label="Días">
              {[1, 2, 3, 4, 5, 6, 0].map(d => (
                <button key={d} class={t.days.includes(d) ? 'on' : ''} aria-pressed={t.days.includes(d)}
                        onClick={() => onChange({ days: t.days.includes(d) ? t.days.filter(x => x !== d) : [...t.days, d] })}>{DAY_NAMES[d]}</button>
              ))}
            </div>
          ) : null}
          {t.mode === 'once' ? <label class="field"><span>Fecha</span><input type="date" value={t.date} onInput={(e) => onChange({ date: e.currentTarget.value })} /></label> : null}
          {t.mode !== 'every' ? <label class="field"><span>Hora</span><input type="time" value={t.at} onInput={(e) => onChange({ at: e.currentTarget.value })} /></label> : (
            <label class="field"><span>Cada</span>
              <select value={t.minutes} onChange={(e) => onChange({ minutes: Number(e.currentTarget.value) })}>
                {EVERY.map(m => <option key={m} value={m}>{everyLabel(m)}</option>)}
              </select>
            </label>
          )}
        </div>
      ) : (
        <div class="node-body">
          <label class="field"><span>Cuando una sesión…</span>
            <select value={t.event} onChange={(e) => onChange({ event: e.currentTarget.value })}>
              {Object.entries(EVENTS).map(([k, d]) => <option key={k} value={k}>{d.label} ({d.hint})</option>)}
            </select>
          </label>
          <div class="row wrap">
            <label class="field grow"><span>De qué proyecto</span>
              <select value={t.project} onChange={(e) => onChange({ project: e.currentTarget.value, session: '*' })}>
                <option value="*">Cualquier proyecto</option>
                {(projects || []).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </label>
            <label class="field grow"><span>Qué sesión</span>
              <select value={t.session} onChange={(e) => onChange({ session: e.currentTarget.value })} disabled={t.project === '*'}>
                <option value="*">Cualquiera</option>
                {sessions.map(s => <option key={s.name} value={s.name}>{s.lead ? `${s.name} (líder)` : s.name}</option>)}
              </select>
            </label>
          </div>
          <label class="field"><span>No repetir con la misma sesión antes de (min)</span>
            <input type="number" min="1" max="1440" value={t.cooldown} onInput={(e) => onChange({ cooldown: Number(e.currentTarget.value) })} />
          </label>
        </div>
      )}
      <p class="node-say">{describeTrigger(t)}</p>
    </section>
  );
}

function StepBlock({ s, i, n, isEvent, projects, onChange, onRemove, onMove }) {
  const d = ACTIONS[s.action];
  const [grab, setGrab] = useState(false);
  const fromEvent = s.project === '{proyecto}';
  const sessions = (projects || []).find(p => p.name === s.project)?.sessions || [];
  const has = (f) => d.needs.includes(f) || d.optional?.includes(f);
  return (
    <section class={`node step${d.danger ? ' danger' : ''}${grab ? ' grab' : ''}`} draggable={grab}
             onDragStart={(e) => { e.dataTransfer.setData('text/plain', `move:${i}`); e.dataTransfer.effectAllowed = 'move'; }}
             onDragEnd={() => setGrab(false)}>
      <header>
        <span class="handle" title="Arrastra para mover" onMouseDown={() => setGrab(true)} onMouseUp={() => setGrab(false)}>⋮⋮</span>
        <span class="node-k">{i + 1}. {d.icon} {d.label}</span>
        <span class="grow" />
        <button class="icon-btn" disabled={i === 0} onClick={() => onMove(i, i - 1)} aria-label="Subir">↑</button>
        <button class="icon-btn" disabled={i === n - 1} onClick={() => onMove(i, i + 2)} aria-label="Bajar">↓</button>
        <button class="icon-btn" onClick={onRemove} aria-label="Quitar paso">✕</button>
      </header>
      <div class="node-body">
        {has('project') ? (
          <div class="row wrap">
            <label class="field grow"><span>Proyecto</span>
              <select value={s.project} onChange={(e) => {
                const v = e.currentTarget.value;
                onChange(v === '{proyecto}' ? { project: v, session: '{sesion}' } : { project: v, session: '' });
              }}>
                <option value="">Elige…</option>
                {isEvent ? <option value="{proyecto}">El del evento</option> : null}
                {(projects || []).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </label>
            {has('session') ? (
              <label class="field grow"><span>Sesión</span>
                <select value={s.session} onChange={(e) => onChange({ session: e.currentTarget.value })} disabled={!s.project}>
                  <option value="">Elige…</option>
                  {isEvent ? <option value="{sesion}">La sesión del evento</option> : null}
                  {!fromEvent ? sessions.map(x => <option key={x.name} value={x.name}>{x.lead ? `${x.name} (líder)` : x.name}</option>) : null}
                </select>
              </label>
            ) : null}
            {has('name') ? (
              <label class="field grow"><span>Nombre de la sesión nueva</span>
                <input value={s.name} placeholder="revision-{fecha}" onInput={(e) => onChange({ name: e.currentTarget.value })} />
              </label>
            ) : null}
          </div>
        ) : null}
        {has('prompt') ? (
          <label class="field"><span>{s.action === 'send' ? 'Mensaje' : s.action === 'spawn' ? 'Tarea inicial (opcional)' : 'Mensaje al reanudar (opcional)'}</span>
            <textarea rows={3} value={s.prompt} placeholder="Puedes usar {fecha}, {hora}, {proyecto}, {sesion}"
                      onInput={(e) => onChange({ prompt: e.currentTarget.value })} />
          </label>
        ) : null}
        {has('branch') ? <label class="field"><span>Rama (opcional)</span><input value={s.branch} onInput={(e) => onChange({ branch: e.currentTarget.value })} /></label> : null}
        {s.action === 'notify' ? <label class="field"><span>Texto del aviso</span><input value={s.text} placeholder="{sesion} terminó en {proyecto}" onInput={(e) => onChange({ text: e.currentTarget.value })} /></label> : null}
        {s.action === 'check' ? (
          <div class="field"><span>…si ahora está</span>
            <div class="days states" role="group" aria-label="Estados">
              {Object.entries(STATES).map(([k, label]) => (
                <button key={k} class={s.status.includes(k) ? 'on' : ''} aria-pressed={s.status.includes(k)}
                        onClick={() => onChange({ status: s.status.includes(k) ? s.status.filter(x => x !== k) : [...s.status, k] })}>{label}</button>
              ))}
            </div>
            <small class="muted">Si no está así, la automatización termina aquí (no cuenta como error).</small>
          </div>
        ) : null}
        {s.action === 'wait' ? <label class="field"><span>Minutos (1 a 60)</span><input type="number" min="1" max="60" value={s.minutes} onInput={(e) => onChange({ minutes: Number(e.currentTarget.value) })} /></label> : null}
        {d.danger ? (
          <label class="check danger"><input type="checkbox" checked={s.confirmed} onChange={(e) => onChange({ confirmed: e.currentTarget.checked })} />
            Confirmo que esta automatización puede detener la sesión (el worktree queda libre, no se borra)</label>
        ) : null}
      </div>
    </section>
  );
}

// ── the AI tab: say it, it fills the blocks ───────────────────────────────────────────
function AIPanel({ draft, onDraft }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(null);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  const ask = async () => {
    const t = text.trim();
    if (!t || busy) return;
    const next = [...msgs, { role: 'user', text: t }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const has = draft.steps.length || draft.name;
      const r = await api.automationAI(next, has ? { name: draft.name, trigger: draft.trigger, steps: draft.steps } : null);
      setMsgs(m => [...m, { role: 'ai', text: r.reply, applied: !!r.automation }]);
      if (r.automation) { setUndo(structuredClone(draft)); onDraft(r.automation); }
    } catch (e) { setMsgs(m => [...m, { role: 'ai', text: `No pude: ${e.message}`, error: true }]); }
    finally { setBusy(false); }
  };
  return (
    <aside class="ai-panel" aria-label="Pedírselo a la IA">
      <h3>✦ Pedírselo a la IA</h3>
      <div class="ai-msgs">
        {!msgs.length ? <p class="muted small">Dile qué quieres en una frase, por ejemplo: «todos los días a las 9, despierta a los workers de practiq y mándale al líder que reparta lo pendiente». Arma los bloques y tú revisas antes de guardar.</p> : null}
        {msgs.map((m, i) => (
          <div key={i} class={`ai-msg ${m.role}${m.error ? ' error' : ''}`}>
            {m.text}
            {m.applied ? <small class="ai-applied">✓ Lo puse en el editor{undo && i === msgs.length - 1 ? <> · <a href="#" onClick={(e) => { e.preventDefault(); onDraft(undo); setUndo(null); }}>deshacer</a></> : null}</small> : null}
          </div>
        ))}
        {busy ? <div class="ai-msg ai muted">Armándolo…</div> : null}
        <div ref={end} />
      </div>
      <div class="ai-input">
        <textarea rows={2} value={text} placeholder="¿Qué quieres automatizar?" onInput={(e) => setText(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
        <Btn kind="primary" disabled={busy || !text.trim()} onClick={ask}>Enviar</Btn>
      </div>
    </aside>
  );
}
