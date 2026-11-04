// The only file that talks to the network.
async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'X-GFW': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let j = null;
  try { j = await res.json(); } catch {}
  if (!res.ok || (j && j.ok === false)) {
    const e = new Error((j && j.text) || `error ${res.status}`);
    e.status = res.status; e.body = j;
    throw e;
  }
  return j;
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

export const api = {
  health: () => call('GET', '/api/health'),
  setup: (users, code) => call('POST', '/api/setup', { users, code }),
  login: (name, password) => call('POST', '/api/login', { name, password }),
  logout: () => call('POST', '/api/logout'),
  users: () => call('GET', '/api/users'),
  addUser: (name, password) => call('POST', '/api/users', { name, password }),
  password: (old, nw) => call('POST', '/api/password', { old, new: nw }),
  projects: () => call('GET', '/api/projects'),
  grid: (project) => call('GET', `/api/grid?${qs({ project })}`),
  session: (project, session, before) => call('GET', `/api/session?${qs({ project, session, before })}`),
  pane: (project, session) => call('GET', `/api/pane?${qs({ project, session })}`),
  presence: (project, session, typing) => call('POST', '/api/presence', { project, session, typing }),
  assign: (project, session, owner) => call('POST', '/api/assign', { project, session, owner }),
  activity: () => call('GET', '/api/activity'),
  act: (tool, args, { confirm = false, owner } = {}) => call('POST', '/api/act', { tool, args, confirm, owner }),
  resetDemo: () => call('POST', '/api/demo/reset'),
  voice: () => call('GET', '/api/voice'),
  usage: () => call('GET', '/api/usage'),
  lead: (project) => call('POST', '/api/lead', { project }),
  speak: (text, voice) => call('POST', '/api/speak', { text, voice }),
  route: (b) => call('POST', '/api/route', b),
  tasks: () => call('GET', '/api/tasks'),
  taskSent: (b) => call('POST', '/api/tasks/sent', b),
  taskPlace: (id, project) => call('POST', '/api/tasks/place', { id, project }),
  taskDone: (id) => call('POST', '/api/tasks/done', { id }),
  voices: () => call('GET', '/api/voices'),
  installVoice: (key) => call('POST', '/api/voices/install', { key }),
  deleteVoice: (key) => call('POST', '/api/voices/delete', { key }),
  automations: () => call('GET', '/api/automations'),
  saveAutomation: (automation) => call('POST', '/api/automations', { automation }),
  deleteAutomation: (id) => call('POST', '/api/automations/delete', { id }),
  runAutomation: (id) => call('POST', '/api/automations/run', { id }),
  automationAI: (messages, draft) => call('POST', '/api/automations/ai', { messages, draft }),
  // The file's own bytes as the body (no base64), where it goes in the query.
  attach: async (project, session, file) => {
    if (file.size > ATTACH_MAX_BYTES) throw new Error(`${file.name} pesa más de ${ATTACH_MAX_BYTES / 1048576} MB`);
    const res = await fetch(`/api/attach?${qs({ project, session, name: file.name })}`, {
      method: 'POST', headers: { 'X-GFW': '1', 'Content-Type': file.type || 'application/octet-stream' },
      body: file, credentials: 'same-origin',
    });
    let j = null; try { j = await res.json(); } catch {}
    if (!res.ok || !j?.ok) throw new Error(j?.text || `error ${res.status}`);
    return j;
  },
};
export const ATTACH_MAX_BYTES = 25 * 1024 * 1024;     // server/attach.mjs holds the same
export const ATTACH_PER_MESSAGE = 10;
