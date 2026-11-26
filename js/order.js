// Ordre personnel des exercices d'une séance Hyrox (matériel occupé par un autre membre du groupe).
// Il s'applique à une copie de la séance : la bibliothèque ne change jamais.
// Les Runs restent à leur place : seules les stations s'échangent.
// Ordre enregistré = {blocks:[id de bloc…], items:{idBloc:[id d'exercice mobile…]}}.
import { clone, esc } from './utils.js';
import { isRunName, itemParts, blockHeader, valueShort, loadText } from './format.js';
import { makeSortable, moveInArray } from './dnd.js';
import { openModal, modalHead, I, $, $$, visualSmall } from './ui.js';

export const isLockedItem = (it) => !!it && isRunName(it.name, it.exerciseId);
export const isLockedBlock = (b) => b.type === 'sets' && isLockedItem(b.items?.[0]);
const isWod = (b) => b.type === 'wod';

/** Réordonne `list` selon `ids` (ids inconnus ignorés, éléments absents de `ids` gardés à la suite). */
function sortByIds(list, ids) {
  if (!Array.isArray(ids) || !ids.length) return list.slice();
  const pos = new Map(ids.map((id, i) => [id, i]));
  const known = list.filter((x) => pos.has(x.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
  return [...known, ...list.filter((x) => !pos.has(x.id))];
}
/** Remet les éléments mobiles (dans l'ordre donné) aux places libres ; les éléments verrouillés ne bougent pas. */
function placeMovable(list, locked, movable) {
  let k = 0;
  return list.map((x) => (locked(x) ? x : movable[k++]));
}

/** Copie de la séance dans l'ordre personnel. */
export function applyOrder(session, order) {
  const s = clone(session);
  if (!order) return s;
  const blocks = s.blocks || [];
  s.blocks = placeMovable(blocks, isLockedBlock, sortByIds(blocks.filter((b) => !isLockedBlock(b)), order.blocks));
  for (const b of s.blocks) {
    const ids = order.items?.[b.id];
    if (isWod(b) && ids && b.items?.length) {
      b.items = placeMovable(b.items, isLockedItem, sortByIds(b.items.filter((it) => !isLockedItem(it)), ids));
    }
  }
  return s;
}

/** Groupes réordonnables : la liste des blocs (si au moins 2 mobiles) et chaque WOD (si au moins 2 stations). */
function groupsOf(s) {
  const out = [];
  if ((s.blocks || []).filter((b) => !isLockedBlock(b)).length >= 2) out.push({ id: '__blocks', kind: 'blocks' });
  for (const b of s.blocks || []) {
    if (isWod(b) && (b.items || []).filter((it) => !isLockedItem(it)).length >= 2) out.push({ id: b.id, kind: 'items', block: b });
  }
  return out;
}
export const canReorder = (session) => groupsOf(session).length > 0;

function orderOf(s) {
  const o = { blocks: s.blocks.filter((b) => !isLockedBlock(b)).map((b) => b.id), items: {} };
  for (const b of s.blocks) if (isWod(b)) o.items[b.id] = b.items.filter((it) => !isLockedItem(it)).map((it) => it.id);
  return o;
}
/** null si l'ordre est celui de la séance. */
function normalize(session, s) {
  return JSON.stringify(orderOf(clone(session))) === JSON.stringify(orderOf(s)) ? null : orderOf(s);
}
export const isCustomOrder = (session, order) => !!order && normalize(session, applyOrder(session, order)) !== null;

const blockLabel = (b) => {
  if (b.type === 'sets') {
    const it = b.items?.[0];
    if (!it) return 'Bloc vide';
    const p = itemParts(it, b);
    return `${p.num} ${p.name}${p.load ? ` · ${p.load}` : ''}`;
  }
  return `${blockHeader(b)} · ${(b.items || []).map((it) => it.name).join(', ')}`;
};
const itemLabel = (it) => `${valueShort(it.mode, it.value)} ${it.name}${loadText(it.load) ? ` · ${loadText(it.load)}` : ''}`;

/**
 * Fenêtre « Mon ordre » : glisser-déposer ou « Décaler le départ » (rotation d'un cran).
 * @param onDone(order|null)
 */
export function openOrderEditor(session, order, onDone) {
  let cur = applyOrder(session, order);
  openModal(`${modalHead('Mon ordre')}
    <p class="small muted" style="margin-top:-4px">Seulement pour toi et pour cette séance : la séance de la bibliothèque ne change pas. Les Runs <span aria-hidden="true">🔒</span> restent à leur place.</p>
    <div data-groups></div>
    <div class="row between" style="margin-top:14px">
      <button class="btn btn-sm btn-ghost" data-reset>Ordre de la séance</button>
      <button class="btn btn-primary" data-ok>${I.check} Valider</button>
    </div>`, (m, close) => {
    const holder = $('[data-groups]', m);
    const listFor = (g) => (g.kind === 'blocks' ? cur.blocks : cur.blocks.find((b) => b.id === g.id).items);
    const lockFor = (g) => (g.kind === 'blocks' ? isLockedBlock : isLockedItem);
    const setList = (g, list) => {
      if (g.kind === 'blocks') cur.blocks = list;
      else cur.blocks.find((b) => b.id === g.id).items = list;
    };

    const draw = () => {
      const gs = groupsOf(cur);
      holder.innerHTML = gs.map((g) => {
        const list = listFor(g);
        const locked = lockFor(g);
        const rows = list.map((x) => {
          const lk = locked(x);
          const text = g.kind === 'blocks' ? blockLabel(x) : itemLabel(x);
          const ic = g.kind === 'blocks' ? (x.items?.[0] ? visualSmall(x.items[0]) : '') : visualSmall(x);
          return `<div class="ord-row ${lk ? 'locked' : ''}" data-sort-item>
            ${lk ? '<span class="ord-lock" title="Reste à sa place">🔒</span>' : `<span class="handle" data-handle title="Glisser pour déplacer">${I.grip}</span>`}
            <span class="ic">${ic}</span><span class="grow">${esc(text)}</span></div>`;
        }).join('');
        const title = g.kind === 'blocks' ? 'Ordre des blocs' : `${blockHeader(g.block)}`;
        return `<div class="ord-group">
          <div class="ord-h"><span class="kicker">${esc(title)}</span><button class="btn btn-sm" data-rot="${esc(g.id)}">Décaler le départ</button></div>
          <div class="ord-list" data-list="${esc(g.id)}">${rows}</div></div>`;
      }).join('');
      $$('[data-list]', holder).forEach((el) => {
        const g = gs.find((x) => x.id === el.dataset.list);
        makeSortable(el, (from, to) => {
          const list = listFor(g).slice();
          moveInArray(list, from, to);
          const locked = lockFor(g);
          setList(g, placeMovable(listFor(g), locked, list.filter((x) => !locked(x))));
          draw();
        });
      });
    };
    draw();

    m.addEventListener('click', (e) => {
      const rot = e.target.closest('[data-rot]');
      if (rot) {
        const g = groupsOf(cur).find((x) => x.id === rot.dataset.rot);
        const locked = lockFor(g);
        const mov = listFor(g).filter((x) => !locked(x));
        setList(g, placeMovable(listFor(g), locked, [...mov.slice(1), mov[0]]));
        draw();
      }
      if (e.target.closest('[data-reset]')) { cur = clone(session); draw(); }
      if (e.target.closest('[data-ok]')) {
        close();
        onDone(normalize(session, cur));
      }
    });
  });
}
