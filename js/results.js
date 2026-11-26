// Écran de résumé de fin de séance (nouveau résultat ou résultat enregistré) + affiche PNG.
// Hyrox / Running : moyennes d'abord, puis temps regroupés par exercice (barres + écart à la moyenne).
// Musculation : pas de temps ; charges, répétitions et séries réellement faites (corrigeables ici).
import { esc, clone, fmtClock, fmtDateLong, parseClock, num } from './utils.js';
import { distText } from './format.js';
import * as S from './store.js';
import { I, toast, openModal, modalHead, shareOrDownload, download, visualSmall, $, $$ } from './ui.js';
import { renderResultPoster } from './poster.js';
import {
  RPE_LABELS, resultCat, timeGroups, runStats, muscuGroups, muscuTotals, rateText, fmtValue, deltaText, fmtKg, setText,
} from './analytics.js';

export { RPE_LABELS };

const gfmt = (g, v) => (g.metric === 'pace' ? fmtValue('pace', v) : fmtValue('time', v));

/**
 * Affiche le résumé d'un résultat en plein écran.
 * @param opts {isNew, onClose()}
 */
export function openResultScreen(result, { isNew = false, onClose } = {}) {
  const r = clone(result);
  const cat = resultCat(r);
  const root = $('#player-root');
  const el = document.createElement('div');
  el.className = `summary cat-${cat}`;
  root.innerHTML = '';
  root.appendChild(el);
  document.body.style.overflow = 'hidden';
  let dirty = isNew;

  const close = () => {
    el.remove();
    if (!$('#modal-root').children.length) document.body.style.overflow = '';
    onClose?.();
  };

  function recompute() {
    if (cat === 'running') r.effort = r.entries.filter((e) => e.k === 'run' && e.rk === 'run').reduce((a, e) => a + e.sec, 0);
    else if (cat === 'hyrox') r.effort = r.entries.reduce((a, e) => a + e.sec, 0);
    r.rest = Math.max(0, r.total - r.effort);
  }

  // ---------- Hyrox / Running
  function heroTime() {
    let side;
    if (cat === 'running') {
      const rs = runStats(r);
      side = `<b>Temps total</b><span>Distance ${esc(distText(rs.distance))}</span>${rs.pace ? `<span>Allure runs ${esc(fmtValue('pace', rs.pace))}</span>` : ''}<span>Sans récup ${fmtClock(r.effort)}</span>`;
    } else {
      side = `<b>Temps total</b><span>Sans repos ${fmtClock(r.effort)}</span><span>Repos ${fmtClock(r.rest)}</span>`;
    }
    return `<div class="sum-hero"><span class="outline">${fmtClock(r.total)}</span>
      <span class="sum-hero-side">${side}${r.complete ? '' : '<span class="pill">INCOMPLÈTE</span>'}</span></div>`;
  }

  /** Bouton d'édition d'une valeur (temps, ou distance pour une étape running au temps). */
  function editBtn(g, x, text) {
    const isDist = x.e.k === 'run' && x.e.by === 'time';
    return `<button class="t edit" data-edit="${x.i}" title="${isDist ? 'Corriger la distance faite' : 'Corriger le temps'}">${esc(text)}</button>`;
  }

  function timeSections() {
    const gs = timeGroups(r);
    const avgRows = gs.map((g) => {
      const one = g.n === 1 ? g.items[0] : null;
      const sub = g.n > 1
        ? `${g.n} fois · meilleur ${gfmt(g, g.best)} · moins bon ${gfmt(g, g.worst)}`
        : `${esc(one.e.label || '1 fois')}${Number(one.e.load) > 0 ? ` · ${one.e.load} kg` : ''}`;
      const value = one ? editBtn(g, one, gfmt(g, one.v)) : `<span class="t">${gfmt(g, g.avg)}</span>`;
      const rate = g.avgRate ? `<small class="rate">${esc(rateText(g.avgRate))}</small>` : '';
      return `<div class="sum-row"><span class="ic">${visualSmall(g)}</span><span class="what">${esc(g.title)}<small>${sub}</small></span><span class="val">${value}${rate}</span></div>`;
    }).join('');

    const multi = gs.filter((g) => g.n > 1 && !g.fixed);
    const detail = multi.map((g) => {
      const vals = g.items.map((x) => x.v).filter((v) => v != null);
      const max = vals.length ? Math.max(...vals) : 1;
      const rows = g.items.map((x, k) => {
        const frac = x.v != null && max > 0 ? Math.max(0.04, x.v / max) : 0;
        const delta = x.v != null && g.avg != null ? deltaText(x.v - g.avg) : '';
        const load = g.loads.length > 1 && Number(x.e.load) > 0 ? ` · ${x.e.load} kg` : '';
        return `<div class="gbar"><span class="gi">${k + 1}<small>${esc(x.e.label || '')}${esc(load)}</small></span>
          <span class="gtrack"><i style="width:${(frac * 100).toFixed(1)}%"></i></span>
          ${editBtn(g, x, x.v != null ? gfmt(g, x.v) : '—')}<span class="gd">${delta}</span></div>`;
      }).join('');
      return `<div class="sum-block"><div class="sum-bhead"><span>${esc(g.title)}</span><span class="t">moy. ${gfmt(g, g.avg)}</span></div>${rows}</div>`;
    }).join('');

    const wod = [];
    for (const b of r.blocks || []) {
      if (!b.header || cat === 'running') continue;
      const am = r.entries.map((e, i) => ({ e, i })).find((x) => x.e.k === 'amrap' && x.e.bi === b.bi);
      wod.push(`<div class="sum-row"><span class="ic"></span><span class="what">${esc(b.header)}<small>${am ? 'Tours réalisés' : 'Temps du bloc'}</small></span>
        ${am ? `<button class="t edit" data-rounds="${am.i}">${am.e.rounds} tour${am.e.rounds > 1 ? 's' : ''}</button>` : `<span class="t">${fmtClock(b.sec)}</span>`}</div>`);
    }

    return `${heroTime()}
      <hr class="rule">
      <div class="sum-h"><h3>Moyennes</h3><span class="small muted">${cat === 'running' ? 'Allure en petit' : 'Temps ramené à l’unité en petit'}</span></div>
      <div class="sum-block">${avgRows || '<p class="muted small">Aucun exercice.</p>'}</div>
      ${multi.length ? `<div class="sum-h"><h3>Détail par exercice</h3><span class="small muted">Touchez un temps pour le corriger</span></div>${detail}` : ''}
      ${wod.length ? `<div class="sum-h"><h3>Blocs</h3></div><div class="sum-block">${wod.join('')}</div>` : ''}`;
  }

  // ---------- Musculation
  function muscuStats() {
    const t = muscuTotals(r);
    const gs = muscuGroups(r);
    const rows = gs.map((g) => {
      const main = g.avgLoad != null ? fmtKg(g.avgLoad) : g.mode === 'reps' ? `${g.reps} reps` : g.mode === 'time' ? fmtClock(g.qty) : String(g.qty);
      const sub = `${g.n} série${g.n > 1 ? 's' : ''}${g.reps ? ` · ${g.reps} reps` : ''}${g.avgLoad != null ? ' · charge moyenne' : ''}`;
      return `<div class="sum-row"><span class="ic">${visualSmall(g)}</span><span class="what">${esc(g.name)}<small>${sub}</small></span><span class="t">${esc(main)}</span></div>`;
    }).join('');
    return `<div class="sum-hero"><span class="outline">${t.sets}</span>
        <span class="sum-hero-side"><b>Séries</b><span>${t.reps} reps</span><span>${t.exercises} exercice${t.exercises > 1 ? 's' : ''}</span>${r.complete ? '' : '<span class="pill">INCOMPLÈTE</span>'}</span></div>
      <hr class="rule">
      <div class="sum-h"><h3>Par exercice</h3></div>
      <div class="sum-block">${rows || '<p class="muted small">Aucune série.</p>'}</div>`;
  }
  function muscuSets() {
    const gs = muscuGroups(r);
    return gs.map((g) => `<div class="sum-block"><div class="sum-bhead"><span>${esc(g.name)}</span><span class="t small muted">${g.n} série${g.n > 1 ? 's' : ''}</span></div>
      ${g.items.map(({ e, i }, k) => {
        const unit = e.mode === 'reps' ? 'reps' : e.mode === 'time' ? 's' : e.mode === 'distance' ? 'm' : 'cal';
        const planned = (e.tv != null && (Number(e.tv) !== Number(e.value) || Number(e.tl) !== Number(e.load)))
          ? `<small>prévu ${esc(setText({ mode: e.mode, value: e.tv, load: e.tl }))}</small>` : `<small>${esc(e.label || '')}</small>`;
        return `<div class="set-row"><span class="gi">S${k + 1}${planned}</span>
          <label class="set-in"><input type="number" inputmode="decimal" min="0" step="any" data-mv="${i}" value="${e.value}"><span>${unit}</span></label>
          <span class="x">×</span>
          <label class="set-in"><input type="number" inputmode="decimal" min="0" step="any" data-ml="${i}" value="${e.load}"><span>kg</span></label></div>`;
      }).join('')}</div>`).join('');
  }

  function draw() {
    const top = `
      <div class="sum-top">
        <button class="btn btn-icon" data-a="close" aria-label="Fermer">${I.close}</button>
        <span class="kicker">${isNew ? (r.complete ? 'Séance terminée' : 'Séance incomplète') : 'Résultat'}</span>
        <span></span>
      </div>`;
    const head = `<div class="kicker">${esc(fmtDateLong(r.date))}${r.order ? ' · ordre perso' : ''}</div>
      <h1 class="title-caps sum-title">${esc(r.sessionName)}</h1>`;
    const main = cat === 'muscu'
      ? `<div data-stats>${muscuStats()}</div>
         <div class="sum-h"><h3>Séries réalisées</h3><span class="small muted">Corrige ce que tu as réellement fait</span></div>${muscuSets()}`
      : timeSections();
    el.innerHTML = `${top}
      <div class="sum-body">
        ${head}
        ${main}
        <div class="sum-h"><h3>Ressenti</h3><span class="small muted" data-rpel>${r.rpe ? `RPE ${r.rpe} · ${RPE_LABELS[r.rpe]}` : 'Effort perçu de 1 à 10'}</span></div>
        <div class="rpe">${Array.from({ length: 10 }, (_, i) => `<button data-rpe="${i + 1}" class="${r.rpe === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('')}</div>
        <label class="field" style="margin-top:10px">Commentaire<textarea data-note placeholder="Sensations, conditions, points à travailler…">${esc(r.note || '')}</textarea></label>
        <div class="stack sum-actions">
          <button class="btn btn-primary btn-block" data-a="save">${I.check} ${isNew ? 'Enregistrer le résultat' : 'Enregistrer les modifications'}</button>
          <button class="btn btn-block" data-a="poster">${I.share} Affiche du résultat</button>
          ${isNew ? '<button class="btn btn-ghost btn-block" data-a="discard">Ne pas enregistrer</button>' : `<button class="btn btn-sm btn-danger" data-a="delete">${I.trash} Supprimer ce résultat</button>`}
        </div>
      </div>`;
  }

  el.addEventListener('click', (ev) => {
    const t = ev.target;
    const rp = t.closest('[data-rpe]');
    if (rp) {
      r.rpe = Number(rp.dataset.rpe) === r.rpe ? null : Number(rp.dataset.rpe);
      dirty = true;
      $$('[data-rpe]', el).forEach((b) => b.classList.toggle('on', Number(b.dataset.rpe) === r.rpe));
      $('[data-rpel]', el).textContent = r.rpe ? `RPE ${r.rpe} · ${RPE_LABELS[r.rpe]}` : 'Effort perçu de 1 à 10';
      return;
    }
    const ed = t.closest('[data-edit]');
    if (ed) {
      const e = r.entries[+ed.dataset.edit];
      if (e.k === 'run' && e.by === 'time') {
        const v = prompt(`Distance réellement parcourue pendant « ${e.name} » (en mètres)`, String(Math.round(e.distance || 0)));
        if (v == null) return;
        const d = Math.round(num(v, -1));
        if (d < 0) { toast('Distance illisible (ex : 2700)'); return; }
        e.distance = d;
        e.measured = true;
      } else {
        const v = prompt(`Temps pour « ${e.name} »${e.label ? ` (${e.label})` : ''} — format min:sec`, fmtClock(e.sec));
        if (v == null) return;
        const sec = parseClock(v);
        if (sec == null) { toast('Temps illisible (ex : 1:25)'); return; }
        const delta = sec - e.sec;
        e.sec = sec;
        r.total = Math.max(0, r.total + delta);
        const blk = (r.blocks || []).find((x) => x.bi === e.bi);
        if (blk) blk.sec = Math.max(0, blk.sec + delta);
      }
      recompute();
      dirty = true;
      r.note = $('[data-note]', el).value.trim();
      const y = el.scrollTop;
      draw();
      el.scrollTop = y;
      return;
    }
    const ro = t.closest('[data-rounds]');
    if (ro) {
      const e = r.entries[+ro.dataset.rounds];
      const v = prompt('Nombre de tours réalisés', String(e.rounds));
      if (v == null) return;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0) return;
      e.rounds = n;
      dirty = true;
      r.note = $('[data-note]', el).value.trim();
      const y = el.scrollTop;
      draw();
      el.scrollTop = y;
      return;
    }
    const a = t.closest('[data-a]')?.dataset.a;
    if (a === 'close') {
      if (isNew) {
        if (!confirm('Fermer sans enregistrer le résultat ?')) return;
      } else if (dirty && !confirm('Fermer sans enregistrer les modifications ?')) return;
      close();
    }
    if (a === 'discard' && confirm('Ne pas enregistrer ce résultat ?')) close();
    if (a === 'save') {
      r.note = $('[data-note]', el).value.trim();
      S.saveResult(r);
      toast(isNew ? 'Résultat enregistré' : 'Modifications enregistrées');
      close();
    }
    if (a === 'delete' && confirm('Supprimer définitivement ce résultat de ton historique ?')) {
      S.deleteResult(r.id);
      toast('Résultat supprimé');
      close();
    }
    if (a === 'poster') {
      r.note = $('[data-note]', el).value.trim();
      openResultPoster(r);
    }
  });
  el.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.matches('[data-note]')) { dirty = true; return; }
    if (t.matches('[data-mv]') || t.matches('[data-ml]')) {
      const e = r.entries[+(t.dataset.mv ?? t.dataset.ml)];
      const v = Math.max(0, num(t.value, 0));
      if (t.dataset.mv != null) e.value = v;
      else e.load = v;
      dirty = true;
      const box = $('[data-stats]', el);
      if (box) box.innerHTML = muscuStats();
    }
  });

  recompute();
  draw();
}

function openResultPoster(r) {
  const base = `the-coach-resultat-${String(r.sessionName).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${r.date}`;
  openModal(`${modalHead('Affiche du résultat')}
    <div class="stack">
      <img class="poster-preview" data-img alt="Aperçu de l'affiche">
      <div class="row"><button class="btn btn-primary grow" data-a="share" disabled>${I.share} Partager l'image</button><button class="btn" data-a="dl" disabled>${I.download} PNG</button></div>
    </div>`, async (m) => {
    const canvas = await renderResultPoster(r, { name: S.db.settings.name, rpeLabel: r.rpe ? RPE_LABELS[r.rpe] : '', W: 1080, H: 1920 });
    const png = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    $('[data-img]', m).src = URL.createObjectURL(png);
    $$('[data-a]', m).forEach((b) => { b.disabled = false; });
    m.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'share') shareOrDownload(png, `${base}.png`, 'Mon résultat');
      if (a === 'dl') download(png, `${base}.png`);
    });
  });
}
