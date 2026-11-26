// Historique personnel : par séance (évolution entre deux passages) et par exercice (toutes séances confondues).
import { esc, fmtClock, fmtDateLong, parseYmd, MONTHS_SHORT, MODES } from './utils.js';
import { CATS, distText } from './format.js';
import * as S from './store.js';
import { I, $, visualSmall } from './ui.js';
import { openResultScreen } from './results.js';
import {
  RPE_LABELS, resultCat, sessionSpec, diffSpecs, timeGroups, runStats, muscuGroups, muscuTotals, exerciseSeries,
  fmtValue, lowerIsBetter,
} from './analytics.js';

const groupKey = (r) => r.sessionId || `nom:${r.sessionName}`;

function groups() {
  const map = new Map();
  for (const r of S.listResults()) {
    const k = groupKey(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()].map(([key, list]) => {
    const last = list[list.length - 1];
    const live = last.sessionId ? S.getSession(last.sessionId) : null;
    return { key, list, last, cat: resultCat(last), name: live?.name || last.sessionName };
  }).sort((a, b) => (b.last.startedAt || 0) - (a.last.startedAt || 0));
}

const shortDate = (ymdStr) => {
  const d = parseYmd(ymdStr);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()].toLowerCase()}`;
};

function groupSub(g) {
  const n = g.list.length;
  const base = `${n} passage${n > 1 ? 's' : ''} · dernier le ${shortDate(g.last.date)}`;
  if (g.cat === 'muscu') {
    const t = muscuTotals(g.last);
    return `${base} · ${t.sets} séries · ${t.reps} reps`;
  }
  if (g.cat === 'running') {
    const rs = runStats(g.last);
    const paces = g.list.filter((r) => r.complete).map((r) => runStats(r).pace).filter(Boolean);
    return `${base} · ${distText(rs.distance)}${rs.pace ? ` · ${fmtValue('pace', rs.pace)}` : ''}${paces.length > 1 ? ` · meilleure allure ${fmtValue('pace', Math.min(...paces))}` : ''}`;
  }
  const done = g.list.filter((r) => r.complete);
  const best = done.length ? Math.min(...done.map((r) => r.total)) : null;
  return `${base} en ${fmtClock(g.last.total)}${best != null ? ` · meilleur ${fmtClock(best)}` : ''}`;
}

const viewSeg = (active) => `<div class="seg" style="margin:6px 0 4px">
  <a href="#/historique" class="seg-a ${active === 'sessions' ? 'on' : ''}">Par séance</a>
  <a href="#/progression" class="seg-a ${active === 'exercises' ? 'on' : ''}">Par exercice</a></div>`;

// ================================================================= Liste par séance
export function renderHistory(view, route) {
  if (route.arg) { renderSessionHistory(view, route); return; }
  const gs = groups();
  view.innerHTML = `<div id="hi">
    <div class="page-head">
      <div><div class="kicker">Mes résultats · visibles par moi seul</div><h1 class="display" style="font-size:clamp(48px,12vw,84px)">Historique</h1></div>
    </div>
    ${viewSeg('sessions')}
    <div class="list" style="margin-top:12px">${gs.map((g) => `<a class="list-item" href="#/historique/${encodeURIComponent(g.key)}">
        <span class="idx">${String(g.list.length).padStart(2, '0')}</span>
        <div class="grow"><div class="kicker" style="font-size:10px">${esc(CATS[g.cat].label)}</div><div class="li-title">${esc(g.name)}</div>
          <div class="li-sub">${esc(groupSub(g))}</div></div>
        <span class="chev">${I.chevR}</span></a>`).join('')
      || '<div class="empty"><span class="outline">00</span>Aucun résultat pour l’instant.<br>Lance une séance et enregistre ton résultat à la fin.</div>'}</div>
  </div>`;
}

// ================================================================= Détail d'une séance
function metricsFor(list, cat) {
  const out = [];
  if (cat === 'muscu') {
    const seen = new Map();
    list.forEach((r) => muscuGroups(r).forEach((g) => {
      const cur = seen.get(g.key) || { name: g.name, load: false, reps: false };
      cur.load = cur.load || g.avgLoad != null;
      cur.reps = cur.reps || g.reps > 0;
      seen.set(g.key, cur);
    }));
    for (const [k, g] of seen) if (g.load) out.push({ id: `ml:${k}`, label: `${g.name} · charge moyenne`, kind: 'kg' });
    out.push({ id: 'reps', label: 'Répétitions (séance)', kind: 'count' }, { id: 'sets', label: 'Séries (séance)', kind: 'count' });
    for (const [k, g] of seen) if (g.reps) out.push({ id: `mr:${k}`, label: `${g.name} · répétitions`, kind: 'count' });
    return out;
  }
  if (cat === 'running') out.push({ id: 'pace', label: 'Allure moyenne des runs', kind: 'pace' }, { id: 'total', label: 'Temps total', kind: 'time' }, { id: 'dist', label: 'Distance totale', kind: 'km' });
  else out.push({ id: 'total', label: 'Temps total', kind: 'time' });
  const seen = new Map();
  list.forEach((r) => timeGroups(r).forEach((g) => {
    if (g.items[0].e.k === 'work' && g.items[0].e.mode === 'time') return; // temps imposé : rien à comparer
    if (!seen.has(g.key)) seen.set(g.key, g);
  }));
  for (const [k, g] of seen) out.push({ id: `g:${k}`, label: `${g.title} (${g.metric === 'pace' ? 'allure' : 'temps'} moyen${g.metric === 'pace' ? 'ne' : ''})`, kind: g.metric === 'pace' ? 'pace' : 'time' });
  const amraps = new Map();
  list.forEach((r) => (r.blocks || []).forEach((b) => { if ((r.entries || []).some((e) => e.k === 'amrap' && e.bi === b.bi)) amraps.set(b.bi, b.header); }));
  for (const [bi, h] of amraps) out.push({ id: `amrap:${bi}`, label: `Tours ${h || 'AMRAP'}`, kind: 'count' });
  return out;
}

function valueOf(r, id) {
  if (id === 'total') return r.complete ? r.total : null;
  if (id === 'pace') return runStats(r).pace;
  if (id === 'dist') return runStats(r).distance || null;
  if (id === 'reps') return muscuTotals(r).reps || null;
  if (id === 'sets') return muscuTotals(r).sets || null;
  if (id.startsWith('ml:') || id.startsWith('mr:')) {
    const g = muscuGroups(r).find((x) => x.key === id.slice(3));
    if (!g) return null;
    return id.startsWith('ml:') ? g.avgLoad : g.reps || null;
  }
  if (id.startsWith('g:')) {
    const g = timeGroups(r).find((x) => x.key === id.slice(2));
    return g ? g.avg : null;
  }
  if (id.startsWith('amrap:')) {
    const e = (r.entries || []).find((x) => x.k === 'amrap' && x.bi === Number(id.slice(6)));
    return e ? e.rounds : null;
  }
  return null;
}

/** Versions successives de la séance : numéro de version + changements par résultat. */
function versions(list) {
  let prev = null;
  let v = 0;
  return list.map((r) => {
    const spec = sessionSpec(r.snapshot);
    let changes = [];
    if (prev && prev.sig !== spec.sig) {
      v++;
      changes = diffSpecs(prev, spec);
    }
    prev = spec;
    return { v, changes };
  });
}

function resultLine(r, cat) {
  if (cat === 'muscu') { const t = muscuTotals(r); return `${t.sets} séries · ${t.reps} reps`; }
  if (cat === 'running') { const rs = runStats(r); return `${distText(rs.distance)}${rs.pace ? ` · ${fmtValue('pace', rs.pace)}` : ''}`; }
  return `Sans repos ${fmtClock(r.effort)}`;
}

function renderSessionHistory(view, route) {
  const key = route.arg;
  const g = groups().find((x) => x.key === key);
  if (!g) {
    view.innerHTML = `<div class="empty">Aucun résultat pour cette séance.<br><br><a class="btn" href="#/historique">Retour</a></div>`;
    return;
  }
  const { list, cat } = g;
  const vers = versions(list);
  const metrics = metricsFor(list, cat);
  const metric = metrics.find((m) => m.id === route.params.get('m')) || metrics[0];
  const changeLog = list.map((r, i) => ({ r, ...vers[i] })).filter((x) => x.changes.length);

  view.innerHTML = `<div id="hd">
    <div class="row between" style="margin-bottom:10px"><a class="btn btn-ghost btn-sm" href="#/historique">${I.chevL} Historique</a><span class="kicker">${esc(CATS[cat].label)} · ${list.length} passage${list.length > 1 ? 's' : ''}</span></div>
    <h1 class="title-caps" style="font-size:26px;letter-spacing:.08em">${esc(g.name)}</h1>
    <hr class="rule">
    <div class="row between">
      <select data-metric style="max-width:360px">${metrics.map((m) => `<option value="${esc(m.id)}" ${m.id === metric.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <span class="small muted">${lowerIsBetter(metric.kind) ? 'Plus bas = plus rapide' : 'Plus haut = mieux'}</span>
    </div>
    <div class="chart" data-chart></div>
    ${changeLog.length ? `<div class="changes"><div class="kicker">Modifications de la séance</div>${changeLog.map((x) => `<div class="chg-row"><span class="pill">Δ${x.v}</span><span><b>${esc(shortDate(x.r.date))}</b> · ${esc(x.changes.join(' · '))}</span></div>`).join('')}</div>` : ''}
    <div class="kicker" style="margin:18px 0 6px">Tous les passages</div>
    <div class="list">${list.slice().reverse().map((r) => {
      const i = list.indexOf(r);
      const right = cat === 'muscu' ? `${muscuTotals(r).sets}<small> séries</small>` : fmtClock(r.total);
      return `<button class="list-item res-row" data-res="${r.id}">
        <div class="grow"><div class="li-title" style="font-size:15px">${esc(fmtDateLong(r.date))}</div>
          <div class="li-sub">${esc(resultLine(r, cat))}${r.rpe ? ` · RPE ${r.rpe} (${esc(RPE_LABELS[r.rpe])})` : ''}${r.note ? ` · « ${esc(r.note)} »` : ''}</div>
          <div class="row" style="gap:6px;margin-top:4px">${r.complete ? '' : '<span class="pill soft">Incomplète</span>'}${r.order ? '<span class="pill soft">Ordre perso</span>' : ''}${vers[i].changes.length ? `<span class="pill soft">Δ${vers[i].v} séance modifiée</span>` : ''}</div></div>
        <span class="res-total">${right}</span><span class="chev">${I.chevR}</span></button>`;
    }).join('')}</div>
  </div>`;

  const root = $('#hd');
  $('[data-metric]', root).addEventListener('change', (e) => {
    location.hash = `#/historique/${encodeURIComponent(key)}?m=${encodeURIComponent(e.target.value)}`;
  });
  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-res]');
    if (row) openResultScreen(S.getResult(row.dataset.res));
  });

  const points = list.map((r, i) => ({
    r, v: valueOf(r, metric.id), ver: vers[i], extra: r.order ? ['Ordre perso'] : [],
  })).filter((p) => p.v != null);
  mountChart($('[data-chart]', root), points, metric, { versions: true });
}

