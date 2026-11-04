// node scripts/test-resolve.mjs — what the assistant understands on its own, and what the
// dispatcher's answer is held to. The names are the real list on the machine this was written on.
import assert from 'node:assert/strict';
import { command } from '../web/src/resolve.js';
import { check } from '../server/router.mjs';

const projects = [
  { name: 'vault-invers', sessions: [{ name: 'master', lead: true }, { name: 'kpi-otras-sedes' }] },
  { name: 'practiq-saas', sessions: [{ name: 'master', lead: true }, { name: 'stripe-billing' }] },
  { name: 'jade', sessions: [] },
];

// Only what moves the page is decided here; anything else is the dispatcher's.
const go = (said, ctx) => command(said, projects, ctx)?.go;
assert.equal(go('muéstrame el mapa'), '/mapa');
assert.equal(go('vamos al inicio'), '/');
assert.equal(go('abre la actividad'), '/actividad');
assert.equal(go('abre la sesión stripe bilging'), '/p/practiq-saas/s/stripe-billing');
for (const said of ['vamos a jade', 'en practiq arregla los tests', 'me gusta el color jade', 'arregla los tests que fallan'])
  assert.equal(command(said, projects, null), null, said);

const T = { pending_id: '', project: '', session: '', title: 'x', text: 'x', listed: true, context: '', confidence: 0.95, question: '', options: [], why: 'x' };
const one = (t) => check({ action: 'tasks', tasks: [{ ...T, ...t }] }, projects).tasks[0];
assert.equal(one({ project: 'practiq-saas' }).project, 'practiq-saas');
assert.equal(one({ project: 'practiq-saas', session: 'stripe-billing' }).session, 'stripe-billing');
assert.equal(one({ project: 'practiq-saas', session: 'master' }).session, '');           // the lead
// Everything that cannot be confirmed stays as a task with no place, so it is asked and not sent.
for (const t of [{ project: 'no-existe' }, { project: 'practiq-saas', session: 'no-existe' }, { project: 'practiq-saas', confidence: 0.79 }, { project: '' }]) {
  const r = one(t);
  assert.equal(r.project, '', JSON.stringify(t));
  assert.ok(r.question);
  assert.equal(r.listed, true);
}
assert.deepEqual(one({ options: ['jade', 'inventado'] }).options, ['jade']);
assert.equal(one({ project: 'jade', listed: false }).listed, false);
// Several things said at once are several tasks, each with its own place.
const two = check({ action: 'tasks', tasks: [{ ...T, project: 'jade' }, { ...T, project: 'practiq-saas', confidence: 0.2 }] }, projects).tasks;
assert.deepEqual(two.map(t => t.project), ['jade', '']);
assert.equal(one({ project: 'jade', pending_id: 'abc' }).pending, '');                     // not an id it was given
assert.equal(check({ action: 'tasks', tasks: [{ ...T, project: 'jade', pending_id: 'abc' }] }, projects, '', [{ id: 'abc' }]).tasks[0].pending, 'abc');
assert.equal(check({ action: 'go', project: 'no-existe' }, projects).action, 'ask');
console.log('todo bien');
