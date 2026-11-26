// Mise en forme des exercices / blocs / séances (utilisée par l'interface, l'affiche et le mode séance).
import { fmtShortTime, fmtClock } from './utils.js';

export const FORMATS = {
  rounds: { label: 'Rounds', hint: 'X tours d’une série d’exercices' },
  fortime: { label: 'For time', hint: 'Le plus vite possible (time cap optionnel)' },
  amrap: { label: 'AMRAP', hint: 'Max de tours en X minutes' },
  emom: { label: 'EMOM', hint: 'Un exercice au début de chaque minute' },
};

// ---------------------------------------------------------------- Catégories de séance
export const CATS = {
  hyrox: { label: 'Hyrox' },
  running: { label: 'Running' },
  muscu: { label: 'Musculation' },
};
export const CAT_KEYS = ['hyrox', 'running', 'muscu'];

/** Catégorie d'une séance. Les séances d'avant la V3 n'ont pas de champ `cat` : on la déduit. */
export function catOf(s) {
  if (!s) return 'hyrox';
  if (CATS[s.cat]) return s.cat;
  const blocks = s.blocks || [];
  if (blocks.some((b) => b.type === 'run')) return 'running';
  const t = String(s.tag || '').toLowerCase();
  if (/muscu|force|renfo|strength/.test(t)) return 'muscu';
  if (/run|course|footing|fractionn/.test(t) && !blocks.length) return 'running';
  return 'hyrox';
}
export const catLabel = (s) => CATS[catOf(s)].label;

// ---------------------------------------------------------------- Running
export const RUN_KINDS = {
  run: { label: 'Run' },
  active: { label: 'Repos actif' },
  rest: { label: 'Repos' },
};
export const RUN_ICON = '\u{1F3C3}';

/** 400 -> "400 m", 1000 -> "1 km", 2500 -> "2,5 km" */
export function distText(m) {
  m = Math.round(Number(m) || 0);
  if (m >= 1000) return `${String(+(m / 1000).toFixed(2)).replace('.', ',')} km`;
  return `${m} m`;
}
/** Allure (secondes par km) -> "3:45/km" */
export const paceText = (s) => `${fmtClock(Math.round(Number(s) || 0))}/km`;

/**
 * Valeurs d'une étape running. On saisit la distance OU le temps, plus une allure facultative :
 * la troisième valeur est calculée (elles ne peuvent donc pas se contredire).
 * by = 'distance' : l'étape se termine avec le bouton « Fait » (temps réel mesuré).
 * by = 'time'     : l'étape s'enchaîne seule à la fin du temps.
 */
export function stepValues(st) {
  const rest = st.kind === 'rest';
  const by = rest ? 'time' : st.by === 'time' ? 'time' : 'distance';
  const pace = rest ? 0 : Math.max(0, Number(st.pace) || 0);
  let distance = Math.max(0, Number(st.distance) || 0);
  let time = Math.max(0, Number(st.time) || 0);
  if (by === 'distance') time = pace && distance ? Math.round((distance * pace) / 1000) : 0;
  else distance = pace && time ? Math.round((time / pace) * 1000) : 0;
  return { by, distance, time, pace };
}

/** Texte d'une étape : {num, name, pace} — ex. {num:"400 m", name:"Run", pace:"3:45/km"} */
export function stepText(st) {
  const v = stepValues(st);
  return {
    num: v.by === 'distance' ? distText(v.distance) : fmtShortTime(v.time),
    name: st.label || RUN_KINDS[st.kind]?.label || 'Run',
    pace: v.pace ? paceText(v.pace) : '',
  };
}

const loopRounds = (b) => (b.loop ? Math.max(1, Number(b.rounds) || 1) : 1);

function runBlockSummary(b) {
  const parts = (b.steps || []).map((st) => {
    const t = stepText(st);
    return `${t.num} ${t.name}`;
  });
  if (!parts.length) return '';
  return b.loop ? `${loopRounds(b)} × (${parts.join(' + ')})` : parts.join(' · ');
}

// ---------------------------------------------------------------- Exercices
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

/** Quantité lisible pour les regroupements : "1 km", "100 reps", "2:00", "20 cal" */
export function qtyText(mode, v) {
  v = Number(v) || 0;
  if (mode === 'distance') return distText(v);
  if (mode === 'time') return fmtClock(v);
  if (mode === 'cal') return `${v} cal`;
  return `${v} reps`;
}

export const loadText = (l) => (Number(l) > 0 ? `${Number(l)} kg` : '');

const RUN_RE = /\b(run|course|footing|jog)/i;
export const isRunName = (name, id) => id === 'seed-run' || RUN_RE.test(String(name || ''));
const ERG_RE = /ski|row|rame|bike|v[ée]lo|erg|assault/i;

/**
 * Unité de comparaison d'un exercice (progression toutes séances confondues) :
 * min/km pour le Run, /500 m pour SkiErg et Rameur, /100 m pour les autres distances, /10 reps, /10 cal.
 * null pour un exercice au temps (rien à mesurer).
 */
export function rateUnit(mode, name, id) {
  if (mode === 'distance') {
    if (isRunName(name, id)) return { per: 1000, label: '/km' };
    if (ERG_RE.test(String(name || ''))) return { per: 500, label: '/500 m' };
    return { per: 100, label: '/100 m' };
  }
  if (mode === 'reps') return { per: 10, label: '/10 reps' };
  if (mode === 'cal') return { per: 10, label: '/10 cal' };
  return null;
}

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

/** Titre d'un bloc : "5 ROUNDS", "FOR TIME", "AMRAP 12'", "10 ×" (boucle running)… (null pour un bloc simple) */
export function blockHeader(block) {
  if (!block || block.type === 'sets') return null;
  if (block.type === 'run') return block.loop ? `${loopRounds(block)} ×` : null;
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
  if (!block || block.type === 'sets' || block.type === 'run') return '';
  if ((block.format === 'rounds' || block.format === 'fortime') && Number(block.timeCap) > 0) return `TIME CAP ${Number(block.timeCap)} MIN`;
  return '';
}

/** Infos de repos lisibles pour un bloc. */
export function blockRestInfo(block) {
  const out = [];
  if (block.type === 'run') return '';
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
    if (b.type === 'run') return runBlockSummary(b);
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

/** Symboles d'une séance (planning). */
export function sessionIcons(s, max = 4) {
  const icons = (s?.blocks || []).flatMap((b) => (b.type === 'run' ? [RUN_ICON] : (b.items || []).map((it) => it.icon)));
  return [...new Set(icons.filter(Boolean))].slice(0, max).join('');
}

/** Lignes texte (pour l'affiche) : [{kind:'header'|'item', num, name, load, extra}] */
export function sessionLines(s) {
  const lines = [];
  for (const b of s?.blocks || []) {
    if (b.type === 'run') {
      const steps = b.steps || [];
      if (!steps.length) continue;
      if (b.loop) lines.push({ kind: 'header', num: `${loopRounds(b)} ×`, name: '', load: '', extra: '' });
      for (const st of steps) {
        const t = stepText(st);
        lines.push({ kind: 'item', num: t.num, name: t.name, load: t.pace ? `@ ${t.pace}` : '', extra: '', indent: !!b.loop });
      }
    } else if (b.type === 'sets') {
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