// ================================================================= Progression par exercice
function allSeries() {
  const ss = exerciseSeries(S.listResults());
  // Même exercice Hyrox fait dans deux types (ex. reps et distance) : on précise le type.
  const byEx = new Map();
  ss.filter((s) => s.type === 'hyrox').forEach((s) => {
    const k = s.key.split('|').slice(0, 2).join('|');
    byEx.set(k, (byEx.get(k) || 0) + 1);
  });
  ss.forEach((s) => {
    s.title = s.name;
    if (s.type === 'hyrox' && byEx.get(s.key.split('|').slice(0, 2).join('|')) > 1) s.title = `${s.name} (${MODES[s.mode]?.label || s.mode})`;
    s.last = s.points[s.points.length - 1];
  });
  return ss;
}

export function renderProgression(view, route) {
  if (route.arg) { renderSeries(view, route); return; }
  const ss = allSeries();
  const sections = [['hyrox', 'Hyrox'], ['running', 'Running'], ['muscu', 'Musculation']].map(([type, label]) => {
    const list = ss.filter((s) => s.type === type).sort((a, b) => (b.last?.r.startedAt || 0) - (a.last?.r.startedAt || 0));
    if (!list.length) return '';
    return `<div class="kicker" style="margin:18px 0 6px">${label}</div><div class="list">${list.map((s) => {
      const m = s.metrics[0];
      const vals = s.points.map((p) => p.vals[m.id]).filter((v) => v != null);
      const best = vals.length ? (lowerIsBetter(m.kind) ? Math.min(...vals) : Math.max(...vals)) : null;
      const lastV = s.last?.vals[m.id];
      return `<a class="list-item" href="#/progression/${encodeURIComponent(s.key)}">
        <span class="ex-visual" style="width:44px;height:44px;font-size:24px">${visualSmall({ exerciseId: s.key.split('|')[1], icon: s.icon })}</span>
        <div class="grow"><div class="li-title">${esc(s.title)}</div>
          <div class="li-sub">${s.points.length} séance${s.points.length > 1 ? 's' : ''} · ${esc(m.label.toLowerCase())} : dernière ${esc(fmtValue(m.kind, lastV, m.unit))}${best != null && s.points.length > 1 ? ` · meilleure ${esc(fmtValue(m.kind, best, m.unit))}` : ''}</div></div>
        <span class="chev">${I.chevR}</span></a>`;
    }).join('')}</div>`;
  }).join('');
  view.innerHTML = `<div id="pg">
    <div class="page-head">
      <div><div class="kicker">Toutes séances confondues · visible par moi seul</div><h1 class="display" style="font-size:clamp(48px,12vw,84px)">Historique</h1></div>
    </div>
    ${viewSeg('exercises')}
    <p class="small muted" style="margin:8px 0 0">Les temps sont ramenés à l’unité pour comparer des séances différentes : min/km pour le Run, /500 m pour SkiErg et Rameur, /100 m pour les autres distances, /10 reps ou /10 cal. En musculation : charge moyenne des séries.</p>
    ${sections || '<div class="empty"><span class="outline">00</span>Aucun exercice mesuré pour l’instant.</div>'}
  </div>`;
}

