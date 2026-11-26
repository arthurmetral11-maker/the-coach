// Résultats de séance : calculs (moyennes, versions), écran de résumé, affiche.
import { esc, clone, fmtClock, fmtDateLong, parseClock } from './utils.js';
import { itemParts, blockHeader, valueShort, loadText } from './format.js';
import * as S from './store.js';
import { I, toast, openModal, modalHead, shareOrDownload, download, visualSmall, $, $$ } from './ui.js';
import { renderResultPoster } from './poster.js';

export const RPE_LABELS = ['', 'Très facile', 'Facile', 'Facile', 'Modéré', 'Modéré', 'Soutenu', 'Difficile', 'Très difficile', 'Extrême', 'Maximal'];

// ---------------------------------------------------------------- Calculs
/** Temps moyen par exercice (toutes les occurrences d'un même exercice). */
export function exerciseAverages(result) {
  const map = new Map();
  for (const e of result.entries || []) {
    if (e.k !== 'work') continue;
    const key = e.exerciseId || e.name;
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, name: e.name, icon: e.icon, exerciseId: e.exerciseId, mode: e.mode, n: 0, sum: 0 }));
    g.n++;
    g.sum += e.sec;
  }
  return [...map.values()].map((g) => ({ ...g, avg: g.sum / g.n }));
}

/** Tours réalisés par bloc AMRAP. */
export const amrapRounds = (result) => (result.entries || []).filter((e) => e.k === 'amrap');

const numText = (p, mode) => (mode === 'reps' ? `${p.num} reps` : p.num);

/** Description comparable d'une séance : signature + valeurs / charges par exercice. */
export function sessionSpec(session) {
  const blocks = session?.blocks || [];
  const sig = JSON.stringify(blocks.map((b) => ({
    t: b.type, f: b.format, r: b.rounds, s: b.sets, d: b.duration, i: b.interval, c: b.timeCap, v: b.variable,
    rb: b.restBetween, ra: b.restAfter,
    items: (b.items || []).map((it) => ({ e: it.exerciseId, m: it.mode, v: it.value, l: it.load, p: b.variable ? it.perSet : null, ra: it.restAfter })),
  })));
  const ex = new Map();
  const heads = [];
  for (const b of blocks) {
    heads.push(blockHeader(b) || '');
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

// ---------------------------------------------------------------- Écran de résumé
function entryValue(e) {
  if (e.k !== 'work') return e.label;
  const l = loadText(e.load);
  return `${valueShort(e.mode, e.value)} ${String(e.name).toUpperCase()}${l ? ` · ${l}` : ''}`;
}

/**
 * Affiche le résumé d'un résultat (nouveau ou déjà enregistré) en plein écran.
 * @param opts {isNew, onClose()}
 */
export function openResultScreen(result, { isNew = false, onClose } = {}) {
  const r = clone(result);
  const root = $('#player-root');
  const el = document.createElement('div');
  el.className = 'summary';
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
    r.effort = r.entries.reduce((a, e) => a + e.sec, 0);
    r.rest = Math.max(0, r.total - r.effort);
  }

  function draw() {
    const blocks = r.snapshot?.blocks || [];
    const byBlock = new Map();
    r.entries.forEach((e, i) => {
      if (!byBlock.has(e.bi)) byBlock.set(e.bi, []);
      byBlock.get(e.bi).push({ e, i });
    });
    const blockRows = [...byBlock.entries()].map(([bi, list]) => {
      const b = blocks[bi];
      const info = (r.blocks || []).find((x) => x.bi === bi);
      const head = b && b.type !== 'sets'
        ? `<div class="sum-bhead"><span>${esc(blockHeader(b))}</span>${info ? `<span class="t">${fmtClock(info.sec)}</span>` : ''}</div>`
        : '';
      const rows = list.map(({ e, i }) => {
        if (e.k === 'amrap') {
          return `<div class="sum-row"><span class="ic"></span><span class="what">AMRAP<small>${esc(e.label)}</small></span>
            <button class="t edit" data-rounds="${i}">${e.rounds} tour${e.rounds > 1 ? 's' : ''}</button></div>`;
        }
        const icon = e.k === 'work' ? visualSmall(e) : '';
        return `<div class="sum-row"><span class="ic">${icon}</span><span class="what">${esc(entryValue(e))}<small>${esc(e.label)}</small></span>
          <button class="t edit" data-edit="${i}" title="Corriger le temps">${fmtClock(e.sec)}</button></div>`;
      }).join('');
      return `<div class="sum-block">${head}${rows}</div>`;
    }).join('');

    const avgs = exerciseAverages(r);
    const avgRows = avgs.map((g) => `<div class="sum-row"><span class="ic">${visualSmall(g)}</span><span class="what">${esc(String(g.name).toUpperCase())}<small>${g.n} fois · total ${fmtClock(g.sum)}</small></span><span class="t">${fmtClock(g.avg)}</span></div>`).join('');

    el.innerHTML = `
      <div class="sum-top">
        <button class="btn btn-icon" data-a="close" aria-label="Fermer">${I.close}</button>
        <span class="kicker">${isNew ? (r.complete ? 'Séance terminée' : 'Séance incomplète') : 'Résultat'}</span>
        <span></span>
      </div>
      <div class="sum-body">
        <div class="kicker">${esc(fmtDateLong(r.date))}</div>
        <h1 class="title-caps sum-title">${esc(r.sessionName)}</h1>
        <div class="sum-hero">
          <span class="outline">${fmtClock(r.total)}</span>
          <span class="sum-hero-side"><b>Temps total</b><span>Effort ${fmtClock(r.effort)}</span><span>Repos ${fmtClock(r.rest)}</span>${r.complete ? '' : '<span class="pill">INCOMPLÈTE</span>'}</span>
        </div>
        <hr class="rule">
        <div class="sum-h"><h3>Temps par exercice</h3><span class="small muted">Touchez un temps pour le corriger</span></div>
        ${blockRows || '<p class="muted small">Aucun exercice.</p>'}
        ${avgs.length ? `<div class="sum-h"><h3>Moyenne par exercice</h3></div><div class="sum-block">${avgRows}</div>` : ''}
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
      const v = prompt(`Temps pour « ${entryValue(e)} » (${e.label}) — format min:sec`, fmtClock(e.sec));
      if (v == null) return;
      const sec = parseClock(v);
      if (sec == null) { toast('Temps illisible (ex : 1:25)'); return; }
      const delta = sec - e.sec;
      e.sec = sec;
      r.total = Math.max(0, r.total + delta);
      const blk = (r.blocks || []).find((x) => x.bi === e.bi);
      if (blk) blk.sec = Math.max(0, blk.sec + delta);
      recompute();
      dirty = true;
      draw();
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
      draw();
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
  el.addEventListener('input', (ev) => { if (ev.target.matches('[data-note]')) dirty = true; });

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
    const canvas = await renderResultPoster(r, {
      name: S.db.settings.name, avgs: exerciseAverages(r), rpeLabel: r.rpe ? RPE_LABELS[r.rpe] : '', W: 1080, H: 1920,
    });
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
