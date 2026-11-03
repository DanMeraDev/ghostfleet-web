import { useState, useEffect, useRef } from 'preact/hooks';
import { api, ATTACH_PER_MESSAGE } from './api.js';
import { statusOf, StatusPill, Avatar, Btn, usePoll, toast, Markdown, Confirm, Modal, sinceTs } from './ui.jsx';
import { render as renderAnsi } from './vendor/ansi.js';

// Claude's dialog speaks English; the buttons say what pressing them does.
function optionText(label) {
  const l = String(label || '');
  if (/^yes,? and don.?t ask again/i.test(l)) return { text: 'Sí, y no volver a preguntar', sub: l, kind: 'yes' };
  if (/^yes,? allow all edits/i.test(l)) return { text: 'Sí, permitir todas las ediciones de esta sesión', sub: l, kind: 'yes' };
  if (/^yes/i.test(l)) return { text: 'Sí, permitir', sub: l, kind: 'yes' };
  if (/^no/i.test(l)) return { text: 'No, decirle otra cosa', sub: l, kind: 'no' };
  return { text: l, sub: '', kind: '' };
}

function PromptCard({ prompt, onAnswer, busy }) {
  const [typed, setTyped] = useState('');
  if (prompt.kind === 'permission') {
    return (
      <div class="ask permission">
        <div class="ask-head"><b>● Claude pide permiso</b><span>{prompt.tool || 'una herramienta'}</span></div>
        {prompt.command ? <pre class="ask-cmd">{prompt.command.replace(/╌+/g, '').trim()}</pre> : null}
        <div class="ask-opts">
          {(prompt.options || []).map(o => {
            const t = optionText(o.label);
            return (
              <button key={o.n} disabled={busy} class={`opt ${t.kind}`} onClick={() => onAnswer(String(o.n), false)}>
                <span class="n">{o.n}</span><span><b>{t.text}</b>{t.sub ? <small>{t.sub}</small> : null}</span>
              </button>
            );
          })}
        </div>
        <p class="muted small">Revisa el comando antes de permitirlo: corre en el worktree de esta sesión, con tu cuenta.</p>
      </div>
    );
  }
  const tabs = (prompt.tabs || []).filter(t => !t.submit);
  return (
    <div class="ask question">
      <div class="ask-head"><b>● Claude te pregunta</b>
        {tabs.length > 1 ? <span>pregunta {prompt.tab != null ? prompt.tab + 1 : '?'} de {tabs.length}</span> : null}
        {prompt.submit ? <span>revisar y enviar</span> : null}</div>
      <p class="ask-q">{prompt.question}</p>
      {prompt.typing ? (
        <form class="row" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) onAnswer(typed.trim(), false); }}>
          <input class="grow" value={typed} onInput={(e) => setTyped(e.currentTarget.value)} placeholder="Escribe tu respuesta" autoFocus />
          <Btn kind="primary" type="submit" disabled={busy || !typed.trim()}>Enviar</Btn>
        </form>
      ) : (
        <div class="ask-opts">
          {(prompt.options || []).map(o => (
            <button key={o.n} disabled={busy} class={`opt${o.chosen ? ' chosen' : ''}`} onClick={() => onAnswer(String(o.n), true)}>
              <span class="n">{o.n}</span><span><b>{o.label}</b>{o.description ? <small>{o.description}</small> : null}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Terminal({ pane }) {
  const ref = useRef(null);
  const stick = useRef(true);
  const html = pane ? renderAnsi(pane).html : '';
  useEffect(() => { const n = ref.current; if (n && stick.current) n.scrollTop = n.scrollHeight; }, [html]);
  return (
    <div class="term" ref={ref} onScroll={(e) => { const n = e.currentTarget; stick.current = n.scrollHeight - n.scrollTop - n.clientHeight < 40; }}>
      {pane == null ? <p class="muted">Leyendo la terminal…</p> : <pre class="pane" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

function Chat({ ctx, msgs, queued, older, onOlder }) {
  const ref = useRef(null);
  const stick = useRef(true);
  const last = msgs.length ? `${msgs.length}:${msgs[msgs.length - 1].ts}` : '';
  useEffect(() => { const n = ref.current; if (n && stick.current) n.scrollTop = n.scrollHeight; }, [last, queued.length]);
  return (
    <div class="chat" ref={ref} onScroll={(e) => { const n = e.currentTarget; stick.current = n.scrollHeight - n.scrollTop - n.clientHeight < 60; }}>
      {older ? <button class="link center" onClick={onOlder}>Cargar mensajes anteriores</button> : null}
      {!msgs.length ? <p class="muted center">Todavía no hay mensajes en esta sesión.</p> : null}
      {msgs.map((m, i) => {
        if (m.role === 'tools') {
          const tools = m.tools || [];
          const names = [...new Set(tools.map(t => t.name))];
          return (
            <details key={`${m.ts}-${i}`} class="tools">
              <summary>⚙ {tools.length} {tools.length === 1 ? 'acción' : 'acciones'} · {names.slice(0, 4).join(', ')}{names.length > 4 ? '…' : ''}<span class="when">{sinceTs(m.ts)}</span></summary>
              <ul>{tools.map((t, j) => <li key={j}><b>{t.name}</b> <span>{t.detail}</span></li>)}</ul>
            </details>
          );
        }
        const by = m.by ? ctx.usersById[m.by] : null;
        return (
          <div key={`${m.ts}-${i}`} class={`msg ${m.role === 'user' ? 'me' : 'ai'}`}>
            <div class="who">
              {m.role === 'user'
                ? <>{by ? <><Avatar user={by} size={18} /> {by.name}</> : 'Instrucción'}</>
                : 'Claude'}
              <span class="when">{sinceTs(m.ts)}</span>
            </div>
            <div class="bubble">{m.role === 'user' ? <p class="plain">{m.text}</p> : <Markdown text={m.text} />}</div>
          </div>
        );
      })}
      {queued.map((q, i) => (
        <div key={`q${i}`} class="msg me pending">
          <div class="who">En cola · se entrega cuando termine el turno</div>
          <div class="bubble"><p class="plain">{q.text}</p></div>
        </div>
      ))}
    </div>
  );
}

const hhmm = (at) => new Date(at * 1000).toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function ScheduleModal({ name, onClose, onSave }) {
  const [msg, setMsg] = useState('continúa');
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 3600e3)));
  const [busy, setBusy] = useState(false);
  const quick = [
    ['En 30 min', () => Date.now() + 30 * 60e3],
    ['En 1 hora', () => Date.now() + 3600e3],
    ['En 3 horas', () => Date.now() + 3 * 3600e3],
    ['Mañana 9:00', () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); }],
  ];
  const save = async (ms) => { setBusy(true); try { await onSave(Math.floor(ms / 1000), msg.trim() || 'continúa'); onClose(); } finally { setBusy(false); } };
  return (
    <Modal title={`Programar un mensaje para ${name}`} onClose={onClose}>
      <div class="stack modal-body">
        <p class="muted">A la hora que elijas, ghostfleet le escribe este mensaje a la sesión, aunque nadie esté mirando. Sirve para retomar después del límite de uso o dejar algo para mañana.</p>
        <label class="field"><span>Mensaje</span><textarea rows={3} value={msg} onInput={(e) => setMsg(e.currentTarget.value)} /></label>
        <div class="quick">{quick.map(([l, f]) => <Btn key={l} kind="ghost" disabled={busy} onClick={() => save(f())}>{l}</Btn>)}</div>
        <label class="field"><span>…o a una hora exacta</span><input type="datetime-local" value={when} onInput={(e) => setWhen(e.currentTarget.value)} /></label>
        <footer><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={busy || !when} onClick={() => save(new Date(when).getTime())}>Programar</Btn></footer>
      </div>
    </Modal>
  );
}

export function SessionView({ ctx, project, name, card, onChanged, onGone }) {
  const [tab, setTab] = useState('chat');
  const [extra, setExtra] = useState([]);      // older pages, loaded on demand
  const [before, setBefore] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [rename, setRename] = useState(null);
  const [menu, setMenu] = useState(false);
  const [labelEdit, setLabelEdit] = useState(null);
  const [schedOpen, setSchedOpen] = useState(false);
  const [files, setFiles] = useState([]);       // {id, name, size, state: 'up'|'ok'|'err', path, preview, why}
  const [drag, setDrag] = useState(false);
  const picker = useRef(null);
  const typing = useRef(false);
  useEffect(() => { setFiles([]); }, [project, name]);

  const sess = usePoll(() => api.session(project, name), 3000, [project, name]);
  const pane = usePoll(() => api.pane(project, name), 2500, [project, name]);
  useEffect(() => { setBefore(sess.data?.next_before ?? null); }, [sess.data?.next_before]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) api.presence(project, name, typing.current).catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, [project, name]);

  const st = card ? statusOf(card) : (sess.data?.status || 'unknown');
  const owner = card?.owner || sess.data?.owner || null;
  const prompt = pane.data?.prompt || null;
  const others = (pane.data?.here || []).filter(h => h.user !== ctx.me.id);

  const act = async (tool, args = {}, opts = {}) => {
    setBusy(true);
    try {
      const r = await api.act(tool, { project, session: name, ...args }, opts);
      if (r.queued === 'question') toast('Quedó en cola: la sesión tiene una pregunta pendiente. Respóndela primero.', '');
      else if (r.queued) toast('Quedó en cola: se entrega cuando termine el turno actual.', '');
      onChanged(); sess.reload(); pane.reload();
      return r;
    } catch (e) {
      if (e.body?.changed) { toast('El pedido cambió mientras lo mirabas; no se envió nada. Revisa de nuevo.', 'bad'); pane.reload(); }
      else toast(e.message, 'bad');
      return null;
    } finally { setBusy(false); }
  };
  const answer = (text, noEnter) => act('fleet_answer', { text, no_enter: noEnter, expect: prompt?.fingerprint });
  // Each file goes up as soon as it is picked, so "Enviar" only sends the words that name them.
  const addFiles = (list) => {
    const picked = [...(list || [])].slice(0, Math.max(0, ATTACH_PER_MESSAGE - files.length));
    if (list?.length > picked.length) toast(`Hasta ${ATTACH_PER_MESSAGE} archivos por mensaje.`, '');
    for (const f of picked) {
      const id = Math.random().toString(36).slice(2);
      const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : null;
      setFiles(x => [...x, { id, name: f.name || 'imagen pegada', size: f.size, state: 'up', preview }]);
      api.attach(project, name, f)
        .then(r => setFiles(x => x.map(y => y.id === id ? { ...y, state: 'ok', path: r.path } : y)))
        .catch(e => setFiles(x => x.map(y => y.id === id ? { ...y, state: 'err', why: e.message } : y)));
    }
  };
  const dropFile = (id) => setFiles(x => { const f = x.find(y => y.id === id); if (f?.preview) URL.revokeObjectURL(f.preview); return x.filter(y => y.id !== id); });
  const uploading = files.some(f => f.state === 'up');
  const ready = files.filter(f => f.state === 'ok');
  const sendDraft = async () => {
    const text = draft.trim();
    if ((!text && !ready.length) || uploading) return;
    // Words first: a message that opens with a path (`/home/…`) reads as a slash command.
    const list = ready.map(f => `- ${f.path}`).join('\n');
    const prompt = !ready.length ? text
      : `${text || (ready.length === 1 ? 'Te adjunto este archivo.' : 'Te adjunto estos archivos.')}\n\n` +
        `${ready.length === 1 ? 'Archivo adjunto (ábrelo desde esta ruta)' : 'Archivos adjuntos (ábrelos desde estas rutas)'}:\n${list}`;
    const r = await act('fleet_send', { prompt });
    if (r) { setDraft(''); typing.current = false; for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview); setFiles([]); }
  };
  const loadOlder = async () => {
    try {
      const r = await api.session(project, name, before);
      setExtra(x => [...(r.messages || []), ...x]); setBefore(r.next_before ?? null);
    } catch (e) { toast(e.message, 'bad'); }
  };

  const stop = (reclaim) => setConfirm({
    title: reclaim ? 'Detener y borrar el worktree' : 'Detener la sesión',
    action: reclaim ? 'Detener y borrar' : 'Detener', danger: true,
    typed: reclaim ? name : null,
    body: reclaim
      ? <p>Se cierra <b>{name}</b> y se borra su worktree. ghostfleet solo lo borra si no hay cambios sin guardar y la rama está subida o mergeada; si no, la detiene igual y deja la carpeta, diciendo por qué.</p>
      : <p>Se cierra <b>{name}</b> para siempre. Su worktree y su rama quedan como están, y la conversación se conserva.</p>,
    onYes: async () => { const r = await act('fleet_stop', reclaim ? { reclaim: true } : {}, { confirm: true }); if (r) { toast(r.text?.split('\n')[0] || 'Detenida', 'good'); onGone(); } },
  });

  const msgs = [...extra, ...(sess.data?.messages || [])];
  const parked = st === 'parked';
  return (
    <section class="session">
      <header class="sess-head">
        <div class="sess-title">
          <button class="link back" onClick={onGone} aria-label="Volver">←</button>
          <h1>{name}</h1>
          <StatusPill status={st} />
          {card?.branch ? <span class="branch">⎇ {card.branch}</span> : null}
          {card?.pr ? <span class="tag pr">PR {card.pr}</span> : null}
          {card?.label ? <button class="chip-label" title="Cambiar etiqueta" onClick={() => setLabelEdit(card.label)}>🏷 {card.label}</button> : null}
          {card?.sched ? (
            <span class="chip-sched" title={`Mensaje programado: ${card.sched.msg || ''}`}>⏰ {hhmm(card.sched.at)} · “{String(card.sched.msg || '').slice(0, 30)}”
              <button aria-label="Cancelar programación" onClick={() => act('gfw_unschedule')}>✕</button></span>
          ) : null}
        </div>
        <div class="sess-tools">
          <label class="owner-pick" title="Responsable de esta sesión">
            <Avatar user={owner ? ctx.usersById[owner] : null} size={24} />
            <select value={owner || ''} onChange={async (e) => {
              try { await api.assign(project, name, e.currentTarget.value || null); onChanged(); sess.reload(); }
              catch (x) { toast(x.message, 'bad'); }
            }}>
              <option value="">Sin responsable</option>
              {ctx.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          {st === 'working' ? <Btn kind="ghost sm" disabled={busy} onClick={() => act('fleet_interrupt')} title="Corta el turno actual, como apretar Esc">⏹ Interrumpir</Btn> : null}
          {st === 'asleep' ? <Btn kind="ghost sm" disabled={busy} onClick={() => act('fleet_wake')}>☾ Despertar</Btn> : null}
          {st === 'lost' ? <Btn kind="ghost sm" disabled={busy} onClick={() => act('fleet_reopen')}>↺ Reabrir</Btn> : null}
          {!card?.lead && !['asleep', 'lost'].includes(st)
            ? <Btn kind="ghost sm" disabled={busy} onClick={() => act(parked ? 'fleet_resume' : 'fleet_pause')}>{parked ? '▶ Reanudar' : '⏸ Pausar'}</Btn> : null}
          <div class="menu-wrap">
            <Btn kind="ghost sm" onClick={() => setMenu(m => !m)} aria-expanded={menu}>Más ▾</Btn>
            {menu ? (
              <div class="menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => { setMenu(false); setLabelEdit(card?.label || ''); }}>🏷 Ponerle etiqueta…</button>
                <button onClick={() => { setMenu(false); setSchedOpen(true); }}>⏰ Programar un mensaje…</button>
                <button onClick={() => { setMenu(false); setRename(name); }}>Renombrar…</button>
                {!card?.lead ? <button onClick={() => { setMenu(false); stop(false); }}>Detener sesión…</button> : null}
                {!card?.lead ? <button class="danger" onClick={() => { setMenu(false); stop(true); }}>Detener y borrar worktree…</button> : null}
              </div>
            ) : null}
          </div>
        </div>
        {others.length ? (
          <p class="presence">
            {others.map(h => <Avatar key={h.user} user={ctx.usersById[h.user]} size={18} />)}
            {' '}{others.map(h => ctx.usersById[h.user]?.name || h.user).join(' y ')}
            {others.some(h => h.typing) ? ' está escribiendo en esta sesión…' : ' también está viendo esta sesión'}
          </p>
        ) : null}
      </header>

      {st === 'limit' ? (
        <div class="ask limit">
          <div class="ask-head"><b>⧗ Llegó al límite de uso de la cuenta</b>{card?.limit_at ? <span>el cupo vuelve {hhmm(card.limit_at)}</span> : null}</div>
          <p class="muted small">Mientras tanto no puede seguir. Puedes dejarlo programado para que retome solo.</p>
          {card?.sched
            ? <p>Ya está programado para {hhmm(card.sched.at)}.</p>
            : <div class="row wrap">
                <Btn kind="primary" disabled={busy} onClick={() => act('gfw_schedule', { at: (card?.limit_at || Math.floor(Date.now() / 1000) + 5 * 3600) + 90, msg: 'continúa con la tarea donde la dejaste' })}>
                  ⏰ Retomar solo cuando vuelva el cupo</Btn>
                <Btn kind="ghost" onClick={() => setSchedOpen(true)}>Elegir otra hora…</Btn>
              </div>}
        </div>
      ) : null}

      {prompt ? <PromptCard key={prompt.fingerprint} prompt={prompt} onAnswer={answer} busy={busy} /> : null}

      <div class="tabs" role="tablist">
        <button role="tab" class={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Conversación</button>
        <button role="tab" class={tab === 'term' ? 'on' : ''} onClick={() => setTab('term')}>Terminal en vivo</button>
      </div>
      {tab === 'chat'
        ? (sess.error && !sess.data
            ? <p class="err pad">No se pudo leer la conversación: {sess.error.message}</p>
            : <Chat ctx={ctx} msgs={msgs} queued={sess.data?.queued || []} older={before != null} onOlder={loadOlder} />)
        : <Terminal pane={pane.data?.pane ?? null} />}

      <form class={`composer${drag ? ' drag' : ''}`} onSubmit={(e) => { e.preventDefault(); sendDraft(); }}
            onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDrag(true); } }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); } }}>
        {files.length ? (
          <div class="att-list">
            {files.map(f => (
              <span key={f.id} class={`att att-${f.state}`} title={f.why || f.path || f.name}>
                {f.preview ? <img src={f.preview} alt="" /> : <i class="att-ico">📄</i>}
                <span class="att-name">{f.name}</span>
                <small>{f.state === 'up' ? 'subiendo…' : f.state === 'err' ? 'no se subió' : `${Math.max(1, Math.round(f.size / 1024))} KB`}</small>
                <button type="button" class="att-x" aria-label={`Quitar ${f.name}`} onClick={() => dropFile(f.id)}>✕</button>
              </span>
            ))}
          </div>
        ) : null}
        <div class="composer-row">
          <button type="button" class="attach-btn" onClick={() => picker.current?.click()} title="Adjuntar archivos o imágenes" aria-label="Adjuntar archivos o imágenes">📎</button>
          <input ref={picker} type="file" multiple hidden onChange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ''; }} />
          <textarea rows={2} value={draft} placeholder={drag ? 'Suelta aquí los archivos…' : prompt ? 'Tiene un pedido pendiente arriba; lo que escribas queda en cola hasta responderlo.' : `Escríbele a ${name}…  (📎 o arrastra un archivo · Enter envía)`}
                    onInput={(e) => { setDraft(e.currentTarget.value); typing.current = !!e.currentTarget.value; }}
                    onPaste={(e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendDraft(); } }} />
          <Btn kind="primary" type="submit" disabled={busy || uploading || (!draft.trim() && !ready.length)}>{uploading ? 'Subiendo…' : 'Enviar'}</Btn>
        </div>
      </form>

      {confirm ? <Confirm {...confirm} onClose={() => setConfirm(null)} /> : null}
      {schedOpen ? <ScheduleModal name={name} onClose={() => setSchedOpen(false)}
                                  onSave={async (at, msg) => { const r = await act('gfw_schedule', { at, msg }); if (r) toast(r.text, 'good'); }} /> : null}
      {labelEdit != null ? (
        <Modal title="Etiqueta de la sesión" onClose={() => setLabelEdit(null)}>
          <form class="stack modal-body" onSubmit={async (e) => { e.preventDefault(); const r = await act('gfw_label', { text: labelEdit }); if (r) setLabelEdit(null); }}>
            <p class="muted">Una nota corta para reconocerla de un vistazo, como “urgente cliente” o “esperando a Camilo”. Se ve en la tarjeta y en la terminal. Vacía la quita.</p>
            <label class="field"><span>Etiqueta (hasta 40 caracteres)</span><input maxLength={40} value={labelEdit} onInput={(e) => setLabelEdit(e.currentTarget.value)} autoFocus /></label>
            <footer><Btn onClick={() => setLabelEdit(null)}>Cancelar</Btn><Btn kind="primary" type="submit">Guardar</Btn></footer>
          </form>
        </Modal>
      ) : null}
      {rename != null ? (
        <Modal title="Renombrar sesión" onClose={() => setRename(null)}>
          <form class="stack modal-body" onSubmit={async (e) => {
            e.preventDefault();
            const r = await act('fleet_rename', { new_name: rename.trim() }, { confirm: true });
            if (r) { setRename(null); ctx.go(`/p/${encodeURIComponent(project)}/s/${encodeURIComponent(rename.trim())}`); }
          }}>
            <label class="field"><span>Nombre nuevo</span><input value={rename} onInput={(e) => setRename(e.currentTarget.value)} autoFocus /></label>
            <footer><Btn onClick={() => setRename(null)}>Cancelar</Btn><Btn kind="primary" type="submit" disabled={!rename.trim() || rename.trim() === name}>Renombrar</Btn></footer>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
