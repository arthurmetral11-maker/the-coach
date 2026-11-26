// Calculs sur les résultats (fonctions pures, sans accès au stockage) :
// regroupements par exercice, moyennes, allures, musculation, versions de séance,
// progression par exercice toutes séances confondues, bilan de la semaine.
import { fmtClock } from './utils.js';
import {
  catOf, rateUnit, qtyText, distText, paceText, itemParts, blockHeader, stepText, stepValues, isRunName, RUN_ICON,
} from './format.js';

export const RPE_LABELS = ['', 'Très facile', 'Facile', 'Facile', 'Modéré', 'Modéré', 'Soutenu', 'Difficile', 'Très difficile', 'Extrême', 'Maximal'];

/** Catégorie d'un résultat (les résultats d'avant la V3 n'ont pas de champ `cat`). */
export const resultCat = (r) => r?.cat || catOf(r?.snapshot);

const fmtNum = (v, d = 1) => String(+Number(v).toFixed(d)).replace('.', ',');
export const fmtKg = (v) => `${fmtNum(v, 1)} kg`;

/** Mise en forme d'une valeur selon son type : time, pace (s/km), rate (s par unité), kg, km (mètres), count. */
export function fmtValue(kind, v, unit = '') {
  if (v == null || !Number.isFinite(v)) return '—';
  switch (kind) {
    case 'time': return fmtClock(Math.round(v));
    case 'pace': return paceText(v);
    case 'rate': return `${fmtClock(Math.round(v))}${unit}`;
    case 'kg': return fmtKg(v);
    case 'km': return `${fmtNum(v / 1000, 2)} km`;
    default: return String(Math.round(v));
  }
}
/** true si une valeur plus basse est meilleure (temps, allures). */
export const lowerIsBetter = (kind) => kind === 'time' || kind === 'pace' || kind === 'rate';

/** Écart signé à la moyenne : "−0:16", "+0:27", "±0". */
export function deltaText(d) {
  const a = Math.round(Math.abs(d));
  if (!a) return '±0';
  return `${d < 0 ? '−' : '+'}${fmtClock(a)}`;
}

/** Durée lisible : 3725 -> "1 h 02", 900 -> "15 min" */
export function fmtDuration(sec) {
  sec = Math.round(Number(sec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

// ---------------------------------------------------------------- Temps ramenés à l'unité
/** Temps d'une entrée ramené à l'unité de l'exercice (s/km, s/500 m, s/10 reps…), ou null. */
export function rateOf(e) {
  if (e.k === 'run') {
    // Étape au temps : sans distance corrigée dans le résumé, l'allure est celle prévue.
    if (e.by === 'time' && !e.measured) return e.pace > 0 ? { v: e.pace, unit: '/km', per: 1000 } : null;
    return e.distance > 0 ? { v: (e.sec * 1000) / e.distance, unit: '/km', per: 1000 } : null;
  }
  if (e.k !== 'work') return null;
  const u = rateUnit(e.mode, e.name, e.exerciseId);
  const q = Number(e.value) || 0;
  if (!u || !q) return null;
  return { v: (e.sec * u.per) / q, unit: u.label, per: u.per };
}
export const rateText = (rt) => (rt ? `${fmtClock(Math.round(rt.v))}${rt.unit}` : '');

// ---------------------------------------------------------------- Hyrox et running : regroupement par exercice
/**
 * Regroupe les temps par exercice ET par quantité (Run 1 km et Run 600 m sont deux groupes),
 * dans l'ordre de première apparition. Pour une étape running au temps, on compare l'allure.
 * @returns [{key, title, icon, metric:'time'|'pace', items:[{e, i, v}], n, avg, best, worst, avgRate, loads}]
 */
export function timeGroups(r) {
  const map = new Map();
  (r.entries || []).forEach((e, i) => {
    let key;
    let title;
    let metric = 'time';
    if (e.k === 'work') {
      key = `w|${e.exerciseId || String(e.name).toLowerCase()}|${e.mode}|${Number(e.value) || 0}`;
      title = `${e.name} · ${qtyText(e.mode, e.value)}`;
    } else if (e.k === 'run') {
      const q = e.by === 'distance' ? distText(e.distance) : fmtClock(e.time);
      key = `r|${e.rk}|${String(e.name).toLowerCase()}|${e.by}|${e.by === 'distance' ? e.distance : e.time}`;
      title = `${e.name} · ${q}`;
      if (e.by === 'time') metric = 'pace';
    } else return;
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, title, icon: e.icon || (e.k === 'run' ? RUN_ICON : ''), exerciseId: e.exerciseId || '', metric, items: [] }));
    g.items.push({ e, i, v: metric === 'pace' ? (rateOf(e)?.v ?? null) : e.sec });
  });
  return [...map.values()].map((g) => {
    const vals = g.items.map((x) => x.v).filter((v) => v != null);
    const avg = vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
    const rates = g.metric === 'time' ? g.items.map((x) => rateOf(x.e)).filter(Boolean) : [];
    const avgRate = rates.length ? { v: rates.reduce((a, x) => a + x.v, 0) / rates.length, unit: rates[0].unit } : null;
    return {
      ...g,
      // fixed : rien de mesuré (exercice au temps imposé, étape running au temps sans distance corrigée)
      // -> pas de détail en barres.
      fixed: g.items.every(({ e }) => (e.k === 'work' && e.mode === 'time') || (e.k === 'run' && e.by === 'time' && !e.measured)),
      n: g.items.length,
      avg,
      best: vals.length ? Math.min(...vals) : null,
      worst: vals.length ? Math.max(...vals) : null,
      avgRate,
      loads: [...new Set(g.items.map((x) => Number(x.e.load) || 0))],
    };
  });
}

