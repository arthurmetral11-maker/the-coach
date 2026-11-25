// Mise en forme des exercices / blocs / séances (utilisée par l'interface, l'affiche et le mode séance).
import { fmtShortTime } from './utils.js';

export const FORMATS = {
  rounds: { label: 'Rounds', hint: 'X tours d’une série d’exercices' },
  fortime: { label: 'For time', hint: 'Le plus vite possible (time cap optionnel)' },
  amrap: { label: 'AMRAP', hint: 'Max de tours en X minutes' },
  emom: { label: 'EMOM', hint: 'Un exercice au début de chaque minute' },
};

/** Valeur compacte : "600m", "1km", "45s", "1'30", "20cal", "50" */
export function valueShort(mode, v) {
  v = Number(v) || 0;
  switch (mode) {
    case 'time':
      return fmtShortTime(v);
    case 'distance':
      return v >= 1000 && v % 1000 === 0 ? `${v / 1000}km` : `${v}m`;
    case 'cal':
      return `${v}cal`;
    default:
      return `${v}`;
  }
}

export const loadText = (l) => (Number(l) > 0 ? `${Number(l)} kg` : '');

/** Découpe un exercice d'un bloc en {num, name, load} pour l'affichage. */
export function itemParts(item, block) {
  const name = item.name || 'Exercice';
  if (block && block.type === 'sets') {
    const sets = Math.max(1, Number(block.sets) || 1);
    if (block.variable && Array.isArray(item.perSet) && item.perSet.length) {
      const vals = item.perSet.map((p) => valueShort(item.mode, p.value));
      const loads = item.perSet.map((p) => Number(p.load) || 0);
      const allSameLoad = loads.every((l) => l === loads[0]);
      return {
        num: vals.join('/'),
        name,
        load: loads.some((l) => l > 0) ? (allSameLoad ? `${loads[0]} kg` : `${loads.join('/')} kg`) : '',
      };
    }
    return { num: `${sets}×${valueShort(item.mode, item.value)}`, name, load: loadText(item.load) };
  }
  return { num: valueShort(item.mode, item.value), name, load: loadText(item.load) };
}

/** Titre d'un bloc WOD : "5 ROUNDS", "FOR TIME", "AMRAP 12'"... (null pour un bloc séries) */
export function blockHeader(block) {
  if (!block || block.type === 'sets') return null;
  const r = Math.max(1, Number(block.rounds) || 1);
  switch (block.format) {
    case 'rounds':
      return `${r} ROUND${r > 1 ? 'S' : ''}`;
    case 'fortime':
      return r > 1 ? `${r} ROUNDS FOR TIME` : 'FOR TIME';
    case 'amrap':
      return `AMRAP ${Number(block.duration) || 0}'`;
    case 'emom': {
      const iv = Number(block.interval) || 60;
      return iv === 60 ? `EMOM ${Number(block.duration) || 0}'` : `EVERY ${fmtShortTime(iv)} · ${Number(block.duration) || 0}'`;
    }
    default:
      return 'WOD';
  }
}

export function blockCap(block) {
  if (!block || block.type === 'sets') return '';
  if ((block.format === 'rounds' || block.format === 'fortime') && Number(block.timeCap) > 0) return `TIME CAP ${Number(block.timeCap)} MIN`;
  return '';
}

/** Infos de repos lisibles pour un bloc. */
export function blockRestInfo(block) {
  const out = [];
  if (block.type === 'sets') {
    if (Number(block.restBetween) > 0) out.push(`Récup ${fmtShortTime(block.restBetween)} entre séries`);
  } else if ((block.format === 'rounds' || block.format === 'fortime') && Number(block.restBetween) > 0) {
    out.push(`Récup ${fmtShortTime(block.restBetween)} entre tours`);
  }
  if (Number(block.restAfter) > 0) out.push(`Puis ${fmtShortTime(block.restAfter)} de repos`);
  return out.join(' · ');
}

/** Résumé court d'une séance pour les cartes. */
export function sessionSummary(s) {
  const parts = (s?.blocks || []).map((b) => {
    if (b.type === 'sets') {
      const it = b.items?.[0];
      if (!it) return '';
      const p = itemParts(it, b);
      return `${p.num} ${p.name}`;
    }
    return `${blockHeader(b)} (${(b.items || []).length} exo${(b.items || []).length > 1 ? 's' : ''})`;
  });
  return parts.filter(Boolean).join(' · ') || 'Séance vide';
}

/** Lignes texte (pour l'affiche) : [{kind:'header'|'item', num, name, load, extra}] */
export function sessionLines(s) {
  const lines = [];
  for (const b of s?.blocks || []) {
    if (b.type === 'sets') {
      const it = b.items?.[0];
      if (!it) continue;
      const p = itemParts(it, b);
      lines.push({ kind: 'item', num: p.num, name: p.name, load: p.load, extra: Number(b.restBetween) > 0 ? `R ${fmtShortTime(b.restBetween)}` : '', indent: false });
    } else {
      const cap = Number(b.timeCap) > 0 && (b.format === 'rounds' || b.format === 'fortime') ? `CAP ${b.timeCap}'` : '';
      lines.push({ kind: 'header', num: blockHeader(b), name: '', load: '', extra: cap });
      for (const it of b.items || []) {
        const p = itemParts(it, b);
        lines.push({ kind: 'item', num: p.num, name: p.name, load: p.load, extra: '', indent: true });
      }
    }
  }
  return lines;
}
