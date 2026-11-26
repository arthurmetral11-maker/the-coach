// THE COACH — application principale (routes, vues, modales).
import {
  uid, esc, clone, MODES, DAYS_SHORT, MONTHS_SHORT, ymd, parseYmd, todayYmd, addDays, mondayOf, isoWeek,
  daysUntil, fmtDateLong, fmtShortTime, fmtClock, num, parseClock,
} from './utils.js';
import * as S from './store.js';
import {
  FORMATS, itemParts, blockHeader, blockCap, blockRestInfo, sessionSummary, sessionIcons,
  CATS, CAT_KEYS, catOf, catLabel, RUN_KINDS, RUN_ICON, stepText, stepValues, distText,
} from './format.js';
import { weekStats, fmtDuration, muscuTotals, resultCat } from './analytics.js';
import * as Voice from './voice.js';
import { ICONS } from './seed.js';
import { makeSortable, moveInArray } from './dnd.js';
import * as Sync from './sync.js';
import { openPlayer } from './player.js';
import { renderWeekPoster, canvasToPdfBlob } from './poster.js';
import {
  $, $$, I, toast, openModal, modalHead, finePointer, download, shareOrDownload, visual, visualSmall,
} from './ui.js';
import { openResultScreen } from './results.js';
import { renderHistory, renderProgression } from './history.js';

const view = $('#view');
const defaultText = (e) =>
  `${MODES[e.mode]?.label || ''} · ${Number(e.value) || 0} ${MODES[e.mode]?.unit || ''}${Number(e.load) > 0 ? ` · ${e.load} kg` : ''}`;

function countdownText() {
  const d = daysUntil(S.db.settings.hyroxDate);
  if (d == null || d < 0) return '';
  const name = (S.db.settings.hyroxName || 'Hyrox').toUpperCase();
  return d === 0 ? `JOUR J · ${esc(name)}` : `J-${d} · ${esc(name)}`;
}

// ---------------------------------------------------------------- Rendu d'une séance (style affiche)
function sessionDetailHtml(s) {
  const blocks = (s.blocks || []).map((b) => {
    if (b.type === 'run') {
      const lines = (b.steps || []).map((st) => {
        const t = stepText(st);
        return `<div class="sd-line ${b.loop ? 'indent' : ''}"><span class="ic">${st.kind === 'rest' ? '' : RUN_ICON}</span><span class="n">${esc(t.num)}</span><span class="nm">${esc(t.name)}</span><span class="ld">${t.pace ? `@ ${esc(t.pace)}` : ''}</span></div>`;
      }).join('');
      return b.loop
        ? `<div class="sd-block"><div class="sd-head"><span class="n">${esc(blockHeader(b))}</span><span class="pill soft">BOUCLE</span></div>${lines}</div>`
        : `<div class="sd-block">${lines}</div>`;
    }
    const rest = blockRestInfo(b);
    if (b.type === 'sets') {
      const it = b.items?.[0];
      if (!it) return '';
      const p = itemParts(it, b);
      return `<div class="sd-block"><div class="sd-line"><span class="ic">${visualSmall(it)}</span><span class="n">${esc(p.num)}</span><span class="nm">${esc(p.name)}</span><span class="ld">${esc(p.load)}</span></div>${rest ? `<div class="sd-rest">${esc(rest)}</div>` : ''}</div>`;
    }
    const cap = blockCap(b);
    const items = (b.items || []).map((it) => {
      const p = itemParts(it, b);
      const r = Number(it.restAfter) > 0 && b.format !== 'emom' ? `<span class="ld muted">+${fmtShortTime(it.restAfter)} repos</span>` : '';
      return `<div class="sd-line indent"><span class="ic">${visualSmall(it)}</span><span class="n">${esc(p.num)}</span><span class="nm">${esc(p.name)}</span><span class="ld">${esc(p.load)}</span>${r}</div>`;
    }).join('');
    return `<div class="sd-block"><div class="sd-head"><span class="n">${esc(blockHeader(b))}</span>${cap ? `<span class="pill">${esc(cap)}</span>` : ''}</div>${items || '<div class="sd-rest">Aucun exercice</div>'}${rest ? `<div class="sd-rest">${esc(rest)}</div>` : ''}</div>`;
  }).join('');
  return `
    <div class="kicker">${esc(catLabel(s))}</div>
    <h1 class="title-caps" style="font-size:26px;letter-spacing:.08em;margin-top:4px">${esc(s.name || 'Sans nom')}</h1>
    <hr class="rule">
    ${blocks || '<p class="muted">Séance vide.</p>'}
    ${s.notes ? `<p class="small" style="white-space:pre-wrap">${esc(s.notes)}</p>` : ''}`;
}

// ---------------------------------------------------------------- Lancement d'une séance
/** Lance le mode séance puis, à la fin, l'écran de résumé (enregistrement du résultat). */
function playSession(session, planEntryId = '') {
  const entry = planEntryId ? S.getPlan(planEntryId) : null;
  openPlayer(session, {
    planEntryId,
    order: entry?.myOrder || null,
    voice: S.db.settings.voice !== false,
    onOrder: (order) => { if (planEntryId) S.setPlanOrder(planEntryId, order); },
    onEnd: (result) => { if (result) openResultScreen(result, { isNew: true }); },
  });
}

/** Texte « fait » d'un résultat : temps total, ou nombre de séries en musculation. */
const doneText = (res) => (resultCat(res) === 'muscu' ? `${muscuTotals(res).sets} séries` : fmtClock(res.total));

// ---------------------------------------------------------------- Filtre des séances (catégorie + nom)
let sessCat = 'all';
const catChips = (active) => `<div class="chips" data-chips>${[['all', 'Toutes'], ...CAT_KEYS.map((k) => [k, CATS[k].label])]
  .map(([k, l]) => `<button type="button" class="chip ${active === k ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>`;
function filterSessions(q, cat) {
  const n = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const qq = n(q.trim());
  return S.listSessions().filter((s) => (cat === 'all' || catOf(s) === cat) && (!qq || n(`${s.name} ${catLabel(s)}`).includes(qq)));
}

// ---------------------------------------------------------------- Routeur
let current = null;
let prevHash = '#/planning';
let skipGuard = false;

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = (path || '').split('/').filter(Boolean);
  return { name: parts[0] || 'planning', arg: parts[1] ? decodeURIComponent(parts[1]) : '', params: new URLSearchParams(query || '') };
}

const routes = {
  planning: renderPlanning,
  seances: renderSessions,
  seance: renderEditor,
  exercices: renderExercises,
  historique: (r) => renderHistory(view, r),
  progression: (r) => renderProgression(view, r),
  reglages: renderSettings,
};

const needsLogin = () => Sync.isConfigured() && !S.db.account;

function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  current = parseHash();
  document.body.classList.toggle('logged-out', needsLogin());
  if (needsLogin()) {
    current = { name: 'login', arg: '', params: new URLSearchParams() };
    renderLogin();
    updateTopbar();
    return;
  }
  const fn = routes[current.name] || renderPlanning;
  const tab = current.name === 'seance' ? 'seances' : current.name === 'progression' ? 'historique' : current.name;
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  fn(current);
  updateTopbar();
  window.scrollTo(0, keepScroll ? y : 0);
}

window.addEventListener('hashchange', (e) => {
  const oldHash = new URL(e.oldURL).hash;
  if (skipGuard) { skipGuard = false; return; }
  if (current?.name === 'seance' && editorDirty() && !confirm('Quitter sans enregistrer les modifications ?')) {
    skipGuard = true;
    location.hash = oldHash;
    return;
  }
  if (oldHash && !oldHash.startsWith('#/seance/')) prevHash = oldHash;
  $('#modal-root').innerHTML = ''; // ferme les fenêtres ouvertes (ex. bouton retour du navigateur)
  document.body.style.overflow = '';
  render();
});
window.addEventListener('beforeunload', (e) => {
  if (current?.name === 'seance' && editorDirty()) { e.preventDefault(); e.returnValue = ''; }
});

function updateTopbar() {
  $('#countdown').innerHTML = countdownText();
}

S.subscribe((what) => {
  updateTopbar();
  if (what === 'account') { render(); return; }
  if (!current || current.name === 'seance' || current.name === 'reglages' || current.name === 'login') return;
  render({ keepScroll: true });
});