/** Running : distance totale (m), allure moyenne des runs (s/km), temps de course. */
export function runStats(r) {
  const runs = (r.entries || []).filter((e) => e.k === 'run');
  const distance = runs.reduce((a, e) => a + (Number(e.distance) || 0), 0);
  // Allure moyenne : runs réellement mesurés (à la distance, ou distance corrigée) ; sinon tous les runs.
  const all = runs.filter((e) => e.rk === 'run' && e.distance > 0);
  const measured = all.filter((e) => e.by === 'distance' || e.measured);
  const main = measured.length ? measured : all;
  const md = main.reduce((a, e) => a + e.distance, 0);
  const mt = main.reduce((a, e) => a + e.sec, 0);
  return { distance, pace: md ? (mt * 1000) / md : null };
}

// ---------------------------------------------------------------- Musculation
/**
 * Par exercice : séries, répétitions, charge moyenne (moyenne des charges des séries : 20 et 30 kg -> 25 kg).
 * @returns [{key, name, icon, mode, items:[{e, i}], n, reps, qty, avgLoad, maxLoad}]
 */
export function muscuGroups(r) {
  const map = new Map();
  (r.entries || []).forEach((e, i) => {
    if (e.k !== 'set') return;
    const key = e.exerciseId || String(e.name).toLowerCase();
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, name: e.name, icon: e.icon || '', exerciseId: e.exerciseId || '', mode: e.mode, items: [] }));
    g.items.push({ e, i });
  });
  return [...map.values()].map((g) => {
    const loads = g.items.map((x) => Number(x.e.load) || 0);
    const hasLoad = loads.some((l) => l > 0);
    return {
      ...g,
      n: g.items.length,
      reps: g.items.reduce((a, x) => a + (x.e.mode === 'reps' ? Number(x.e.value) || 0 : 0), 0),
      qty: g.items.reduce((a, x) => a + (Number(x.e.value) || 0), 0),
      avgLoad: hasLoad ? loads.reduce((a, l) => a + l, 0) / loads.length : null,
      maxLoad: hasLoad ? Math.max(...loads) : null,
    };
  });
}
export function muscuTotals(r) {
  const gs = muscuGroups(r);
  return { sets: gs.reduce((a, g) => a + g.n, 0), reps: gs.reduce((a, g) => a + g.reps, 0), exercises: gs.length };
}
/** Texte d'une série réalisée : "10 × 60 kg", "45 s", "12 reps" */
export function setText(e) {
  const v = Number(e.value) || 0;
  const q = e.mode === 'reps' ? String(v) : qtyText(e.mode, v);
  const l = Number(e.load) || 0;
  if (e.mode === 'reps') return l ? `${q} × ${fmtKg(l)}` : `${q} reps`;
  return l ? `${q} · ${fmtKg(l)}` : q;
}