function renderSeries(view, route) {
  const s = allSeries().find((x) => x.key === route.arg);
  if (!s) {
    view.innerHTML = `<div class="empty">Aucune donnée pour cet exercice.<br><br><a class="btn" href="#/progression">Retour</a></div>`;
    return;
  }
  const metric = s.metrics.find((m) => m.id === route.params.get('m')) || s.metrics[0];
  view.innerHTML = `<div id="ps">
    <div class="row between" style="margin-bottom:10px"><a class="btn btn-ghost btn-sm" href="#/progression">${I.chevL} Par exercice</a><span class="kicker">${esc(CATS[s.type].label)} · ${s.points.length} séance${s.points.length > 1 ? 's' : ''}</span></div>
    <h1 class="title-caps" style="font-size:26px;letter-spacing:.08em">${esc(s.title)}</h1>
    <hr class="rule">
    <div class="row between">
      ${s.metrics.length > 1 ? `<select data-metric style="max-width:300px">${s.metrics.map((m) => `<option value="${m.id}" ${m.id === metric.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>` : `<span class="title-caps small">${esc(metric.label)}</span>`}
      <span class="small muted">${lowerIsBetter(metric.kind) ? 'Plus bas = plus rapide' : 'Plus haut = mieux'}</span>
    </div>
    <div class="chart" data-chart></div>
    <div class="kicker" style="margin:18px 0 6px">Détail</div>
    <div class="list">${s.points.slice().reverse().map((p) => `<button class="list-item res-row" data-res="${p.r.id}">
        <div class="grow"><div class="li-title" style="font-size:15px">${esc(fmtDateLong(p.r.date))}</div>
          <div class="li-sub">${esc(p.r.sessionName)} · ${esc(p.info.join(' · '))}</div></div>
        <span class="res-total">${esc(fmtValue(metric.kind, p.vals[metric.id], metric.unit))}</span><span class="chev">${I.chevR}</span></button>`).join('')}</div>
  </div>`;
  const root = $('#ps');
  $('[data-metric]', root)?.addEventListener('change', (e) => {
    location.hash = `#/progression/${encodeURIComponent(s.key)}?m=${encodeURIComponent(e.target.value)}`;
  });
  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-res]');
    if (row) openResultScreen(S.getResult(row.dataset.res));
  });
  const points = s.points.map((p) => ({ r: p.r, v: p.vals[metric.id], extra: [p.r.sessionName, ...p.info] })).filter((p) => p.v != null);
  mountChart($('[data-chart]', root), points, metric, { versions: false });
}