// ================================================================= PLANNING
function renderPlanning(r) {
  const base = r.params.get('w') ? parseYmd(r.params.get('w')) : new Date();
  const mon = mondayOf(base);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const sun = days[6];
  const today = todayYmd();
  const range = mon.getMonth() === sun.getMonth()
    ? `${mon.getDate()} — ${sun.getDate()} ${MONTHS_SHORT[sun.getMonth()]} ${sun.getFullYear()}`
    : `${mon.getDate()} ${MONTHS_SHORT[mon.getMonth()]} — ${sun.getDate()} ${MONTHS_SHORT[sun.getMonth()]} ${sun.getFullYear()}`;

  const dayHtml = (d, i) => {
    const ds = ymd(d);
    const entries = S.planFor(ds);
    const cls = ds === today ? 'today' : ds < today ? 'past' : '';
    const content = entries.map((e) => {
      const { session } = S.planSession(e);
      const icons = sessionIcons(session);
      const res = S.resultForPlan(e.id);
      const done = res ? `<span class="done-mark" title="Séance faite">${I.check}${esc(doneText(res))}</span>` : '';
      return `<button class="entry ${res ? 'is-done' : ''}" data-entry="${e.id}"><span class="icons">${esc(icons)}</span><span class="etext"><div class="ename">${esc(session.name)}</div><div class="esum">${esc(sessionSummary(session))}</div></span>${done}<span class="chev">${I.chevR}</span></button>`;
    }).join('');
    return `<div class="day ${cls}">
      <div class="dlabel"><span class="dname">${DAYS_SHORT[i]}</span><span class="dnum">${d.getDate()}</span></div>
      <div class="dcontent">${content || '<div class="off">OFF</div>'}<button class="add-day" data-add="${ds}">+ Ajouter</button></div>
    </div>`;
  };

  view.innerHTML = `<div id="pl">
    <div class="page-head">
      <div class="outline big">${String(isoWeek(mon)).padStart(2, '0')}</div>
      <div class="head-right"><span class="kicker">Semaine</span><span class="title-caps">${range}</span></div>
    </div>
    <div class="week-nav">
      <button class="btn btn-icon" data-a="prev" aria-label="Semaine précédente">${I.chevL}</button>
      <button class="btn btn-sm" data-a="today">Aujourd'hui</button>
      <button class="btn btn-icon" data-a="next" aria-label="Semaine suivante">${I.chevR}</button>
      <input type="date" data-a="jump" value="${ymd(mon)}" style="max-width:170px;min-height:40px" aria-label="Aller à une date">
      <span class="grow"></span>
      <button class="btn btn-primary btn-sm" data-a="poster">${I.share} Affiche de la semaine</button>
    </div>
    ${weekBilanHtml(days)}
    <div class="days">${days.map(dayHtml).join('')}</div>
  </div>`;

  const root = $('#pl');
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'prev') location.hash = `#/planning?w=${ymd(addDays(mon, -7))}`;
    else if (a === 'next') location.hash = `#/planning?w=${ymd(addDays(mon, 7))}`;
    else if (a === 'today') location.hash = '#/planning';
    else if (a === 'poster') openPoster(mon);
    const entry = e.target.closest('[data-entry]');
    if (entry) openPlanDetail(entry.dataset.entry);
    const add = e.target.closest('[data-add]');
    if (add) openSessionPicker(add.dataset.add);
  });
  $('[data-a="jump"]', root).addEventListener('change', (e) => {
    if (e.target.value) location.hash = `#/planning?w=${e.target.value}`;
  });
}

/** Bilan de la semaine : séances faites / prévues, durée, km courus, séries de musculation, RPE moyen. */
function weekBilanHtml(days) {
  const dates = new Set(days.map(ymd));
  const entries = days.flatMap((d) => S.planFor(ymd(d)));
  const results = S.listResults().filter((r) => dates.has(r.date));
  if (!entries.length && !results.length) return '';
  const entryIds = new Set(entries.map((e) => e.id));
  const doneEntries = entries.filter((e) => S.resultForPlan(e.id)).length;
  const extra = results.filter((r) => !r.planEntryId || !entryIds.has(r.planEntryId)).length;
  const w = weekStats(results);
  const km = w.meters ? String(+(w.meters / 1000).toFixed(1)).replace('.', ',') : '—';
  const tile = (v, l) => `<div class="b-tile"><span class="b-v">${v}</span><span class="b-l">${l}</span></div>`;
  const parts = CAT_KEYS.filter((k) => w.byCat[k] > 0).map((k) => `${CATS[k].label} ${fmtDuration(w.byCat[k])}`);
  return `<div class="bilan">
    <div class="b-tiles">
      ${tile(String(doneEntries + extra), `Faites · ${entries.length} prévue${entries.length > 1 ? 's' : ''}`)}
      ${tile(w.duration ? fmtDuration(w.duration) : '—', 'Durée')}
      ${tile(km, 'Km courus')}
      ${tile(w.sets || '—', 'Séries muscu')}
      ${tile(w.rpe ? String(+w.rpe.toFixed(1)).replace('.', ',') : '—', 'RPE moyen')}
    </div>
    ${parts.length ? `<div class="small muted b-cats">${esc(parts.join(' · '))}</div>` : ''}
  </div>`;
}

function openPlanDetail(entryId) {
  const e = S.getPlan(entryId);
  if (!e) return;
  const { session, live, orphan } = S.planSession(e);
  const res = S.resultForPlan(e.id);
  openModal(`${modalHead(esc(fmtDateLong(e.date)))}
    ${res ? `<button class="done-banner" data-a="result"><span>${I.check}</span><span class="grow"><b>Séance faite · ${esc(doneText(res))}</b><span class="small">${res.complete ? '' : 'Incomplète · '}${res.rpe ? `RPE ${res.rpe} · ` : ''}voir le résultat</span></span><span class="chev">${I.chevR}</span></button>` : ''}
    ${sessionDetailHtml(session)}
    ${e.myOrder && catOf(session) === 'hyrox' ? '<p class="small"><span class="pill soft">ORDRE PERSO</span> Ton ordre des exercices est gardé pour cette séance (« Mon ordre » au lancement).</p>' : ''}
    ${!live ? `<p class="small muted">${orphan ? 'Cette séance a été supprimée de la bibliothèque. ' : ''}Version figée de la séance (les modifications de la bibliothèque ne s’appliquent qu’aux séances à venir).</p>` : ''}
    <div class="stack" style="margin-top:14px">
      <button class="btn ${res ? '' : 'btn-primary'} btn-block" data-a="play">${I.play} ${res ? 'Refaire la séance' : 'Lancer la séance'}</button>
      <label class="field">Déplacer au<input type="date" data-a="move" value="${e.date}"></label>
      <div class="row between">
        ${live ? `<button class="btn btn-sm" data-a="edit">${I.edit} Modifier la séance</button>` : '<span></span>'}
        <button class="btn btn-sm btn-danger" data-a="remove">${I.trash} Retirer du planning</button>
      </div>
    </div>`, (m, close) => {
    m.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-a]')?.dataset.a;
      if (a === 'play') { close(); playSession(session, e.id); }
      if (a === 'result') { close(); openResultScreen(res); }
      if (a === 'edit') { close(); location.hash = `#/seance/${encodeURIComponent(e.sessionId)}`; }
      if (a === 'remove' && confirm('Retirer cette séance du planning ?')) { S.removePlan(e.id); close(); toast('Séance retirée'); }
    });
    $('[data-a="move"]', m).addEventListener('change', (ev) => {
      if (!ev.target.value || ev.target.value === e.date) return;
      S.movePlan(e.id, ev.target.value);
      close();
      toast(`Déplacée au ${fmtDateLong(ev.target.value)}`);
    });
  });
}

function openSessionPicker(date) {
  openModal(`${modalHead(`Ajouter · ${esc(fmtDateLong(date))}`)}
    <div class="search">${I.search}<input data-q placeholder="Rechercher une séance"></div>
    <div data-chipbox style="margin-top:8px">${catChips(sessCat)}</div>
    <div class="pick-list" data-list style="margin-top:8px"></div>
    <button class="btn btn-block" data-new style="margin-top:12px">${I.plus} Créer une nouvelle séance</button>`, (m, close) => {
    const input = $('[data-q]', m);
    const list = $('[data-list]', m);
    const draw = () => {
      const items = filterSessions(input.value, sessCat);
      list.innerHTML = items.map((s) => `<button class="pick-row" data-id="${s.id}"><span class="grow"><div class="nm">${esc(s.name)}</div><div class="small muted"><b>${esc(catLabel(s))}</b> · ${esc(sessionSummary(s))}</div></span><span class="chev">${I.plus}</span></button>`).join('')
        || '<div class="empty small">Aucune séance trouvée.</div>';
    };
    draw();
    input.addEventListener('input', draw);
    if (finePointer()) input.focus();
    $('[data-chipbox]', m).addEventListener('click', (ev) => {
      const c = ev.target.closest('[data-cat]');
      if (!c) return;
      sessCat = c.dataset.cat;
      $('[data-chipbox]', m).innerHTML = catChips(sessCat);
      draw();
    });
    list.addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-id]');
      if (!row) return;
      S.addPlan(date, row.dataset.id);
      close();
      toast('Séance planifiée');
    });
    $('[data-new]', m).addEventListener('click', () => {
      close();
      location.hash = `#/seance/new?plan=${date}`;
    });
  });
}