// ---------------------------------------------------------------- Versions d'une séance
const numText = (p, mode) => (mode === 'reps' ? `${p.num} reps` : p.num);

/** Description comparable d'une séance : signature + valeurs / charges par exercice. */
export function sessionSpec(session) {
  const blocks = session?.blocks || [];
  const sig = JSON.stringify(blocks.map((b) => (b.type === 'run'
    ? { t: 'run', l: !!b.loop, r: b.loop ? b.rounds : 1, s: (b.steps || []).map((st) => ({ k: st.kind, n: st.label || '', ...stepValues(st) })) }
    : {
      t: b.type, f: b.format, r: b.rounds, s: b.sets, d: b.duration, i: b.interval, c: b.timeCap, v: b.variable,
      rb: b.restBetween, ra: b.restAfter,
      items: (b.items || []).map((it) => ({ e: it.exerciseId, m: it.mode, v: it.value, l: it.load, p: b.variable ? it.perSet : null, ra: it.restAfter })),
    })));
  const ex = new Map();
  const heads = [];
  for (const b of blocks) {
    heads.push(blockHeader(b) || '');
    if (b.type === 'run') {
      for (const st of b.steps || []) {
        const t = stepText(st);
        const key = `step:${st.id || t.name}`;
        let g = ex.get(key);
        if (!g) ex.set(key, (g = { name: t.name, nums: [], loads: [] }));
        g.nums.push(t.num);
        g.loads.push(t.pace || 'sans allure');
      }
      continue;
    }
    for (const it of b.items || []) {
      if (b.type === 'sets' && it !== b.items[0]) continue;
      const key = it.exerciseId || it.name;
      const p = itemParts(it, b);
      let g = ex.get(key);
      if (!g) ex.set(key, (g = { name: it.name, nums: [], loads: [] }));
      g.nums.push(numText(p, it.mode));
      g.loads.push(p.load || '0 kg');
    }
  }
  return { sig, ex, heads };
}

/** Liste lisible des changements entre deux versions d'une séance. */
export function diffSpecs(a, b) {
  const out = [];
  if (a.heads.length !== b.heads.length) out.push(`Blocs : ${a.heads.length} → ${b.heads.length}`);
  else a.heads.forEach((h, i) => { if (h && b.heads[i] && h !== b.heads[i]) out.push(`${h} → ${b.heads[i]}`); });
  for (const [k, gb] of b.ex) {
    const ga = a.ex.get(k);
    if (!ga) { out.push(`+ ${gb.name}`); continue; }
    const parts = [];
    const na = ga.nums.join(' + ');
    const nb = gb.nums.join(' + ');
    if (na !== nb) parts.push(`${na} → ${nb}`);
    const la = [...new Set(ga.loads)].join('/');
    const lb = [...new Set(gb.loads)].join('/');
    if (la !== lb) parts.push(`${la} → ${lb}`);
    if (parts.length) out.push(`${gb.name} : ${parts.join(' · ')}`);
  }
  for (const [k, ga] of a.ex) if (!b.ex.has(k)) out.push(`− ${ga.name}`);
  if (!out.length && a.sig !== b.sig) out.push('Repos ou ordre des exercices modifiés');
  return out;
}

// ---------------------------------------------------------------- Progression par exercice
/**
 * Une courbe par exercice, toutes séances confondues (un point par résultat).
 * - Hyrox : temps ramené à l'unité (min/km, /500 m, /100 m, /10 reps, /10 cal) ;
 * - Running : allure (min/km) des étapes mesurées ;
 * - Musculation : charge moyenne, répétitions, séries.
 * @returns [{key, type, name, icon, mode, unit, metrics:[{id, label, kind, unit}], points:[{r, vals, info}]}]
 */