// ================================================================= Graphique (SVG, une seule série)
function mountChart(chartEl, points, metric, opts) {
  const drawChart = () => lineChart(chartEl, points, metric, opts);
  drawChart();
  const onResize = () => {
    if (!document.body.contains(chartEl)) { window.removeEventListener('resize', onResize); return; }
    drawChart();
  };
  window.addEventListener('resize', onResize);
}

function niceStep(range, target = 4) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
function timeStep(range) {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => range / s <= 5) || 3600;
}

function lineChart(el, points, metric, { versions: showVersions = true } = {}) {
  if (!points.length) {
    el.innerHTML = '<div class="empty small">Pas encore de valeur pour cette mesure (les séances incomplètes ne comptent pas dans le temps total).</div>';
    return;
  }
  const W = Math.max(300, el.clientWidth || 600);
  const H = 260;
  const P = { l: 66, r: 20, t: 30, b: 34 };
  const isTime = metric.kind === 'time' || metric.kind === 'pace' || metric.kind === 'rate';
  const fmt = (v) => fmtValue(metric.kind, v, metric.unit);
  const fmtAxis = (v) => (isTime ? fmtClock(Math.round(v)) : metric.kind === 'km' ? fmtValue('km', v).replace(' km', '') : metric.kind === 'kg' ? String(+v.toFixed(1)).replace('.', ',') : String(Math.round(v)));
  const vals = points.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = isTime ? 30 : metric.kind === 'km' ? 500 : 1;
  if (hi === lo) { lo -= pad; hi += pad; }
  let step;
  if (isTime) step = timeStep(hi - lo);
  else if (metric.kind === 'count') step = Math.max(1, niceStep(hi - lo));
  else step = niceStep(hi - lo);
  lo = Math.max(0, Math.floor(lo / step) * step);
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const n = points.length;
  const x = (i) => (n === 1 ? P.l + (W - P.l - P.r) / 2 : P.l + (i * (W - P.l - P.r)) / (n - 1));
  const y = (v) => P.t + ((hi - v) * (H - P.t - P.b)) / (hi - lo);

  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const grid = ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="c-grid"/><text x="${P.l - 8}" y="${y(v) + 4}" class="c-ylab" text-anchor="end">${fmtAxis(v)}</text>`).join('');

  const labelEvery = Math.ceil(n / Math.max(1, Math.floor((W - P.l - P.r) / 64)));
  const xlabels = points.map((p, i) => (i % labelEvery === 0 || i === n - 1
    ? `<text x="${x(i)}" y="${H - 10}" class="c-xlab" text-anchor="middle">${esc(shortDate(p.r.date))}</text>` : '')).join('');

  // Repères de changement de version de la séance
  const marks = !showVersions ? '' : points.map((p, i) => {
    if (i === 0 || !p.ver || p.ver.v === points[i - 1].ver.v) return '';
    const mx = (x(i - 1) + x(i)) / 2;
    return `<line x1="${mx}" x2="${mx}" y1="${P.t - 8}" y2="${H - P.b}" class="c-ver"/><text x="${mx}" y="${P.t - 14}" class="c-verlab" text-anchor="middle">Δ${p.ver.v}</text>`;
  }).join('');

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const bestV = lowerIsBetter(metric.kind) ? Math.min(...vals) : Math.max(...vals);
  const bestI = vals.lastIndexOf(bestV);
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="5" class="${p.r.complete ? 'c-dot' : 'c-dot hollow'}"/>`).join('');
  const label = (i, txt) => `<text x="${Math.min(W - P.r - 4, Math.max(P.l + 4, x(i)))}" y="${y(points[i].v) - 12}" class="c-lab" text-anchor="middle">${esc(txt)}</text>`;
  const labels = [label(n - 1, fmt(points[n - 1].v))];
  if (bestI !== n - 1) labels.push(label(bestI, `${fmt(bestV)} ★`));

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(metric.label)} au fil des séances">
      ${grid}
      <line x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}" class="c-axis"/>
      ${xlabels}
      ${marks}
      <path d="${path}" class="c-line"/>
      ${dots}
      ${labels.join('')}
      <line class="c-cross" y1="${P.t}" y2="${H - P.b}" x1="0" x2="0" visibility="hidden"/>
      <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" class="c-hit"/>
    </svg><div class="c-tip" hidden></div>`;

  const svgEl = el.querySelector('svg');
  const tip = el.querySelector('.c-tip');
  const cross = el.querySelector('.c-cross');
  const show = (ev) => {
    const rect = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    const p = points[best];
    cross.setAttribute('x1', x(best));
    cross.setAttribute('x2', x(best));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(fmtDateLong(p.r.date))}</b><span class="tv">${esc(fmt(p.v))}</span>${(p.extra || []).filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('')}${p.r.rpe ? `<span>RPE ${p.r.rpe}</span>` : ''}${p.r.complete ? '' : '<span>Incomplète</span>'}${p.ver?.changes.length ? `<span>Δ${p.ver.v} : ${esc(p.ver.changes.join(' · '))}</span>` : ''}`;
    const tx = (x(best) / W) * rect.width;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(rect.width - tw, Math.max(0, tx - tw / 2))}px`;
    tip.style.top = `${(y(p.v) / H) * rect.height + 14}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  svgEl.addEventListener('pointermove', show);
  svgEl.addEventListener('pointerdown', show);
  svgEl.addEventListener('pointerleave', hide);
}