// ---------------------------------------------------------------- Affiche
async function openPoster(mon) {
  const week = {
    monday: mon,
    days: Array.from({ length: 7 }, (_, i) => {
      const d = addDays(mon, i);
      return { date: d, sessions: S.planFor(ymd(d)).map((e) => S.planSession(e).session) };
    }),
    name: S.db.settings.name,
    hyroxName: S.db.settings.hyroxName,
    hyroxDate: S.db.settings.hyroxDate,
  };
  const base = `the-coach-semaine-${String(isoWeek(mon)).padStart(2, '0')}-${ymd(mon)}`;
  openModal(`${modalHead('Affiche de la semaine')}
    <div class="stack">
      <div class="seg" data-fmt><button data-f="story" class="on">Story 9:16</button><button data-f="a4">A4</button></div>
      <img class="poster-preview" data-img alt="Aperçu de l'affiche">
      <div class="row"><button class="btn btn-primary grow" data-a="share-png" disabled>${I.share} Partager l'image</button></div>
      <div class="row"><button class="btn grow" data-a="dl-png" disabled>${I.download} PNG</button><button class="btn grow" data-a="dl-pdf" disabled>${I.download} PDF</button><button class="btn grow" data-a="share-pdf" disabled>${I.share} PDF</button></div>
      <p class="small muted">Instagram n'accepte que les images : utilisez l'image (PNG). Le PDF est pratique pour l'e-mail ou l'impression.</p>
    </div>`, (m) => {
    let png = null;
    let pdf = null;
    const img = $('[data-img]', m);
    const btns = $$('[data-a]', m);
    const gen = async (fmt) => {
      btns.forEach((b) => (b.disabled = true));
      const size = fmt === 'a4' ? { W: 1240, H: 1754 } : { W: 1080, H: 1920 };
      const canvas = await renderWeekPoster(week, size);
      png = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      pdf = canvasToPdfBlob(canvas);
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(png);
      btns.forEach((b) => (b.disabled = false));
    };
    gen('story');
    $('[data-fmt]', m).addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      $$('[data-f]', m).forEach((x) => x.classList.toggle('on', x === b));
      gen(b.dataset.f);
    });
    m.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!png) return;
      if (a === 'share-png') shareOrDownload(png, `${base}.png`, 'Mon planning de la semaine');
      if (a === 'dl-png') download(png, `${base}.png`);
      if (a === 'dl-pdf') download(pdf, `${base}.pdf`);
      if (a === 'share-pdf') shareOrDownload(pdf, `${base}.pdf`, 'Mon planning de la semaine');
    });
  });
}

// ================================================================= BIBLIOTHÈQUE DE SÉANCES
function renderSessions() {
  view.innerHTML = `<div id="se">
    <div class="page-head">
      <div><div class="kicker">Bibliothèque commune</div><h1 class="display" style="font-size:clamp(48px,12vw,84px)">Séances</h1></div>
      <button class="btn btn-primary" data-a="new">${I.plus} Nouvelle séance</button>
    </div>
    <div class="search" style="margin:12px 0 8px">${I.search}<input data-q placeholder="Rechercher par nom"></div>
    <div data-chipbox style="margin-bottom:12px">${catChips(sessCat)}</div>
    <div class="list" data-list></div>
  </div>`;
  const root = $('#se');
  const list = $('[data-list]', root);
  const input = $('[data-q]', root);
  const draw = () => {
    const items = filterSessions(input.value, sessCat);
    const any = S.listSessions().length;
    list.innerHTML = items.map((s, i) => `<div class="list-item" data-id="${s.id}">
        <span class="idx">${String(i + 1).padStart(2, '0')}</span>
        <div class="grow"><div class="li-title">${esc(s.name)}</div><div class="li-sub"><b>${esc(catLabel(s))}</b> · ${esc(sessionSummary(s))}</div>
        ${s.updatedBy ? `<div class="small muted">Modifiée par ${esc(s.updatedBy)}</div>` : ''}</div>
        <span class="chev">${I.chevR}</span></div>`).join('')
      || (any ? '<div class="empty">Aucune séance ne correspond à la recherche.</div>' : `<div class="empty"><span class="outline">00</span>Aucune séance. Créez la première !</div>`);
  };
  draw();
  input.addEventListener('input', draw);
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-chipbox] [data-cat]');
    if (c) {
      sessCat = c.dataset.cat;
      $('[data-chipbox]', root).innerHTML = catChips(sessCat);
      draw();
      return;
    }
    if (e.target.closest('[data-a="new"]')) location.hash = `#/seance/new${sessCat !== 'all' ? `?cat=${sessCat}` : ''}`;
    const row = e.target.closest('[data-id]');
    if (row) openSessionDetail(row.dataset.id);
  });
}

function openSessionDetail(id) {
  const s = S.getSession(id);
  if (!s) return;
  const resolved = S.resolveSession(s);
  openModal(`${modalHead('Séance')}
    ${sessionDetailHtml(resolved)}
    <div class="stack" style="margin-top:14px">
      <button class="btn btn-primary btn-block" data-a="play">${I.play} Lancer maintenant</button>
      <div class="row"><input type="date" data-date value="${todayYmd()}" class="grow" style="flex:1"><button class="btn" data-a="plan">${I.cal} Planifier</button></div>
      <div class="row between">
        <div class="row"><button class="btn btn-sm" data-a="edit">${I.edit} Modifier</button><button class="btn btn-sm" data-a="dup">${I.copy} Dupliquer</button></div>
        <button class="btn btn-sm btn-danger" data-a="del">${I.trash} Supprimer</button>
      </div>
      ${s.updatedBy ? `<p class="small muted">Dernière modification par ${esc(s.updatedBy)}.</p>` : ''}
    </div>`, (m, close) => {
    m.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'play') {
        close();
        // Rattache le résultat à la séance planifiée aujourd'hui (s'il y en a une, pas encore faite).
        const entry = S.planFor(todayYmd()).find((p) => p.sessionId === id && !S.resultForPlan(p.id));
        playSession(resolved, entry?.id || '');
      }
      if (a === 'plan') {
        const d = $('[data-date]', m).value;
        if (!d) return;
        S.addPlan(d, id);
        close();
        toast(`Planifiée le ${fmtDateLong(d)}`);
      }
      if (a === 'edit') { close(); location.hash = `#/seance/${encodeURIComponent(id)}`; }
      if (a === 'dup') {
        const c = clone(s);
        c.id = uid();
        c.name = `${s.name} (copie)`;
        c.blocks.forEach((b) => {
          b.id = uid();
          (b.items || []).forEach((it) => { it.id = uid(); });
          (b.steps || []).forEach((st) => { st.id = uid(); });
        });
        delete c.deleted;
        S.saveSession(c);
        close();
        toast('Séance dupliquée');
      }
      if (a === 'del' && confirm(`Supprimer « ${s.name} » de la bibliothèque commune (pour tout le monde) ?\nLes séances déjà passées restent visibles dans le planning.`)) {
        S.deleteSession(id);
        close();
        toast('Séance supprimée');
      }
    });
  });
}

// ================================================================= ÉDITEUR DE SÉANCE
let draft = null;
let draftOrig = '';
let draftPlanDate = '';
const editorDirty = () => !!draft && JSON.stringify(draft) !== draftOrig;

function newItem(ex) {
  return {
    id: uid(), exerciseId: ex.id, name: ex.name, icon: ex.icon, mode: ex.mode || 'reps',
    value: Number(ex.value) || 10, load: Number(ex.load) || 0, restAfter: 0, perSet: [],
  };
}
const newSetsBlock = (ex) => ({ id: uid(), type: 'sets', sets: 3, restBetween: 60, restAfter: 0, variable: false, items: [newItem(ex)] });
const newWodBlock = (format) => ({
  id: uid(), type: 'wod', format, rounds: 3, timeCap: 0, duration: format === 'emom' ? 10 : 12, interval: 60,
  restBetween: 0, restAfter: 0, items: [],
});
const newStep = (kind = 'run', o = {}) => ({
  id: uid(), kind, label: '', by: kind === 'rest' ? 'time' : 'distance', distance: kind === 'run' ? 1000 : 200, time: 60, pace: 0, ...o,
});
const newRunBlock = (loop) => (loop
  ? { id: uid(), type: 'run', loop: true, rounds: 6, items: [], steps: [newStep('run', { distance: 400 }), newStep('active', { by: 'time', time: 60 })] }
  : { id: uid(), type: 'run', loop: false, rounds: 1, items: [], steps: [newStep('run')] });

