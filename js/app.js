// THE COACH — application principale (routes, vues, modales).
import {
  uid, esc, clone, MODES, DAYS_SHORT, MONTHS_SHORT, ymd, parseYmd, todayYmd, addDays, mondayOf, isoWeek,
  daysUntil, fmtDateLong, fmtShortTime, num,
} from './utils.js';
import * as S from './store.js';
import { FORMATS, itemParts, blockHeader, blockCap, blockRestInfo, sessionSummary } from './format.js';
import { ICONS } from './seed.js';
import { makeSortable, moveInArray } from './dnd.js';
import { startSync, onSyncChange, syncState, isConfigured, generateTeamCode } from './sync.js';
import { openPlayer } from './player.js';
import { renderWeekPoster, canvasToPdfBlob } from './poster.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

// ---------------------------------------------------------------- Icônes
const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  chevL: svg('<path d="M15 18l-6-6 6-6"/>'),
  chevR: svg('<path d="M9 18l6-6-6-6"/>'),
  grip: svg('<circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>'),
  play: svg('<path d="M7 4l13 8-13 8z" fill="currentColor"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  share: svg('<path d="M12 3v13M7 8l5-5 5 5M5 14v6h14v-6"/>'),
  download: svg('<path d="M12 3v13M7 11l5 5 5-5M5 21h14"/>'),
  edit: svg('<path d="M4 20h4L20 8l-4-4L4 16z"/>'),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
};

// ---------------------------------------------------------------- Petits utilitaires d'interface
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

function openModal(html, onMount) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  root.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const close = () => {
    wrap.remove();
    if (!root.children.length) document.body.style.overflow = '';
  };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  onMount?.(wrap.querySelector('.modal'), close);
  return close;
}
const modalHead = (title) =>
  `<div class="modal-head"><h2>${title}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="Fermer">${I.close}</button></div>`;

const finePointer = () => matchMedia('(pointer: fine)').matches;

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}
const canShareFile = (file) => !!(navigator.canShare && navigator.canShare({ files: [file] }));
async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  download(blob, filename);
}

