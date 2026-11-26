// Petits éléments d'interface partagés : icônes, toasts, fenêtres modales, partage de fichiers.
import { esc } from './utils.js';
import { getExercise } from './store.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
export const I = {
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
  chart: svg('<path d="M4 20V4M4 20h16M8 16l4-5 3 3 5-7"/>'),
  check: svg('<path d="M5 12l5 5L20 7"/>'),
};

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

export function openModal(html, onMount) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  root.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const close = () => {
    wrap.remove();
    if (!root.children.length && !$('#player-root').children.length) document.body.style.overflow = '';
  };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  onMount?.(wrap.querySelector('.modal'), close);
  return close;
}
export const modalHead = (title) =>
  `<div class="modal-head"><h2>${title}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="Fermer">${I.close}</button></div>`;

export const finePointer = () => matchMedia('(pointer: fine)').matches;

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}
const canShareFile = (file) => !!(navigator.canShare && navigator.canShare({ files: [file] }));
export async function shareOrDownload(blob, filename, title) {
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

/** Visuel d'un exercice (photo ou symbole), grande taille. */
export function visual(o) {
  const ex = o?.exerciseId ? getExercise(o.exerciseId) : o;
  if (ex?.image) return `<img src="${ex.image}" alt="">`;
  return esc(o?.icon || ex?.icon || '\u{1F3CB}️');
}
/** Visuel d'un exercice, petite taille (lignes de séance). */
export function visualSmall(it) {
  const ex = getExercise(it.exerciseId);
  if (ex?.image) return `<img src="${ex.image}" alt="" style="width:24px;height:24px;border-radius:6px;object-fit:cover;vertical-align:middle">`;
  return esc(it.icon || ex?.icon || '');
}