function syncPerSet(b) {
  const it = b.items[0];
  if (!it) return;
  const n = Math.max(1, Math.min(30, Number(b.sets) || 1));
  const arr = Array.isArray(it.perSet) ? it.perSet : [];
  while (arr.length < n) {
    const last = arr[arr.length - 1];
    arr.push(last ? { ...last } : { value: Number(it.value) || 0, load: Number(it.load) || 0 });
  }
  arr.length = n;
  it.perSet = arr;
}

function setPath(obj, path, val) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = val;
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

function renderEditor(r) {
  const id = r.arg;
  if (id === 'new') {
    const cat = CATS[r.params.get('cat')] ? r.params.get('cat') : 'hyrox';
    draft = { id: uid(), name: '', cat, tag: CATS[cat].label, notes: '', blocks: [] };
  } else {
    const s = S.getSession(id);
    if (!s) {
      view.innerHTML = `<div class="empty">Séance introuvable.<br><br><a class="btn" href="#/seances">Retour</a></div>`;
      draft = null;
      return;
    }
    draft = clone(s);
    draft.cat = catOf(s);
    draft.tag = CATS[draft.cat].label;
  }
  draftOrig = JSON.stringify(draft);
  draftPlanDate = r.params.get('plan') || '';
  drawEditor();
}

function numField(label, path, value, unit, { rerender = false, min = 0 } = {}) {
  return `<label class="field">${label}<div class="input-unit"><input type="number" inputmode="decimal" min="${min}" step="any" data-bind="${path}" data-num ${rerender ? 'data-rerender' : ''} value="${value ?? ''}"><span class="unit">${unit}</span></div></label>`;
}
/** Champ min:sec (durée, allure). */
function clockField(label, path, value, unit) {
  return `<label class="field">${label}<div class="input-unit"><input inputmode="numeric" autocomplete="off" data-bind="${path}" data-clock value="${Number(value) > 0 ? fmtClock(value) : ''}" placeholder="mm:ss"><span class="unit">${unit}</span></div></label>`;
}
function modeSeg(it, path) {
  return `<div class="seg">${Object.entries(MODES).map(([k, m]) => `<button type="button" data-a="mode" data-path="${path}" data-mode="${k}" class="${it.mode === k ? 'on' : ''}">${m.label}</button>`).join('')}</div>`;
}
function exPick(it, bi, ii) {
  return `<button type="button" class="ex-pick" data-a="pick-ex" data-b="${bi}" data-i="${ii}"><span class="ex-visual">${visual(it)}</span><span style="min-width:0"><div class="nm">${esc(it.name)}</div><div class="chg">Changer d'exercice</div></span></button>`;
}

function setsBody(b, bi) {
  const it = b.items[0];
  const p = `blocks.${bi}.items.0`;
  const unit = MODES[it.mode]?.unit || '';
  const perSet = b.variable
    ? `<div class="perset"><span class="ps-h">SÉRIE</span><span class="ps-h">${MODES[it.mode].label.toUpperCase()} (${unit})</span><span class="ps-h">CHARGE (KG)</span>
        ${(it.perSet || []).map((ps, si) => `<span class="title-caps">${si + 1}</span><input type="number" inputmode="decimal" step="any" data-bind="${p}.perSet.${si}.value" data-num value="${ps.value}"><input type="number" inputmode="decimal" step="any" data-bind="${p}.perSet.${si}.load" data-num value="${ps.load}">`).join('')}
      </div>`
    : '';
  return `
    <div class="item-top">${exPick(it, bi, 0)}</div>
    ${modeSeg(it, p)}
    <div class="item-fields">
      ${numField('Séries', `blocks.${bi}.sets`, b.sets, '', { rerender: b.variable, min: 1 })}
      ${b.variable ? '' : numField(MODES[it.mode].label, `${p}.value`, it.value, unit)}
      ${b.variable ? '' : numField('Charge', `${p}.load`, it.load, 'kg')}
    </div>
    <div style="margin-top:10px"><label class="switch"><input type="checkbox" data-a="variable" data-b="${bi}" ${b.variable ? 'checked' : ''}><span class="track"></span>Séries variables (ex : 12/10/8)</label></div>
    ${perSet}
    <div class="grid-2" style="margin-top:10px">
      ${numField('Repos entre séries', `blocks.${bi}.restBetween`, b.restBetween, 'sec')}
      ${numField('Repos après le bloc', `blocks.${bi}.restAfter`, b.restAfter, 'sec')}
    </div>`;
}

function wodBody(b, bi, cat) {
  const f = b.format;
  const muscu = cat === 'muscu';
  const params = [];
  if (f === 'rounds' || f === 'fortime') {
    params.push(numField('Tours', `blocks.${bi}.rounds`, b.rounds, '', { min: 1 }));
    if (!muscu) params.push(numField('Time cap', `blocks.${bi}.timeCap`, b.timeCap, 'min'));
    params.push(numField('Repos entre tours', `blocks.${bi}.restBetween`, b.restBetween, 'sec'));
  }
  if (f === 'amrap') params.push(numField('Durée', `blocks.${bi}.duration`, b.duration, 'min', { min: 1 }));
  if (f === 'emom') {
    params.push(numField('Durée totale', `blocks.${bi}.duration`, b.duration, 'min', { min: 1 }));
    params.push(numField('Chaque', `blocks.${bi}.interval`, b.interval, 'sec', { min: 10 }));
  }
  params.push(numField('Repos après le bloc', `blocks.${bi}.restAfter`, b.restAfter, 'sec'));
  const items = b.items.map((it, ii) => {
    const p = `blocks.${bi}.items.${ii}`;
    const unit = MODES[it.mode]?.unit || '';
    return `<div class="item" data-sort-item>
      <div class="item-top"><span class="handle" data-handle title="Glisser pour déplacer">${I.grip}</span>${exPick(it, bi, ii)}<button type="button" class="btn btn-icon btn-ghost" data-a="del-item" data-b="${bi}" data-i="${ii}" aria-label="Retirer">${I.trash}</button></div>
      ${modeSeg(it, p)}
      <div class="item-fields">
        ${numField(MODES[it.mode].label, `${p}.value`, it.value, unit)}
        ${numField('Charge', `${p}.load`, it.load, 'kg')}
        ${f === 'emom' ? '' : numField('Repos après', `${p}.restAfter`, it.restAfter, 'sec')}
      </div>
    </div>`;
  }).join('');
  // Musculation : seule la boucle en tours est proposée (AMRAP, EMOM et For time sont des formats au temps).
  const seg = muscu && f === 'rounds'
    ? ''
    : `<div class="seg">${Object.entries(FORMATS).filter(([k]) => !muscu || k === 'rounds' || k === f).map(([k, v]) => `<button type="button" data-a="format" data-b="${bi}" data-f="${k}" class="${k === f ? 'on' : ''}">${v.label}</button>`).join('')}</div>
       <div class="small muted" style="margin-top:6px">${FORMATS[f]?.hint || ''}</div>`;
  return `
    ${seg}
    <div class="block-params">${params.join('')}</div>
    <div data-items="${bi}">${items}</div>
    ${b.items.length ? '' : `<div class="small muted" style="margin:6px 0">Ajoutez les exercices de la boucle.</div>`}
    <button type="button" class="btn btn-sm" data-a="add-item" data-b="${bi}">${I.plus} Ajouter un exercice</button>`;
}

/** Ligne d'information calculée d'une étape running (la 3e valeur et la façon dont elle se termine). */
function stepCalc(st) {
  const v = stepValues(st);
  if (st.kind === 'rest') return v.time ? 'S’enchaîne seule à la fin du temps.' : 'Indique une durée.';
  if (v.by === 'distance') {
    if (!v.distance) return 'Indique une distance.';
    return `Fin avec le bouton « Fait » (ton temps réel est mesuré)${v.pace ? ` · temps cible ${fmtClock(v.time)}` : ''}.`;
  }
  if (!v.time) return 'Indique une durée.';
  return `S’enchaîne seule à la fin du temps${v.pace ? ` · ≈ ${distText(v.distance)}` : ''}.`;
}

