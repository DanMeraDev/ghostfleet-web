// node scripts/test-resolve.mjs — what the assistant understands, against real project names.
import assert from 'node:assert/strict';
import { resolve, findProject } from '../web/src/resolve.js';

// The real list on the machine this was written on (fleet_projects).
const NAMES = ['ghostfleet', 'vault-invers', 'diezvisuales', 'agente_facturas', 'jade', 'invers-landing', 'prueba-tecnica-invers',
  'vikunja-migracion', 'practiq-saas', 'aws-sbg-epn', 'inversTask', 'Dashboard-Revenue-Intelligence-GHL', 'glassy-dashboard',
  'phone-game', 'phone-game-tiktok', 'gestor-financiero', 'sobrina', 'GPC', 'daniel', 'huertos-medicinales', 'BDD', 'Metodologias',
  'calidad', 'cvs-externos'];
const projects = NAMES.map(name => ({ name, sessions: name === 'vault-invers' ? [{ name: 'master', lead: true }, { name: 'kpi-otras-sedes' }]
  : name === 'practiq-saas' ? [{ name: 'master', lead: true }, { name: 'stripe-billing' }] : [] }));

const cases = [
  // [said, context, expected kind, expected project]
  ['practicu', null, 'place', 'practiq-saas'],
  ['vamos a practicu', null, 'place', 'practiq-saas'],
  ['vámonos a práctico', null, 'place', 'practiq-saas'],
  ['Vámonos a vault invers.', null, 'place', 'vault-invers'],
  ['vamos a bolt invers', null, 'place', 'vault-invers'],
  ['Vámonos a vault invers, comencemos con esto: me pidieron revisar el KPI de Belgrano', null, 'task', 'vault-invers'],
  ['en practicu arregla los tests de pagos que fallan', null, 'task', 'practiq-saas'],
  ['revisa el login de practicu y que funcione con Google', null, 'task', 'practiq-saas'],
  ['abre glassy', null, 'place', 'glassy-dashboard'],
  ['quiero trabajar en diez visuales', null, 'place', 'diezvisuales'],
  ['vamos a agente facturas y revisa por qué no lee los PDF', null, 'task', 'agente_facturas'],
  ['abre el dashboard de revenue', null, 'place', 'Dashboard-Revenue-Intelligence-GHL'],
  ['vamos a jade', null, 'place', 'jade'],
  ['revisa por qué no se leen los PDF de las facturas', null, 'ask', undefined],
  ['vamos a facturas', null, 'place', 'agente_facturas'],
  ['me gusta el color jade para el botón', 'practiq-saas', 'task', 'practiq-saas'],
  ['vamos a metodologías', null, 'place', 'Metodologias'],
  ['revisa la calidad del código del login', 'practiq-saas', 'task', 'practiq-saas'],
  ['revisa la calidad del código del login', null, 'ask', undefined],
  ['vamos al proyecto calidad', null, 'place', 'calidad'],
  ['Daniel quiere que arregles el formulario', 'vault-invers', 'task', 'vault-invers'],
  ['arregla los tests que fallan', null, 'ask', undefined],
  ['arregla los tests que fallan', 'practiq-saas', 'task', 'practiq-saas'],
  ['muéstrame el mapa', null, 'go', undefined],
  ['abre la sesión stripe bilging', null, 'go', 'practiq-saas'],
  ['vamos a invers task', null, 'place', 'inversTask'],
  ['vamos a phone game tiktok', null, 'place', 'phone-game-tiktok'],
  ['hablemos de gestor financiero', null, 'place', 'gestor-financiero'],
];
let fail = 0;
for (const [said, ctx, kind, project] of cases) {
  const r = resolve(said, projects, ctx);
  const ok = r && r.kind === kind && (project === undefined || r.project === project);
  if (!ok) fail++;
  console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(said).padEnd(70), ctx ? `[${ctx}]` : '', '→', r ? `${r.kind} ${r.project || ''}` : 'null');
}
console.log(fail ? `\n${fail} fallos` : '\ntodo bien');
process.exit(fail ? 1 : 0);