function visual(o) {
  const ex = o?.exerciseId ? S.getExercise(o.exerciseId) : o;
  if (ex?.image) return `<img src="${ex.image}" alt="">`;
  return esc(o?.icon || ex?.icon || '\u{1F3CB}️');
}
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
    <div class="kicker">${esc(s.tag || 'Séance')}</div>
    <h1 class="title-caps" style="font-size:26px;letter-spacing:.08em;margin-top:4px">${esc(s.name || 'Sans nom')}</h1>
    <hr class="rule">
    ${blocks || '<p class="muted">Séance vide.</p>'}
    ${s.notes ? `<p class="small" style="white-space:pre-wrap">${esc(s.notes)}</p>` : ''}`;
}
function visualSmall(it) {
  const ex = S.getExercise(it.exerciseId);
  if (ex?.image) return `<img src="${ex.image}" alt="" style="width:24px;height:24px;border-radius:6px;object-fit:cover;vertical-align:middle">`;
  return esc(it.icon || ex?.icon || '');
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
  reglages: renderSettings,
};

function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  current = parseHash();
  const fn = routes[current.name] || renderPlanning;
  const tab = current.name === 'seance' ? 'seances' : current.name;
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

S.subscribe(() => {
  updateTopbar();
  if (!current || current.name === 'seance' || current.name === 'reglages') return;
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
      const icons = [...new Set((session.blocks || []).flatMap((b) => (b.items || []).map((it) => it.icon)).filter(Boolean))].slice(0, 4).join('');
      return `<button class="entry" data-entry="${e.id}"><span class="icons">${esc(icons)}</span><span class="etext"><div class="ename">${esc(session.name)}</div><div class="esum">${esc(sessionSummary(session))}</div></span><span class="chev">${I.chevR}</span></button>`;
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

function openPlanDetail(entryId) {
  const e = S.db.plan.find((p) => p.id === entryId);
  if (!e) return;
  const { session, live, orphan } = S.planSession(e);
  openModal(`${modalHead(esc(fmtDateLong(e.date)))}
    ${sessionDetailHtml(session)}
    ${!live ? `<p class="small muted">${orphan ? 'Cette séance a été supprimée de la bibliothèque. ' : ''}Version figée de la séance (les modifications de la bibliothèque ne s’appliquent qu’aux séances à venir).</p>` : ''}
    <div class="stack" style="margin-top:14px">
      <button class="btn btn-primary btn-block" data-a="play">${I.play} Lancer la séance</button>
      <label class="field">Déplacer au<input type="date" data-a="move" value="${e.date}"></label>
      <div class="row between">
        ${live ? `<button class="btn btn-sm" data-a="edit">${I.edit} Modifier la séance</button>` : '<span></span>'}
        <button class="btn btn-sm btn-danger" data-a="remove">${I.trash} Retirer du planning</button>
      </div>
    </div>`, (m, close) => {
    m.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-a]')?.dataset.a;
      if (a === 'play') { close(); openPlayer(session); }
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
    <div class="pick-list" data-list style="margin-top:8px"></div>
    <button class="btn btn-block" data-new style="margin-top:12px">${I.plus} Créer une nouvelle séance</button>`, (m, close) => {
    const input = $('[data-q]', m);
    const list = $('[data-list]', m);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const items = S.listSessions().filter((s) => (s.name + ' ' + (s.tag || '')).toLowerCase().includes(q));
      list.innerHTML = items.map((s) => `<button class="pick-row" data-id="${s.id}"><span class="grow"><div class="nm">${esc(s.name)}</div><div class="small muted">${esc(s.tag ? s.tag + ' · ' : '')}${esc(sessionSummary(s))}</div></span><span class="chev">${I.plus}</span></button>`).join('')
        || '<div class="empty small">Aucune séance dans la bibliothèque.</div>';
    };
    draw();
    input.addEventListener('input', draw);
    if (finePointer()) input.focus();
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
    <div class="search" style="margin:12px 0">${I.search}<input data-q placeholder="Rechercher (nom, catégorie)"></div>
    <div class="list" data-list></div>
  </div>`;
  const root = $('#se');
  const list = $('[data-list]', root);
  const input = $('[data-q]', root);
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const items = S.listSessions().filter((s) => (s.name + ' ' + (s.tag || '')).toLowerCase().includes(q));
    list.innerHTML = items.map((s, i) => `<div class="list-item" data-id="${s.id}">
        <span class="idx">${String(i + 1).padStart(2, '0')}</span>
        <div class="grow"><div class="li-title">${esc(s.name)}</div><div class="li-sub">${s.tag ? `<b>${esc(s.tag)}</b> · ` : ''}${esc(sessionSummary(s))}</div>
        ${s.updatedBy ? `<div class="small muted">Modifiée par ${esc(s.updatedBy)}</div>` : ''}</div>
        <span class="chev">${I.chevR}</span></div>`).join('')
      || `<div class="empty"><span class="outline">00</span>Aucune séance. Créez la première !</div>`;
  };
  draw();
  input.addEventListener('input', draw);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-a="new"]')) location.hash = '#/seance/new';
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
      if (a === 'play') { close(); openPlayer(resolved); }
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
        c.blocks.forEach((b) => { b.id = uid(); b.items.forEach((it) => { it.id = uid(); }); });
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
    draft = { id: uid(), name: '', tag: '', notes: '', blocks: [] };
  } else {
    const s = S.getSession(id);
    if (!s) {
      view.innerHTML = `<div class="empty">Séance introuvable.<br><br><a class="btn" href="#/seances">Retour</a></div>`;
      draft = null;
      return;
    }
    draft = clone(s);
  }
  draftOrig = JSON.stringify(draft);
  draftPlanDate = r.params.get('plan') || '';
  drawEditor();
}

function numField(label, path, value, unit, { rerender = false, min = 0 } = {}) {
  return `<label class="field">${label}<div class="input-unit"><input type="number" inputmode="decimal" min="${min}" step="any" data-bind="${path}" data-num ${rerender ? 'data-rerender' : ''} value="${value ?? ''}"><span class="unit">${unit}</span></div></label>`;
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

function wodBody(b, bi) {
  const f = b.format;
  const params = [];
  if (f === 'rounds' || f === 'fortime') {
    params.push(numField('Tours', `blocks.${bi}.rounds`, b.rounds, '', { min: 1 }));
    params.push(numField('Time cap', `blocks.${bi}.timeCap`, b.timeCap, 'min'));
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
  return `
    <div class="seg">${Object.entries(FORMATS).map(([k, v]) => `<button type="button" data-a="format" data-b="${bi}" data-f="${k}" class="${k === f ? 'on' : ''}">${v.label}</button>`).join('')}</div>
    <div class="small muted" style="margin-top:6px">${FORMATS[f]?.hint || ''}</div>
    <div class="block-params">${params.join('')}</div>
    <div data-items="${bi}">${items}</div>
    ${b.items.length ? '' : '<div class="small muted" style="margin:6px 0">Ajoutez les exercices de la boucle.</div>'}
    <button type="button" class="btn btn-sm" data-a="add-item" data-b="${bi}">${I.plus} Ajouter un exercice</button>`;
}

function drawEditor() {
  const y = window.scrollY;
  const isNew = !S.getSession(draft.id);
  const tags = [...new Set(['Hyrox', 'Running', 'Force', 'Cardio', 'Mobilité', ...S.listSessions().map((s) => s.tag).filter(Boolean)])];
  const blocks = draft.blocks.map((b, bi) => `
    <div class="block" data-sort-item>
      <div class="block-top">
        <span class="handle" data-handle title="Glisser pour déplacer">${I.grip}</span>
        <span class="bt-title">${b.type === 'sets' ? 'Exercice · séries' : `WOD · ${FORMATS[b.format]?.label || ''}`}</span>
        <button type="button" class="btn btn-icon btn-ghost" data-a="dup-block" data-b="${bi}" aria-label="Dupliquer">${I.copy}</button>
        <button type="button" class="btn btn-icon btn-ghost" data-a="del-block" data-b="${bi}" aria-label="Supprimer">${I.trash}</button>
      </div>
      ${b.type === 'sets' ? setsBody(b, bi) : wodBody(b, bi)}
    </div>`).join('');

  view.innerHTML = `<div id="ed">
    <div class="row between" style="margin-bottom:10px"><button type="button" class="btn btn-ghost btn-sm" data-a="cancel">${I.chevL} Retour</button><span class="kicker">${isNew ? 'Nouvelle séance' : 'Modifier la séance'}</span></div>
    <div class="editor-head">
      <input class="title-input" data-bind="name" placeholder="NOM DE LA SÉANCE" value="${esc(draft.name)}" autocomplete="off">
      <div class="grid-2">
        <label class="field">Catégorie<input data-bind="tag" list="tag-list" value="${esc(draft.tag || '')}" placeholder="Hyrox, Running…"></label>
        <span></span>
      </div>
      <label class="field">Notes<textarea data-bind="notes" placeholder="Consignes, objectifs…">${esc(draft.notes || '')}</textarea></label>
      <datalist id="tag-list">${tags.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
    </div>
    <div id="blocks">${blocks}</div>
    ${draft.blocks.length ? '' : '<div class="empty small">Ajoutez un exercice (avec ses séries) ou un WOD (boucle de plusieurs exercices).</div>'}
    <div class="add-bar">
      <button type="button" class="btn" data-a="add-sets">${I.plus} Exercice (séries)</button>
      <button type="button" class="btn" data-a="add-wod">${I.plus} WOD (boucle)</button>
    </div>
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
    setPath(draft, t.dataset.bind, t.hasAttribute('data-num') ? num(t.value, 0) : t.value);
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
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
    const b = draft.blocks[bi];
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
          window.scrollTo(0, document.body.scrollHeight);
        });
        break;
      case 'add-wod':
        openFormatPicker((f) => {
          draft.blocks.push(newWodBlock(f));
          drawEditor();
          window.scrollTo(0, document.body.scrollHeight);
        });
        break;
      case 'del-block':
        if (b.items.length && !confirm('Supprimer ce bloc ?')) return;
        draft.blocks.splice(bi, 1);
        drawEditor();
        break;
      case 'dup-block': {
        const c = clone(b);
        c.id = uid();
        c.items.forEach((it) => { it.id = uid(); });
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
  const emptyWod = draft.blocks.find((b) => !b.items.length);
  if (emptyWod) {
    toast('Un WOD ne contient aucun exercice');
    return;
  }
  for (const b of draft.blocks) if (b.type === 'sets' && b.variable) syncPerSet(b);
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
  view.innerHTML = `<div id="rg">
    <div class="page-head"><div><div class="kicker">The Coach</div><h1 class="display" style="font-size:clamp(48px,12vw,84px)">Réglages</h1></div></div>

    <div class="section">
      <h3>Profil &amp; objectif</h3>
      <label class="field">Prénom (affiché sur l'affiche)<input data-s="name" value="${esc(st.name)}" placeholder="ex : Arthur" autocomplete="given-name"></label>
      <div class="grid-2">
        <label class="field">Course<input data-s="hyroxName" value="${esc(st.hyroxName)}" placeholder="ex : Hyrox Paris"></label>
        <label class="field">Date<input type="date" data-s="hyroxDate" value="${esc(st.hyroxDate)}"></label>
      </div>
      <p class="small muted" data-cd></p>
    </div>

    <div class="section">
      <h3>Bibliothèques communes (synchro en ligne)</h3>
      <div class="row"><span class="sync-dot" data-dot></span><span data-status class="small"></span></div>
      ${isConfigured() ? '' : '<p class="small muted">Firebase n’est pas encore configuré (fichier <span class="code">firebase-config.js</span>, voir le guide <span class="code">README.md</span>). En attendant, utilisez l’export / import de fichier ci-dessous.</p>'}
      <label class="field">Code d'équipe (le même pour vous 3)<input data-team value="${esc(st.teamCode)}" placeholder="coach-xxxx-xxxx-xxxx" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="row">
        <button class="btn btn-sm" data-a="gen">Générer un code</button>
        <button class="btn btn-sm" data-a="copy">${I.copy} Copier</button>
        <span class="grow"></span>
        <button class="btn btn-sm btn-primary" data-a="connect" ${isConfigured() ? '' : 'disabled'}>Connecter</button>
      </div>
      <p class="small muted">Le planning reste personnel : seules les bibliothèques d'exercices et de séances sont partagées.</p>
    </div>

    <div class="section">
      <h3>Partage par fichier</h3>
      <p class="small muted">Envoyez vos bibliothèques à vos amis (WhatsApp, e-mail…). À l'import, les éléments sont fusionnés sans doublon : la version la plus récente gagne.</p>
      <div class="row">
        <button class="btn btn-sm" data-a="export-lib">${I.share} Exporter les bibliothèques</button>
        <button class="btn btn-sm" data-a="export-all">${I.download} Sauvegarde complète (avec mon planning)</button>
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
      <div class="row"><button class="btn btn-sm btn-danger" data-a="reset">Réinitialiser cet appareil</button></div>
      <p class="small muted">Efface toutes les données locales de cet appareil (pas celles de vos amis). Faites une sauvegarde avant.</p>
    </div>
  </div>`;

  const root = $('#rg');
  const drawStatus = () => {
    const dot = $('[data-dot]', root);
    if (!dot) return;
    dot.className = `sync-dot ${syncState.status}`;
    $('[data-status]', root).textContent = SYNC_TEXT[syncState.status] + (syncState.message && syncState.status === 'error' ? ` : ${syncState.message}` : '');
    const d = daysUntil(S.db.settings.hyroxDate);
    $('[data-cd]', root).textContent = d == null ? '' : d > 0 ? `Plus que ${d} jour${d > 1 ? 's' : ''} !` : d === 0 ? 'C’est aujourd’hui !' : 'Course passée.';
  };
  drawStatus();
  const off = onSyncChange(() => { if (!document.body.contains(root)) off(); else drawStatus(); });

  $$('[data-s]', root).forEach((inp) => inp.addEventListener('change', () => {
    S.saveSettings({ [inp.dataset.s]: inp.value.trim() });
    drawStatus();
    toast('Enregistré');
  }));
  const team = $('[data-team]', root);
  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'gen') {
      if (team.value && !confirm('Remplacer le code actuel ? Vos amis devront utiliser le même.')) return;
      team.value = generateTeamCode();
    }
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(team.value); toast('Code copié'); } catch { team.select(); }
    }
    if (a === 'connect') {
      S.saveSettings({ teamCode: team.value.trim() });
      startSync();
    }
    if (a === 'export-lib' || a === 'export-all') {
      const all = a === 'export-all';
      const data = S.exportData({ includePlan: all });
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const who = (S.db.settings.name || 'coach').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const name = `the-coach-${all ? 'sauvegarde' : 'bibliotheques'}-${who}-${todayYmd()}.json`;
      if (all) download(blob, name);
      else shareOrDownload(blob, name, 'Bibliothèques The Coach');
    }
    if (a === 'reset') {
      if (confirm('Effacer TOUTES les données de cet appareil ? Cette action est définitive.') && confirm('Vraiment sûr ?')) {
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
      toast(`Importé : ${res.exercises} exercice(s), ${res.sessions} séance(s)${res.plan ? `, ${res.plan} entrée(s) de planning` : ''}`);
    } catch (err) {
      alert(err.message || 'Fichier illisible');
    }
    e.target.value = '';
  });
}

// ================================================================= Démarrage
function boot() {
  S.load();
  onSyncChange((st) => {
    const dot = $('#sync-dot');
    dot.className = `sync-dot ${st.status}`;
    dot.title = SYNC_TEXT[st.status];
    dot.classList.toggle('hidden', st.status === 'off');
  });
  $('#sync-dot').classList.add('hidden');
  render();
  startSync();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
}
boot();