function stepHtml(st, bi, si, inLoop) {
  const p = `blocks.${bi}.steps.${si}`;
  const v = stepValues(st);
  const kinds = Object.entries(RUN_KINDS).map(([k, x]) => `<button type="button" data-a="rkind" data-b="${bi}" data-s="${si}" data-k="${k}" class="${st.kind === k ? 'on' : ''}">${x.label}</button>`).join('');
  const bySeg = st.kind === 'rest' ? '' : `<div class="seg"><button type="button" data-a="rby" data-b="${bi}" data-s="${si}" data-k="distance" class="${v.by === 'distance' ? 'on' : ''}">Distance</button><button type="button" data-a="rby" data-b="${bi}" data-s="${si}" data-k="time" class="${v.by === 'time' ? 'on' : ''}">Temps</button></div>`;
  const main = v.by === 'distance' ? numField('Distance', `${p}.distance`, st.distance, 'm') : clockField('Durée', `${p}.time`, st.time, 'min:s');
  const pace = st.kind === 'rest' ? '' : clockField('Allure (facultatif)', `${p}.pace`, st.pace, '/km');
  return `<div class="item step" data-sort-item>
    <div class="item-top">
      ${inLoop ? `<span class="handle" data-handle title="Glisser pour déplacer">${I.grip}</span>` : ''}
      <div class="seg grow-0">${kinds}</div>
      <span class="grow"></span>
      ${inLoop ? `<button type="button" class="btn btn-icon btn-ghost" data-a="del-step" data-b="${bi}" data-s="${si}" aria-label="Retirer l'étape">${I.trash}</button>` : ''}
    </div>
    <div class="step-grid">
      <label class="field">Nom (facultatif)<input data-bind="${p}.label" value="${esc(st.label || '')}" placeholder="${st.kind === 'run' ? 'ex : Échauffement, Côte' : RUN_KINDS[st.kind].label}" autocomplete="off"></label>
      ${bySeg ? `<div class="field-like"><span class="kicker">Définie par</span>${bySeg}</div>` : ''}
    </div>
    <div class="grid-2" style="margin-top:8px">${main}${pace}</div>
    <div class="small muted step-calc" data-calc="${bi}-${si}">${esc(stepCalc(st))}</div>
  </div>`;
}

function runBlockHtml(b, bi) {
  const steps = (b.steps || []).map((st, si) => stepHtml(st, bi, si, b.loop)).join('');
  return `
    ${b.loop ? `<div class="block-params">${numField('Répétitions', `blocks.${bi}.rounds`, b.rounds, '×', { min: 1 })}</div>` : ''}
    <div data-steps="${bi}">${steps}</div>
    ${b.loop ? `<button type="button" class="btn btn-sm" data-a="add-step" data-b="${bi}">${I.plus} Ajouter une étape</button>` : ''}`;
}

function blockTitle(b, cat) {
  if (b.type === 'run') return b.loop ? 'Boucle · fractionné' : 'Étape';
  if (b.type === 'sets') return 'Exercice · séries';
  if (cat === 'muscu' && b.format === 'rounds') return 'Boucle · tours';
  return `WOD · ${FORMATS[b.format]?.label || ''}`;
}

function drawEditor() {
  const y = window.scrollY;
  const isNew = !S.getSession(draft.id);
  const cat = catOf(draft);
  const hasBlocks = draft.blocks.length > 0;
  const blocks = draft.blocks.map((b, bi) => `
    <div class="block" data-sort-item>
      <div class="block-top">
        <span class="handle" data-handle title="Glisser pour déplacer">${I.grip}</span>
        <span class="bt-title">${blockTitle(b, cat)}</span>
        <button type="button" class="btn btn-icon btn-ghost" data-a="dup-block" data-b="${bi}" aria-label="Dupliquer">${I.copy}</button>
        <button type="button" class="btn btn-icon btn-ghost" data-a="del-block" data-b="${bi}" aria-label="Supprimer">${I.trash}</button>
      </div>
      ${b.type === 'run' ? runBlockHtml(b, bi) : b.type === 'sets' ? setsBody(b, bi) : wodBody(b, bi, cat)}
    </div>`).join('');

  const addBar = cat === 'running'
    ? `<button type="button" class="btn" data-a="add-step-block">${I.plus} Étape</button>
       <button type="button" class="btn" data-a="add-loop">${I.plus} Boucle (fractionné)</button>`
    : `<button type="button" class="btn" data-a="add-sets">${I.plus} Exercice (séries)</button>
       <button type="button" class="btn" data-a="add-wod">${I.plus} ${cat === 'muscu' ? 'Boucle (tours)' : 'WOD (boucle)'}</button>`;
  const emptyText = {
    hyrox: 'Ajoutez un exercice (avec ses séries) ou un WOD (boucle de plusieurs exercices).',
    running: 'Ajoutez des étapes (Run, Repos actif, Repos) à la suite, ou une boucle pour du fractionné (ex : 10 × 400 m + 1:00 de récup).',
    muscu: 'Ajoutez un exercice (avec ses séries) ou une boucle en tours (circuit). Seuls les repos sont chronométrés.',
  }[cat];
  const catOptions = CAT_KEYS.map((k) => {
    const locked = hasBlocks && (k === 'running') !== (cat === 'running');
    return `<option value="${k}" ${k === cat ? 'selected' : ''} ${locked ? 'disabled' : ''}>${CATS[k].label}${locked ? ' (séance vide uniquement)' : ''}</option>`;
  }).join('');

  view.innerHTML = `<div id="ed">
    <div class="row between" style="margin-bottom:10px"><button type="button" class="btn btn-ghost btn-sm" data-a="cancel">${I.chevL} Retour</button><span class="kicker">${isNew ? 'Nouvelle séance' : 'Modifier la séance'}</span></div>
    <div class="editor-head">
      <input class="title-input" data-bind="name" placeholder="NOM DE LA SÉANCE" value="${esc(draft.name)}" autocomplete="off">
      <div class="grid-2">
        <label class="field">Catégorie<select data-cat>${catOptions}</select></label>
        <span></span>
      </div>
      ${hasBlocks ? `<p class="small muted" style="margin:-4px 0 0">${cat === 'running' ? 'Pour passer en Hyrox ou Musculation, la séance doit être vide.' : 'Hyrox ↔ Musculation à tout moment ; Running seulement si la séance est vide.'}</p>` : ''}
      <label class="field">Notes<textarea data-bind="notes" placeholder="Consignes, objectifs…">${esc(draft.notes || '')}</textarea></label>
    </div>
    <div id="blocks">${blocks}</div>
    ${hasBlocks ? '' : `<div class="empty small">${emptyText}</div>`}
    <div class="add-bar">${addBar}</div>
    <div class="sticky-save">
      <button type="button" class="btn" style="background:var(--bg)" data-a="cancel">Annuler</button>
      <button type="button" class="btn btn-primary" data-a="save">Enregistrer</button>
    </div>
  </div>`;
  window.scrollTo(0, y);

  const root = $('#ed');
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.bind) return;
    let val = t.value;
    if (t.hasAttribute('data-num')) val = num(t.value, 0);
    else if (t.hasAttribute('data-clock')) val = parseClock(t.value) ?? 0;
    setPath(draft, t.dataset.bind, val);
    const m = /^blocks\.(\d+)\.steps\.(\d+)\./.exec(t.dataset.bind);
    if (m) {
      const calc = $(`[data-calc="${m[1]}-${m[2]}"]`, root);
      if (calc) calc.textContent = stepCalc(draft.blocks[+m[1]].steps[+m[2]]);
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-cat]')) {
      draft.cat = t.value;
      draft.tag = CATS[t.value].label;
      drawEditor();
      return;
    }
    if (t.hasAttribute('data-clock')) {
      const v = parseClock(t.value);
      t.value = v ? fmtClock(v) : '';
      return;
    }
    if (t.dataset.a === 'variable') {
      const b = draft.blocks[+t.dataset.b];
      b.variable = t.checked;
      if (b.variable) {
        b.items[0].perSet = [];
        syncPerSet(b);
      }
      drawEditor();
      return;
    }
    if (t.hasAttribute('data-rerender')) {
      draft.blocks.forEach((b) => { if (b.type === 'sets' && b.variable) syncPerSet(b); });
      drawEditor();
    }
  });
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el || el.tagName === 'INPUT') return;
    const a = el.dataset.a;
    const bi = el.dataset.b != null ? +el.dataset.b : -1;
    const ii = el.dataset.i != null ? +el.dataset.i : -1;
    const si = el.dataset.s != null ? +el.dataset.s : -1;
    const b = draft.blocks[bi];
    const bottom = () => window.scrollTo(0, document.body.scrollHeight);
    switch (a) {
      case 'cancel':
        goBackFromEditor();
        break;
      case 'save':
        saveDraft();
        break;
      case 'add-sets':
        openExercisePicker((ex) => {
          draft.blocks.push(newSetsBlock(ex));
          drawEditor();
          bottom();
        });
        break;
      case 'add-wod':
        if (cat === 'muscu') {
          draft.blocks.push(newWodBlock('rounds'));
          drawEditor();
          bottom();
          break;
        }
        openFormatPicker((f) => {
          draft.blocks.push(newWodBlock(f));
          drawEditor();
          bottom();
        });
        break;
      case 'add-step-block':
        draft.blocks.push(newRunBlock(false));
        drawEditor();
        bottom();
        break;
      case 'add-loop':
        draft.blocks.push(newRunBlock(true));
        drawEditor();
        bottom();
        break;
      case 'add-step': {
        const last = b.steps[b.steps.length - 1];
        b.steps.push(last ? { ...clone(last), id: uid() } : newStep('run'));
        drawEditor();
        break;
      }
      case 'del-step':
        b.steps.splice(si, 1);
        drawEditor();
        break;
      case 'rkind': {
        const st = b.steps[si];
        st.kind = el.dataset.k;
        if (st.kind === 'rest') st.by = 'time';
        drawEditor();
        break;
      }
      case 'rby':
        b.steps[si].by = el.dataset.k;
        drawEditor();
        break;
      case 'del-block':
        if (((b.items || []).length || (b.steps || []).length) && !confirm('Supprimer ce bloc ?')) return;
        draft.blocks.splice(bi, 1);
        drawEditor();
        break;
      case 'dup-block': {
        const c = clone(b);
        c.id = uid();
        (c.items || []).forEach((it) => { it.id = uid(); });
        (c.steps || []).forEach((st) => { st.id = uid(); });
        draft.blocks.splice(bi + 1, 0, c);
        drawEditor();
        break;
      }
      case 'format':
        b.format = el.dataset.f;
        drawEditor();
        break;
      case 'mode': {
        setPath(draft, `${el.dataset.path}.mode`, el.dataset.mode);
        drawEditor();
        break;
      }
      case 'pick-ex':
        openExercisePicker((ex) => {
          const it = b.items[ii];
          const keepPerSet = b.type === 'sets' && b.variable;
          Object.assign(it, { exerciseId: ex.id, name: ex.name, icon: ex.icon, mode: ex.mode || it.mode, value: Number(ex.value) || it.value, load: Number(ex.load) || 0 });
          if (keepPerSet) { it.perSet = []; syncPerSet(b); }
          drawEditor();
        });
        break;
      case 'add-item':
        openExercisePicker((ex) => {
          b.items.push(newItem(ex));
          drawEditor();
        });
        break;
      case 'del-item':
        b.items.splice(ii, 1);
        drawEditor();
        break;
      default:
    }
  });

  makeSortable($('#blocks'), (from, to) => {
    moveInArray(draft.blocks, from, to);
    drawEditor();
  });
  $$('[data-items]', root).forEach((el) => {
    const bi = +el.dataset.items;
    makeSortable(el, (from, to) => {
      moveInArray(draft.blocks[bi].items, from, to);
      drawEditor();
    });
  });
  $$('[data-steps]', root).forEach((el) => {
    const bi = +el.dataset.steps;
    makeSortable(el, (from, to) => {
      moveInArray(draft.blocks[bi].steps, from, to);
      drawEditor();
    });
  });
}