export function exerciseSeries(results) {
  const series = new Map();
  for (const r of results) {
    const per = new Map();
    const add = (key, init, e) => {
      if (!series.has(key)) series.set(key, { key, ...init, points: [] });
      if (!per.has(key)) per.set(key, []);
      per.get(key).push(e);
    };
    for (const e of r.entries || []) {
      if (e.k === 'work') {
        const rt = rateOf(e);
        if (rt) add(`h|${e.exerciseId || String(e.name).toLowerCase()}|${e.mode}`, { type: 'hyrox', name: e.name, icon: e.icon || '', mode: e.mode, unit: rt.unit }, e);
      } else if (e.k === 'run') {
        if (e.rk !== 'rest' && e.distance > 0 && (e.by === 'distance' || e.measured)) add(`r|${String(e.name).toLowerCase()}`, { type: 'running', name: e.name, icon: RUN_ICON, unit: '/km' }, e);
      } else if (e.k === 'set') {
        add(`m|${e.exerciseId || String(e.name).toLowerCase()}`, { type: 'muscu', name: e.name, icon: e.icon || '' }, e);
      }
    }
    for (const [key, list] of per) {
      const s = series.get(key);
      if (s.type === 'hyrox') {
        const v = list.reduce((a, e) => a + rateOf(e).v, 0) / list.length;
        const loads = [...new Set(list.map((e) => Number(e.load) || 0).filter(Boolean))];
        const qtys = [...new Set(list.map((e) => qtyText(e.mode, e.value)))];
        s.points.push({ r, vals: { rate: v }, info: [`${list.length} × ${qtys.join(' / ')}`, ...(loads.length ? [loads.map((l) => `${l} kg`).join(' / ')] : [])] });
      } else if (s.type === 'running') {
        const d = list.reduce((a, e) => a + e.distance, 0);
        const t = list.reduce((a, e) => a + e.sec, 0);
        s.points.push({ r, vals: { pace: (t * 1000) / d }, info: [`${list.length} × · ${distText(d)} au total`] });
      } else {
        const loads = list.map((e) => Number(e.load) || 0);
        const hasLoad = loads.some((l) => l > 0);
        const reps = list.reduce((a, e) => a + (e.mode === 'reps' ? Number(e.value) || 0 : 0), 0);
        s.points.push({
          r,
          vals: { load: hasLoad ? loads.reduce((a, l) => a + l, 0) / loads.length : null, reps: reps || null, sets: list.length },
          info: [`${list.length} série${list.length > 1 ? 's' : ''}${reps ? ` · ${reps} reps` : ''}`],
        });
      }
    }
  }
  return [...series.values()].map((s) => {
    let metrics;
    if (s.type === 'hyrox') metrics = [{ id: 'rate', label: `Temps ${s.unit}`, kind: 'rate', unit: s.unit }];
    else if (s.type === 'running') metrics = [{ id: 'pace', label: 'Allure', kind: 'pace', unit: '/km' }];
    else {
      metrics = [];
      if (s.points.some((p) => p.vals.load != null)) metrics.push({ id: 'load', label: 'Charge moyenne', kind: 'kg' });
      if (s.points.some((p) => p.vals.reps != null)) metrics.push({ id: 'reps', label: 'Répétitions', kind: 'count' });
      metrics.push({ id: 'sets', label: 'Séries', kind: 'count' });
    }
    return { ...s, metrics };
  });
}

// ---------------------------------------------------------------- Bilan de la semaine
/** Durée totale, km courus (running + Runs des séances Hyrox), séries de musculation, RPE moyen. */
export function weekStats(results) {
  let duration = 0;
  let meters = 0;
  let sets = 0;
  let rpeSum = 0;
  let rpeN = 0;
  const byCat = { hyrox: 0, running: 0, muscu: 0 };
  for (const r of results) {
    const t = Number(r.total) || 0;
    duration += t;
    byCat[resultCat(r)] += t;
    if (r.rpe) { rpeSum += r.rpe; rpeN++; }
    for (const e of r.entries || []) {
      if (e.k === 'run' && e.rk !== 'rest') meters += Number(e.distance) || 0;
      else if (e.k === 'work' && e.mode === 'distance' && isRunName(e.name, e.exerciseId)) meters += Number(e.value) || 0;
      else if (e.k === 'set') sets++;
    }
  }
  return { duration, meters, sets, rpe: rpeN ? rpeSum / rpeN : null, byCat, count: results.length };
}
