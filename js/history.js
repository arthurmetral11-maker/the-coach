// Historique personnel : résultats par séance + graphique d'évolution.
import { esc, fmtClock, fmtDateLong, parseYmd, MONTHS_SHORT } from './utils.js';
import * as S from './store.js';
import { I, $ } from './ui.js';
import { sessionSpec, diffSpecs, exerciseAverages, openResultScreen, RPE_LABELS } from './results.js';

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
    const done = list.filter((r) => r.complete);
    return {
      key, list, last,
      name: live?.name || last.sessionName,
      best: done.length ? Math.min(...done.map((r) => r.total)) : null,
    };
  }).sort((a, b) => (b.last.startedAt || 0) - (a.last.startedAt || 0));
}

const shortDate = (ymdStr) => {
  const d = parseYmd(ymdStr);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()].toLowerCase()}`;
};

// ================================================================= Liste
export function renderHistory(view, route) {
  if (route.arg) { renderSessionHistory(view, route); return; }
  const gs = groups();
  view.innerHTML = `<div id="hi">
    <div class="page-head">
      <div><div class="kicker">Mes résultats · visibles par moi seul</div><h1 class="display" style="font-size:clamp(48px,12vw,84px)">Historique</h1></div>
    </div>
    <div class="list" style="margin-top:12px">${gs.map((g) => `<a class="list-item" href="#/historique/${encodeURIComponent(g.key)}">
        <span class="idx">${String(g.list.length).padStart(2, '0')}</span>
        <div class="grow"><div class="li-title">${esc(g.name)}</div>
          <div class="li-sub">${g.list.length} passage${g.list.length > 1 ? 's' : ''} · dernier le ${esc(shortDate(g.last.date))} en ${fmtClock(g.last.total)}${g.best != null ? ` · meilleur ${fmtClock(g.best)}` : ''}</div></div>
        <span class="chev">${I.chevR}</span></a>`).join('')
      || '<div class="empty"><span class="outline">00</span>Aucun résultat pour l’instant.<br>Lance une séance et enregistre ton résultat à la fin.</div>'}</div>
  </div>`;
}

// ================================================================= Détail d'une séance
function metricsFor(list) {
  const out = [{ id: 'total', label: 'Temps total', kind: 'time' }];
  const seen = new Map();
  for (const r of list) {
    for (const g of exerciseAverages(r)) {
      if (g.mode === 'time' || seen.has(g.key)) continue;
      seen.set(g.key, g.name);
    }
  }
  for (const [k, name] of seen) out.push({ id: `ex:${k}`, label: `${name} (temps moyen)`, kind: 'time' });
  const amraps = new Set();
  list.forEach((r) => (r.entries || []).forEach((e) => { if (e.k === 'amrap') amraps.add(e.bi); }));
  [...amraps].forEach((bi) => out.push({ id: `amrap:${bi}`, label: `Tours AMRAP (bloc ${bi + 1})`, kind: 'count' }));
  return out;
}

function valueOf(r, metric) {
  if (metric === 'total') return r.complete ? r.total : null;
  if (metric.startsWith('ex:')) {
    const g = exerciseAverages(r).find((x) => x.key === metric.slice(3));
    return g ? g.avg : null;
  }
  if (metric.startsWith('amrap:')) {
    const e = (r.entries || []).find((x) => x.k === 'amrap' && x.bi === Number(metric.slice(6)));
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

function renderSessionHistory(view, route) {
  const key = route.arg;
  const g = groups().find((x) => x.key === key);
  if (!g) {
    view.innerHTML = `<div class="empty">Aucun résultat pour cette séance.<br><br><a class="btn" href="#/historique">Retour</a></div>`;
    return;
  }
  const list = g.list;
  const vers = versions(list);
  const metrics = metricsFor(list);
  const metric = metrics.find((m) => m.id === route.params.get('m')) || metrics[0];
  const changeLog = list.map((r, i) => ({ r, ...vers[i] })).filter((x) => x.changes.length);

  view.innerHTML = `<div id="hd">
    <div class="row between" style="margin-bottom:10px"><a class="btn btn-ghost btn-sm" href="#/historique">${I.chevL} Historique</a><span class="kicker">${list.length} passage${list.length > 1 ? 's' : ''}</span></div>
    <h1 class="title-caps" style="font-size:26px;letter-spacing:.08em">${esc(g.name)}</h1>
    <hr class="rule">
    <div class="row between">
      <select data-metric style="max-width:340px">${metrics.map((m) => `<option value="${esc(m.id)}" ${m.id === metric.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <span class="small muted">${metric.kind === 'time' ? 'Plus bas = plus rapide' : 'Plus haut = mieux'}</span>
    </div>
    <div class="chart" data-chart></div>
    ${changeLog.length ? `<div class="changes"><div class="kicker">Modifications de la séance</div>${changeLog.map((x) => `<div class="chg-row"><span class="pill">Δ${x.v}</span><span><b>${esc(shortDate(x.r.date))}</b> · ${esc(x.changes.join(' · '))}</span></div>`).join('')}</div>` : ''}
    <div class="kicker" style="margin:18px 0 6px">Tous les passages</div>
    <div class="list">${list.slice().reverse().map((r) => {
      const i = list.indexOf(r);
      return `<button class="list-item res-row" data-res="${r.id}">
        <div class="grow"><div class="li-title" style="font-size:15px">${esc(fmtDateLong(r.date))}</div>
          <div class="li-sub">Effort ${fmtClock(r.effort)}${r.rpe ? ` · RPE ${r.rpe} (${esc(RPE_LABELS[r.rpe])})` : ''}${r.note ? ` · « ${esc(r.note)} »` : ''}</div>
          <div class="row" style="gap:6px;margin-top:4px">${r.complete ? '' : '<span class="pill soft">Incomplète</span>'}${vers[i].changes.length ? `<span class="pill soft">Δ${vers[i].v} séance modifiée</span>` : ''}</div></div>
        <span class="res-total">${fmtClock(r.total)}</span><span class="chev">${I.chevR}</span></button>`;
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

  const points = list.map((r, i) => ({ r, i, v: valueOf(r, metric.id), ver: vers[i] })).filter((p) => p.v != null);
  const chartEl = $('[data-chart]', root);
  const drawChart = () => lineChart(chartEl, points, metric);
  drawChart();
  const onResize = () => {
    if (!document.body.contains(chartEl)) { window.removeEventListener('resize', onResize); return; }
    drawChart();
  };
  window.addEventListener('resize', onResize);
}

// ================================================================= Graphique (SVG, une seule série)
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

function lineChart(el, points, metric) {
  if (!points.length) {
    el.innerHTML = '<div class="empty small">Pas encore de valeur pour cette mesure (les séances incomplètes ne comptent pas dans le temps total).</div>';
    return;
  }
  const W = Math.max(300, el.clientWidth || 600);
  const H = 260;
  const P = { l: 58, r: 20, t: 30, b: 34 };
  const fmt = metric.kind === 'time' ? (v) => fmtClock(Math.round(v)) : (v) => String(Math.round(v));
  const vals = points.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) { lo -= metric.kind === 'time' ? 30 : 1; hi += metric.kind === 'time' ? 30 : 1; }
  const step = metric.kind === 'time' ? timeStep(hi - lo) : Math.max(1, niceStep(hi - lo));
  lo = Math.max(0, Math.floor(lo / step) * step);
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const n = points.length;
  const x = (i) => (n === 1 ? P.l + (W - P.l - P.r) / 2 : P.l + (i * (W - P.l - P.r)) / (n - 1));
  const y = (v) => P.t + ((hi - v) * (H - P.t - P.b)) / (hi - lo);

  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const grid = ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="c-grid"/><text x="${P.l - 8}" y="${y(v) + 4}" class="c-ylab" text-anchor="end">${fmt(v)}</text>`).join('');

  const labelEvery = Math.ceil(n / Math.max(1, Math.floor((W - P.l - P.r) / 64)));
  const xlabels = points.map((p, i) => (i % labelEvery === 0 || i === n - 1
    ? `<text x="${x(i)}" y="${H - 10}" class="c-xlab" text-anchor="middle">${esc(shortDate(p.r.date))}</text>` : '')).join('');

  // Repères de changement de version de la séance
  const marks = points.map((p, i) => {
    if (i === 0 || p.ver.v === points[i - 1].ver.v) return '';
    const mx = (x(i - 1) + x(i)) / 2;
    return `<line x1="${mx}" x2="${mx}" y1="${P.t - 8}" y2="${H - P.b}" class="c-ver"/><text x="${mx}" y="${P.t - 14}" class="c-verlab" text-anchor="middle">Δ${p.ver.v}</text>`;
  }).join('');

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const bestV = metric.kind === 'time' ? Math.min(...vals) : Math.max(...vals);
  const bestI = vals.lastIndexOf(bestV);
  const dots = points.map((p, i) => {
    const hollow = !p.r.complete;
    return `<circle cx="${x(i)}" cy="${y(p.v)}" r="5" class="${hollow ? 'c-dot hollow' : 'c-dot'}"/>`;
  }).join('');
  const label = (i, txt) => `<text x="${Math.min(W - P.r - 4, Math.max(P.l + 4, x(i)))}" y="${y(points[i].v) - 12}" class="c-lab" text-anchor="middle">${esc(txt)}</text>`;
  const labels = [label(n - 1, fmt(points[n - 1].v))];
  if (bestI !== n - 1) labels.push(label(bestI, `${fmt(bestV)} ★`));

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(metric.label)} au fil des passages">
      ${grid}
      <line x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}" class="c-axis"/>
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
    tip.innerHTML = `<b>${esc(fmtDateLong(p.r.date))}</b><span class="tv">${fmt(p.v)}</span>${p.r.rpe ? `<span>RPE ${p.r.rpe}</span>` : ''}${p.r.complete ? '' : '<span>Incomplète</span>'}${p.ver.changes.length ? `<span>Δ${p.ver.v} : ${esc(p.ver.changes.join(' · '))}</span>` : ''}`;
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