function goBackFromEditor() {
  const target = prevHash && !prevHash.startsWith('#/seance/') ? prevHash : '#/seances';
  location.hash = target;
}

function saveDraft() {
  draft.name = (draft.name || '').trim();
  if (!draft.name) {
    toast('Donnez un nom à la séance');
    $('#ed .title-input')?.focus();
    return;
  }
  const cat = catOf(draft);
  if (draft.blocks.some((b) => b.type === 'run') && cat !== 'running') {
    toast('Les étapes running ne vont que dans une séance Running');
    return;
  }
  if (cat === 'running') {
    if (draft.blocks.some((b) => b.type !== 'run')) { toast('Une séance Running ne contient que des étapes et des boucles'); return; }
    if (draft.blocks.some((b) => !(b.steps || []).length)) { toast('Une boucle ne contient aucune étape'); return; }
    const bad = draft.blocks.some((b) => b.steps.some((st) => {
      const v = stepValues(st);
      return v.by === 'distance' ? !v.distance : !v.time;
    }));
    if (bad) { toast('Une étape n’a ni distance ni durée'); return; }
  } else {
    const emptyWod = draft.blocks.find((b) => b.type === 'wod' && !b.items.length);
    if (emptyWod) {
      toast(cat === 'muscu' ? 'Une boucle ne contient aucun exercice' : 'Un WOD ne contient aucun exercice');
      return;
    }
  }
  for (const b of draft.blocks) if (b.type === 'sets' && b.variable) syncPerSet(b);
  draft.cat = cat;
  draft.tag = CATS[cat].label;
  const s = clone(draft);
  delete s.deleted;
  S.saveSession(s);
  draftOrig = JSON.stringify(draft);
  if (draftPlanDate) {
    S.addPlan(draftPlanDate, s.id);
    toast(`Séance enregistrée et planifiée le ${fmtDateLong(draftPlanDate)}`);
    location.hash = `#/planning?w=${draftPlanDate}`;
    return;
  }
  toast('Séance enregistrée');
  goBackFromEditor();
}

function openFormatPicker(onPick) {
  openModal(`${modalHead('Type de WOD')}
    <div class="format-grid">${Object.entries(FORMATS).map(([k, v]) => `<button data-f="${k}"><b>${v.label.toUpperCase()}</b><span>${v.hint}</span></button>`).join('')}</div>`, (m, close) => {
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      close();
      onPick(b.dataset.f);
    });
  });
}

// ================================================================= BIBLIOTHÈQUE D'EXERCICES
function openExercisePicker(onPick) {
  openModal(`${modalHead('Choisir un exercice')}
    <div class="search">${I.search}<input data-q placeholder="Rechercher ou créer…" autocomplete="off"></div>
    <div class="pick-list" data-list style="margin-top:8px"></div>`, (m, close) => {
    const input = $('[data-q]', m);
    const list = $('[data-list]', m);
    const draw = () => {
      const raw = input.value.trim();
      const q = raw.toLowerCase();
      const items = S.listExercises().filter((e) => e.name.toLowerCase().includes(q));
      const exact = items.some((e) => e.name.toLowerCase() === q);
      list.innerHTML = items.map((e) => `<button class="pick-row" data-id="${e.id}"><span class="ex-visual">${visual(e)}</span><span class="grow"><div class="nm">${esc(e.name)}</div><div class="small muted">${esc(defaultText(e))}</div></span></button>`).join('')
        + (!exact ? `<button class="pick-row" data-create><span class="ex-visual">${I.plus}</span><span class="nm">${raw ? `Créer « ${esc(raw)} »` : 'Nouvel exercice'}</span></button>` : '');
    };
    draw();
    input.addEventListener('input', draw);
    if (finePointer()) input.focus();
    list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) {
        close();
        onPick(S.getExercise(row.dataset.id));
        return;
      }
      if (e.target.closest('[data-create]')) {
        openExerciseEditor(null, { name: input.value.trim() }, (saved) => {
          close();
          onPick(saved);
        });
      }
    });
  });
}

