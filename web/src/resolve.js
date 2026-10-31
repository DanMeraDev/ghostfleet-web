// What did the person mean? Pure, so it is tested in node (scripts/test-resolve.mjs).
//
// Order matters: first WHERE (which project, which session), then WHAT. A sentence like
// "vámonos a vault invers, me pidieron revisar el KPI de Belgrano" is a place and a job, and
// the job has to reach that place's lead — not whichever lead was selected before.

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Spanish speech, written down by a recogniser that does not know these names: "practiq"
// arrives as "practicu", "práctico", "practic"; "vault" as "bolt" or "volt". Compare sounds.
export const phon = (s) => norm(s)
  .replace(/qu/g, 'k').replace(/q/g, 'k').replace(/c([aou])/g, 'k$1').replace(/c([ei])/g, 's$1').replace(/c\b/g, 'k').replace(/ck/g, 'k')
  .replace(/z/g, 's').replace(/v/g, 'b').replace(/w/g, 'u').replace(/ll/g, 'y').replace(/ph/g, 'f').replace(/x/g, 'ks')
  .replace(/h/g, '').replace(/([a-z])\1+/g, '$1').replace(/\s+/g, ' ').trim();

const grams = (s) => { const t = ` ${s} `; const g = new Map(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
export function dice(a, b) {
  const A = grams(a), B = grams(b); let both = 0, n = 0;
  for (const [k, v] of A) { n += v; both += Math.min(v, B.get(k) || 0); }
  for (const v of B.values()) n += v;
  return n ? (2 * both) / n : 0;
}
const sim = (a, b) => (phon(a) === phon(b) ? 1 : dice(phon(a), phon(b)));

const GENERIC = new Set(['saas', 'web', 'api', 'app', 'dv', 'os', 'repo', 'cli', 'mvp', 'v2', 'demo', 'the', 'de', 'la', 'el']);
const CUES = new Set(['a', 'al', 'en', 'de', 'del', 'proyecto', 'con', 'para', 'sobre', 'hacia']);
// Words that say "go somewhere": the only ones (with CUES) that make the next word a place.
const VERBS = new Set(['ve', 'vamos', 'vamonos', 'ir', 'anda', 'andate', 'llevame', 'lleva', 'cambia', 'cambiate', 'pasa', 'pasate', 'abre', 'abreme',
  'entra', 'entremos', 'muestrame', 'ensename', 'trabajemos', 'hablemos', 'sigamos', 'pon', 'ponme', 'trabajar', 'volvamos', 'regresa', 'regresemos']);
// Words that carry no request of their own, for telling "take me there" from "do this there".
const FILLER = new Set(['quiero', 'ahora', 'ya', 'bueno', 'ok', 'okay', 'listo', 'dale', 'oye', 'hola', 'porfa', 'por', 'favor', 'gracias',
  'el', 'la', 'los', 'las', 'un', 'una', 'que', 'y', 'e', 'pues', 'entonces', 'mismo', 'este', 'ese', 'eso', 'esto', 'nos', 'me']);
const NAV = new Set([...VERBS, ...FILLER]);

// Every name a project can be called by: the whole thing, and its distinctive first word when
// no other project shares it ("practiq" for practiq-saas, "glassy" for glassy-dashboard).
export function aliases(projects) {
  const names = projects.map(p => p.name);
  const first = (n) => norm(n).split(' ')[0];
  const count = new Map(); for (const n of names) { const f = first(n); count.set(f, (count.get(f) || 0) + 1); }
  const out = [];
  for (const n of names) {
    const words = norm(n).split(' ').filter(Boolean);
    out.push({ project: n, alias: words.join(' '), multi: words.length > 1 });
    const meaningful = words.filter(w => !GENERIC.has(w));
    if (meaningful.length && meaningful.join(' ') !== words.join(' ')) out.push({ project: n, alias: meaningful.join(' '), multi: meaningful.length > 1 });
    const f = words[0];
    if (words.length > 1 && f.length >= 4 && !GENERIC.has(f) && count.get(f) === 1) out.push({ project: n, alias: f, multi: false });
  }
  return out;
}

// Where in the sentence a project is named, if anywhere. Returns {project, start, end, score}.
export function findProject(text, projects) {
  const words = norm(text).split(' ').filter(Boolean);
  if (!words.length || !projects?.length) return null;
  let best = null;
  for (const a of aliases(projects)) {
    const n = a.alias.split(' ').length;
    for (let size = Math.max(1, n - 1); size <= n + 1; size++) {
      for (let i = 0; i + size <= words.length; i++) {
        const win = words.slice(i, i + size).join(' ');
        if (phon(win).replace(/ /g, '').length < 4) continue;
        const score = Math.max(sim(win, a.alias), sim(win.replace(/ /g, ''), a.alias.replace(/ /g, '')));
        const need = a.multi ? 0.68 : 0.74;
        if (score < need) continue;
        // A single ordinary word ("calidad", "jade", "daniel") only counts as a project when
        // something says it is a place: "vamos a calidad", "en calidad", "el proyecto calidad",
        // or when it is all that was said.
        const cued = words.length === size || CUES.has(words[i - 1]) || VERBS.has(words[i - 1]);
        // ...and so does a PART of a longer name ("facturas" of agente_facturas): enough to
        // find it when pointed at, not enough to send work there on its own.
        if ((!a.multi || size < n) && !cued) continue;
        const rank = score + (a.multi ? 0.05 : 0) + size * 0.01;
        if (!best || rank > best.rank) best = { project: a.project, start: i, end: i + size, score, rank };
      }
    }
  }
  return best;
}

function bestName(name, options) {
  const n = norm(name);
  if (!n) return null;
  let hit = null, score = 0;
  for (const o of options) {
    const k = norm(o);
    const s = k === n ? 2 : (k.startsWith(n) || n.startsWith(k)) && Math.min(k.length, n.length) >= 3 ? 1.5 : sim(k, n);
    if (s > score) { hit = o; score = s; }
  }
  return score >= 0.6 ? hit : null;
}

// → one of:
//   {kind:'go', go, say}                     somewhere in the app (map, home, a session)
//   {kind:'place', project, say}             a project, and nothing to do there yet
//   {kind:'task', project, text, said}       work for that project's lead
//   {kind:'ask', text}                       work, but for which project?
export function resolve(text, projects, context) {
  const t = norm(text);
  if (!t) return null;
  const short = t.split(' ').length <= 9;
  if (short && /^(muestrame |abre |ve a |ir a |vamos a |llevame a )?(el )?mapa( en vivo)?$/.test(t)) return { kind: 'go', go: '/mapa', say: 'Abro el mapa en vivo.' };
  if (short && /^(ve |vamos |llevame |volver |vuelve )?(al )?inicio$/.test(t)) return { kind: 'go', go: '/', say: 'Vamos al inicio.' };
  if (short && /^(muestrame |abre |ve a )?(la )?actividad$/.test(t)) return { kind: 'go', go: '/actividad', say: 'Abro la actividad.' };

  const m = /^(?:abre|ve a|vamos a|llevame a|muestrame|ensename|cambia a|pasa a|anda a) (?:la )?sesion (.+)$/.exec(t);
  if (m && short) {
    const all = (projects || []).flatMap(p => p.sessions.map(x => ({ p: p.name, s: x.name })));
    const inCtx = all.filter(x => x.p === context);
    const pick = (list) => { const k = bestName(m[1], list.map(x => x.s)); return k && list.find(x => x.s === k); };
    const hit = pick(inCtx) || pick(all);
    if (hit) return { kind: 'go', go: `/p/${encodeURIComponent(hit.p)}/s/${encodeURIComponent(hit.s)}`, project: hit.p, session: hit.s,
                      say: `Abro ${hit.s}${hit.p !== context ? ` en ${hit.p}` : ''}.` };
    return { kind: 'go', go: null, say: `No encontré una sesión parecida a “${m[1]}”.` };
  }

  const where = findProject(text, projects);
  if (where) {
    const words = norm(text).split(' ').filter(Boolean);
    const rest = [...words.slice(0, where.start), ...words.slice(where.end)].filter(w => !NAV.has(w) && !CUES.has(w) && w.length > 2);
    if (rest.length < 2) return { kind: 'place', project: where.project, say: `Listo, estamos en ${where.project}. ¿Qué hacemos?` };
    return { kind: 'task', project: where.project, text, say: `Se lo paso al líder de ${where.project}.` };
  }
  const leftover = t.split(' ').filter(w => !NAV.has(w) && w.length > 2);
  if (leftover.length < 2) return { kind: 'go', go: null, say: 'No te entendí. Dime a qué proyecto vamos o qué necesitas.' };
  if (context) return { kind: 'task', project: context, text, say: `Se lo paso al líder de ${context}.` };
  return { kind: 'ask', text, say: '¿Para qué proyecto es? Dímelo o tócalo en la lista.' };
}