async function compressImage(file, size = 256) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.75);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function openExerciseEditor(id, preset = {}, onSaved) {
  const ex = id ? clone(S.getExercise(id)) : { id: uid(), name: preset.name || '', icon: '\u{1F3CB}️', image: '', mode: 'reps', value: 10, load: 0, note: '' };
  if (!ex) return;
  openModal(`${modalHead(id ? 'Modifier l’exercice' : 'Nouvel exercice')}
    <div class="stack">
      <label class="field">Nom<input data-f="name" value="${esc(ex.name)}" placeholder="ex : Wall Balls" autocomplete="off"></label>
      <div>
        <div class="kicker" style="margin-bottom:6px">Symbole</div>
        <div class="icon-grid">${ICONS.map((i) => `<button type="button" data-icon="${i}" class="${i === ex.icon ? 'on' : ''}">${i}</button>`).join('')}</div>
      </div>
      <div class="row">
        <span class="ex-visual" data-preview></span>
        <label class="btn btn-sm">\u{1F4F7} Photo (optionnel)<input type="file" accept="image/*" hidden data-photo></label>
        <button type="button" class="btn btn-sm btn-ghost" data-rmphoto>Retirer la photo</button>
      </div>
      <div><div class="kicker" style="margin-bottom:6px">Type par défaut</div><div class="seg" data-modes>${Object.entries(MODES).map(([k, m]) => `<button type="button" data-mode="${k}" class="${ex.mode === k ? 'on' : ''}">${m.label}</button>`).join('')}</div></div>
      <div class="grid-2">
        <label class="field"><span data-vlabel>Valeur par défaut</span><div class="input-unit"><input type="number" inputmode="decimal" step="any" data-f="value" value="${ex.value}"><span class="unit" data-unit></span></div></label>
        <label class="field">Charge par défaut<div class="input-unit"><input type="number" inputmode="decimal" step="any" data-f="load" value="${ex.load}"><span class="unit">kg</span></div></label>
      </div>
      <label class="field">Note<input data-f="note" value="${esc(ex.note || '')}" placeholder="ex : charge par main"></label>
      <div class="row between" style="margin-top:6px">
        ${id ? `<button type="button" class="btn btn-sm btn-danger" data-del>${I.trash} Supprimer</button>` : '<span></span>'}
        <button type="button" class="btn btn-primary" data-save>Enregistrer</button>
      </div>
    </div>`, (m, close) => {
    const refresh = () => {
      $('[data-preview]', m).innerHTML = ex.image ? `<img src="${ex.image}" alt="">` : esc(ex.icon);
      $('[data-rmphoto]', m).classList.toggle('hidden', !ex.image);
      $('[data-unit]', m).textContent = MODES[ex.mode].unit;
      $$('[data-mode]', m).forEach((b) => b.classList.toggle('on', b.dataset.mode === ex.mode));
    };
    refresh();
    if (finePointer() && !id) $('[data-f="name"]', m).focus();
    m.addEventListener('click', (e) => {
      const ic = e.target.closest('[data-icon]');
      if (ic) {
        ex.icon = ic.dataset.icon;
        $$('[data-icon]', m).forEach((b) => b.classList.toggle('on', b === ic));
        refresh();
      }
      const md = e.target.closest('[data-mode]');
      if (md) { ex.mode = md.dataset.mode; refresh(); }
      if (e.target.closest('[data-rmphoto]')) { ex.image = ''; refresh(); }
      if (e.target.closest('[data-del]')) {
        if (confirm(`Supprimer « ${ex.name} » de la bibliothèque commune (pour tout le monde) ?\nLes séances qui l'utilisent gardent son nom.`)) {
          S.deleteExercise(ex.id);
          close();
          toast('Exercice supprimé');
        }
      }
      if (e.target.closest('[data-save]')) {
        ex.name = $('[data-f="name"]', m).value.trim();
        if (!ex.name) { toast('Donnez un nom à l’exercice'); return; }
        ex.value = num($('[data-f="value"]', m).value, 0);
        ex.load = num($('[data-f="load"]', m).value, 0);
        ex.note = $('[data-f="note"]', m).value.trim();
        delete ex.deleted;
        S.saveExercise(ex);
        close();
        toast('Exercice enregistré');
        onSaved?.(S.getExercise(ex.id));
      }
    });
    $('[data-photo]', m).addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        ex.image = await compressImage(f);
        refresh();
      } catch {
        toast('Image illisible');
      }
    });
  });
}

function renderExercises() {
  view.innerHTML = `<div id="ex">
    <div class="page-head">
      <div><div class="kicker">Bibliothèque commune</div><h1 class="display" style="font-size:clamp(48px,12vw,84px)">Exercices</h1></div>
      <button class="btn btn-primary" data-a="new">${I.plus} Nouvel exercice</button>
    </div>
    <div class="search" style="margin:12px 0">${I.search}<input data-q placeholder="Rechercher"></div>
    <div class="ex-grid" data-list></div>
  </div>`;
  const root = $('#ex');
  const list = $('[data-list]', root);
  const input = $('[data-q]', root);
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const items = S.listExercises().filter((e) => e.name.toLowerCase().includes(q));
    list.innerHTML = items.map((e) => `<button class="ex-card" data-id="${e.id}"><span class="ex-visual">${visual(e)}</span><span class="ex-name">${esc(e.name)}</span><span class="ex-def">${esc(defaultText(e))}</span>${e.note ? `<span class="ex-def">${esc(e.note)}</span>` : ''}</button>`).join('')
      || '<div class="empty">Aucun exercice trouvé.</div>';
  };
  draw();
  input.addEventListener('input', draw);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-a="new"]')) openExerciseEditor(null);
    const c = e.target.closest('[data-id]');
    if (c) openExerciseEditor(c.dataset.id);
  });
}

// ================================================================= CONNEXION
function renderLogin() {
  $$('#tabs a').forEach((a) => a.classList.remove('active'));
  let mode = 'in';
  let newTeam = false;
  const draw = () => {
    view.innerHTML = `<div id="lg" class="login">
      <div class="outline login-big">TC</div>
      <div class="kicker">The Coach</div>
      <h1 class="title-caps" style="font-size:22px;margin:4px 0 14px">${mode === 'in' ? 'Connexion' : 'Créer un compte'}</h1>
      <div class="seg" style="margin-bottom:16px"><button data-mode="in" class="${mode === 'in' ? 'on' : ''}">Se connecter</button><button data-mode="up" class="${mode === 'up' ? 'on' : ''}">Créer un compte</button></div>
      <form class="stack" data-form autocomplete="on">
        <label class="field">Nom d'utilisateur<input name="user" autocomplete="username" autocapitalize="off" spellcheck="false" required placeholder="ex : arthur"></label>
        <label class="field">Code à 4 chiffres<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" required placeholder="••••"></label>
        ${mode === 'up' ? `
          <label class="field">Confirmer le code<input name="pin2" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="new-password" required placeholder="••••"></label>
          <label class="field">Prénom (sur les affiches)<input name="first" autocomplete="given-name" placeholder="ex : Arthur"></label>
          <label class="switch"><input type="checkbox" data-newteam ${newTeam ? 'checked' : ''}><span class="track"></span>Je crée une nouvelle équipe</label>
          ${newTeam
    ? '<p class="small muted">Un code d’équipe sera créé. Tu le trouveras dans Réglages pour inviter tes amis.</p>'
    : `<label class="field">Code d'équipe (invitation)<input name="team" autocapitalize="off" spellcheck="false" placeholder="coach-xxxx-xxxx-xxxx" value="${esc(S.db.settings.teamCode || '')}"></label>
             <p class="small muted">Demande-le à la personne qui t’a invité (Réglages → Équipe). Il donne accès aux bibliothèques communes.</p>`}` : ''}
        <p class="small login-err" data-err></p>
        <button class="btn btn-primary btn-block" type="submit" data-submit>${mode === 'in' ? 'Se connecter' : 'Créer mon compte'}</button>
      </form>
      <p class="small muted" style="margin-top:16px">${mode === 'in'
    ? 'Le même compte sur tous tes appareils : ton planning et tes résultats te suivent. Code oublié ? Demande à l’administrateur de supprimer ton compte, puis recrée-le avec le même nom : tes données sont conservées.'
    : 'Le nom d’utilisateur est unique. Ton planning et tes résultats ne sont visibles que par toi ; seules les bibliothèques d’exercices et de séances sont communes à l’équipe.'}</p>
    </div>`;
    const root = $('#lg');
    root.addEventListener('click', (e) => {
      const m = e.target.closest('[data-mode]');
      if (m && m.dataset.mode !== mode) { mode = m.dataset.mode; draw(); }
    });
    $('[data-newteam]', root)?.addEventListener('change', (e) => { newTeam = e.target.checked; draw(); });
    $('[data-form]', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const err = $('[data-err]', root);
      const btn = $('[data-submit]', root);
      const user = String(f.get('user') || '');
      const pin = String(f.get('pin') || '');
      err.textContent = '';
      if (mode === 'up' && pin !== String(f.get('pin2') || '')) { err.textContent = 'Les deux codes ne correspondent pas.'; return; }
      if (mode === 'up' && !newTeam && !String(f.get('team') || '').trim()) { err.textContent = 'Saisis le code d’équipe, ou coche « Je crée une nouvelle équipe ».'; return; }
      btn.disabled = true;
      btn.textContent = 'Connexion…';
      try {
        if (mode === 'in') await Sync.signIn(user, pin);
        else await Sync.signUp(user, pin, newTeam ? '' : String(f.get('team') || ''), String(f.get('first') || '').trim());
        toast(`Bienvenue ${S.db.settings.name || S.db.account.username} !`);
        location.hash = '#/planning';
        render();
      } catch (ex) {
        console.error(ex);
        err.textContent = Sync.errorText(ex);
        btn.disabled = false;
        btn.textContent = mode === 'in' ? 'Se connecter' : 'Créer mon compte';
      }
    });
  };
  draw();
}

// ================================================================= RÉGLAGES
const SYNC_TEXT = {
  off: 'Synchronisation désactivée',
  connecting: 'Connexion…',
  online: 'Synchronisé ✔',
  offline: 'Hors ligne : les modifications seront envoyées au retour du réseau',
  error: 'Erreur de synchronisation',
};

function renderSettings() {
  const st = S.db.settings;
  const acc = S.db.account;
  view.innerHTML = `<div id="rg">
    <div class="page-head"><div><div class="kicker">The Coach</div><h1 class="display" style="font-size:clamp(48px,12vw,84px)">Réglages</h1></div></div>

    ${acc ? `<div class="section">
      <h3>Mon compte</h3>
      <div class="row"><span class="sync-dot" data-dot></span><span class="small">Connecté en tant que <b>${esc(acc.username)}</b> · <span data-status></span></span></div>
      <div class="row">
        <button class="btn btn-sm" data-a="pin">Changer mon code</button>
        <span class="grow"></span>
        <button class="btn btn-sm btn-danger" data-a="logout">Se déconnecter</button>
      </div>
      <p class="small muted">Ton planning, ton profil et tes résultats sont enregistrés dans ton compte et visibles par toi seul, sur tous tes appareils.</p>
    </div>` : ''}

    <div class="section">
      <h3>Profil &amp; objectif</h3>
      <label class="field">Prénom (affiché sur les affiches)<input data-s="name" value="${esc(st.name)}" placeholder="ex : Arthur" autocomplete="given-name"></label>
      <div class="grid-2">
        <label class="field">Course<input data-s="hyroxName" value="${esc(st.hyroxName)}" placeholder="ex : Hyrox Paris"></label>
        <label class="field">Date<input type="date" data-s="hyroxDate" value="${esc(st.hyroxDate)}"></label>
      </div>
      <p class="small muted" data-cd></p>
    </div>

    <div class="section">
      <h3>Mode séance</h3>
      <label class="switch"><input type="checkbox" data-voice ${st.voice !== false ? 'checked' : ''}><span class="track"></span>Annonces vocales (Hyrox et running)</label>
      <div class="row"><button class="btn btn-sm" data-a="test-voice">Tester la voix</button></div>
      <p class="small muted">Au début de chaque étape, le téléphone annonce l’exercice, sa quantité et la charge ou l’allure, ainsi que les repos. Les bips des 5 dernières secondes restent. Réglage propre à cet appareil.${Voice.isSupported() ? '' : ' <b>Ce navigateur ne permet pas la synthèse vocale.</b>'}</p>
    </div>

    ${acc ? `<div class="section">
      <h3>Équipe (bibliothèques communes)</h3>
      <label class="field">Code d'équipe — à donner à tes amis pour qu'ils créent leur compte<input data-team value="${esc(acc.teamCode)}" readonly></label>
      <div class="row"><button class="btn btn-sm" data-a="copy">${I.copy} Copier le code</button></div>
      <p class="small muted">Lien de l'application + ce code = accès aux exercices et séances communs. Le code d'équipe ne donne pas accès à ton planning ni à tes résultats.</p>
    </div>` : `<div class="section"><h3>Synchronisation</h3><p class="small muted">Firebase n’est pas configuré (fichier <span class="code">firebase-config.js</span>, voir <span class="code">README.md</span>) : l’application fonctionne en local sur cet appareil.</p></div>`}

    <div class="section">
      <h3>Partage par fichier</h3>
      <p class="small muted">Exportez les bibliothèques (WhatsApp, e-mail…) ou faites une sauvegarde complète. À l'import, les éléments sont fusionnés sans doublon : la version la plus récente gagne.</p>
      <div class="row">
        <button class="btn btn-sm" data-a="export-lib">${I.share} Exporter les bibliothèques</button>
        <button class="btn btn-sm" data-a="export-all">${I.download} Sauvegarde complète (planning + résultats)</button>
        <label class="btn btn-sm">${I.download} Importer un fichier<input type="file" accept=".json,application/json" hidden data-import></label>
      </div>
    </div>

    <div class="section">
      <h3>Installer l'application</h3>
      <p class="small"><b>iPhone :</b> ouvrir le lien dans Safari → bouton Partager → « Sur l'écran d'accueil ».<br>
      <b>PC :</b> dans Edge ou Chrome, icône « Installer » dans la barre d'adresse (ou menu … → Applications → Installer).<br>
      L'application fonctionne ensuite hors connexion.</p>
    </div>

    <div class="section">
      <h3>Zone sensible</h3>
      <div class="row"><button class="btn btn-sm btn-danger" data-a="reset">Effacer cet appareil</button></div>
      <p class="small muted">Efface toutes les données enregistrées sur cet appareil${acc ? ' et te déconnecte. Ton compte en ligne (planning, résultats) n’est pas touché' : ''}.</p>
    </div>
  </div>`;

  const root = $('#rg');
  const drawStatus = () => {
    const dot = $('[data-dot]', root);
    if (dot) {
      dot.className = `sync-dot ${Sync.syncState.status}`;
      $('[data-status]', root).textContent = SYNC_TEXT[Sync.syncState.status] + (Sync.syncState.message && Sync.syncState.status === 'error' ? ` : ${Sync.syncState.message}` : '');
    }
    const d = daysUntil(S.db.settings.hyroxDate);
    $('[data-cd]', root).textContent = d == null ? '' : d > 0 ? `Plus que ${d} jour${d > 1 ? 's' : ''} !` : d === 0 ? 'C’est aujourd’hui !' : 'Course passée.';
  };
  drawStatus();
  const off = Sync.onSyncChange(() => { if (!document.body.contains(root)) off(); else drawStatus(); });

  $$('[data-s]', root).forEach((inp) => inp.addEventListener('change', () => {
    S.saveSettings({ [inp.dataset.s]: inp.value.trim() });
    drawStatus();
    toast('Enregistré');
  }));
  $('[data-voice]', root).addEventListener('change', (e) => {
    S.saveSettings({ voice: e.target.checked });
    toast(e.target.checked ? 'Annonces vocales activées' : 'Annonces vocales coupées');
  });
  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'test-voice') Voice.say('Run, 400 mètres, allure 3 minutes 45 au kilomètre.');
    if (a === 'copy') {
      const team = $('[data-team]', root);
      try { await navigator.clipboard.writeText(team.value); toast('Code copié'); } catch { team.select(); }
    }
    if (a === 'pin') openChangePin();
    if (a === 'logout' && confirm('Se déconnecter ? Ton planning et tes résultats restent dans ton compte.')) {
      await Sync.signOut();
      toast('Déconnecté');
    }
    if (a === 'export-lib' || a === 'export-all') {
      const all = a === 'export-all';
      const data = S.exportData({ includePlan: all });
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const who = (S.db.settings.name || acc?.username || 'coach').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const name = `the-coach-${all ? 'sauvegarde' : 'bibliotheques'}-${who}-${todayYmd()}.json`;
      if (all) download(blob, name);
      else shareOrDownload(blob, name, 'Bibliothèques The Coach');
    }
    if (a === 'reset') {
      if (confirm('Effacer TOUTES les données de cet appareil ? Cette action est définitive.') && confirm('Vraiment sûr ?')) {
        if (acc) await Sync.signOut();
        S.resetAll();
        location.hash = '#/planning';
        location.reload();
      }
    }
  });
  $('[data-import]', root).addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const res = S.importData(JSON.parse(await f.text()));
      toast(`Importé : ${res.exercises} exercice(s), ${res.sessions} séance(s)${res.plan ? `, ${res.plan} entrée(s) de planning` : ''}${res.results ? `, ${res.results} résultat(s)` : ''}`);
    } catch (err) {
      alert(err.message || 'Fichier illisible');
    }
    e.target.value = '';
  });
}

function openChangePin() {
  openModal(`${modalHead('Changer mon code')}
    <form class="stack" data-form>
      <label class="field">Code actuel<input name="old" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="current-password" required></label>
      <label class="field">Nouveau code<input name="n1" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="new-password" required></label>
      <label class="field">Confirmer le nouveau code<input name="n2" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="new-password" required></label>
      <p class="small login-err" data-err></p>
      <button class="btn btn-primary" type="submit">Changer le code</button>
    </form>`, (m, close) => {
    $('[data-form]', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const err = $('[data-err]', m);
      if (f.get('n1') !== f.get('n2')) { err.textContent = 'Les deux nouveaux codes ne correspondent pas.'; return; }
      try {
        await Sync.changePin(String(f.get('old')), String(f.get('n1')));
        close();
        toast('Code modifié');
      } catch (ex) {
        err.textContent = Sync.errorText(ex);
      }
    });
  });
}

// ================================================================= Démarrage
function boot() {
  S.load();
  Sync.onSyncChange((st) => {
    const dot = $('#sync-dot');
    dot.className = `sync-dot ${st.status}`;
    dot.title = SYNC_TEXT[st.status];
    dot.classList.toggle('hidden', st.status === 'off');
  });
  $('#sync-dot').classList.add('hidden');
  render();
  Sync.resume(() => {
    // Session Firebase expirée ou compte supprimé : retour à l'écran de connexion.
    S.clearAccount();
    toast('Reconnecte-toi');
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
}
boot();
