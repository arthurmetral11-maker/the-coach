// Affiches : semaine (programme) et résultat de séance. Dessin sur <canvas> (PNG) + conversion PDF.
import { sessionLines, distText, paceText } from './format.js';
import { DAYS_SHORT, MONTHS_SHORT, isoWeek, ymd, daysUntil, fmtClock } from './utils.js';
import {
  resultCat, timeGroups, runStats, muscuGroups, muscuTotals, rateText, fmtValue, deltaText, fmtKg, setText,
} from './analytics.js';

const fmtClockP = (s) => fmtClock(Math.round(Number(s) || 0));

const SANS = '"Inter Tight", "Helvetica Neue", Arial, sans-serif';
const SERIF = '"DM Serif Display", Georgia, "Times New Roman", serif';
const C = { bg: '#F2F1ED', ink: '#111111', muted: '#8A8882', line: '#CFCDC6' };

async function ensureFonts() {
  try {
    await Promise.all([
      ...['400', '500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 40px "Inter Tight"`)),
      document.fonts.load('400 40px "DM Serif Display"'),
    ]);
  } catch { /* polices de secours */ }
}

const setFont = (ctx, weight, size, family = SANS) => { ctx.font = `${weight} ${size}px ${family}`; };

/** Texte avec espacement des lettres (dessiné lettre par lettre). */
function spacedWidth(ctx, text, sp) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + sp;
  return w - sp;
}
function spaced(ctx, text, x, y, sp, align = 'left') {
  if (align === 'right') x -= spacedWidth(ctx, text, sp);
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + sp;
  }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Découpe un paragraphe "riche" (segments de styles différents) en lignes. */
function wrapRich(ctx, segs, maxW, size) {
  const words = [];
  let sp = 0;
  for (const seg of segs) {
    const parts = String(seg.t).split(' ');
    parts.forEach((p, i) => {
      if (i > 0) sp++;
      if (!p) return;
      words.push({ t: p, w: seg.w, c: seg.c, sp });
      sp = 0;
    });
  }
  const lines = [];
  let line = [];
  let lw = 0;
  for (const wd of words) {
    setFont(ctx, wd.w, size);
    const tw = ctx.measureText(wd.t).width;
    const spW = ctx.measureText(' ').width * wd.sp;
    const add = (line.length ? spW : 0) + tw;
    if (line.length && lw + add > maxW) {
      lines.push(line);
      line = [];
      lw = 0;
    }
    wd.tw = tw;
    wd.spW = spW;
    lw += (line.length ? spW : 0) + tw;
    line.push(wd);
  }
  if (line.length) lines.push(line);
  return lines;
}
function drawRichLine(ctx, line, x, y, size) {
  line.forEach((wd, i) => {
    if (i > 0) x += wd.spW;
    setFont(ctx, wd.w, size);
    ctx.fillStyle = wd.c || C.ink;
    ctx.fillText(wd.t, x, y);
    x += wd.tw;
  });
}

/** Paragraphes d'une journée selon la taille de police f et le mode (détaillé / compact). */
function dayParagraphs(sessions, f, compact) {
  const paras = [];
  sessions.forEach((s, si) => {
    paras.push({ segs: [{ t: (s.name || 'Séance').toUpperCase(), w: 800 }], size: f * 1.12, lh: 1.25, gap: si ? f * 0.7 : 0, indent: 0 });
    const lines = sessionLines(s);
    if (!compact) {
      for (const l of lines) {
        const segs = l.kind === 'header'
          ? [{ t: l.num, w: 800 }, ...(l.extra ? [{ t: `  ${l.extra}`, w: 600, c: C.muted }] : [])]
          : [
            { t: l.num, w: 800 },
            { t: ` ${String(l.name).toUpperCase()}`, w: 500 },
            ...(l.load ? [{ t: `  ${l.load.toUpperCase()}`, w: 600, c: C.muted }] : []),
            ...(l.extra ? [{ t: `  ${l.extra}`, w: 600, c: C.muted }] : []),
          ];
        paras.push({ segs, size: f, lh: 1.3, gap: l.kind === 'header' ? f * 0.25 : 0, indent: l.indent ? f * 0.9 : 0 });
      }
    } else {
      const segs = [];
      lines.forEach((l, i) => {
        if (l.kind === 'header') {
          if (segs.length) segs.push({ t: '  ', w: 500 });
          segs.push({ t: `${l.num}${l.extra ? ` (${l.extra})` : ''} :`, w: 800 });
        } else {
          const prev = lines[i - 1];
          if (segs.length && prev && prev.kind !== 'header') segs.push({ t: ' ·', w: 500, c: C.muted });
          segs.push({ t: ` ${l.num}`, w: 800 });
          segs.push({ t: ` ${String(l.name).toUpperCase()}`, w: 500 });
          if (l.load) segs.push({ t: ` ${l.load.toUpperCase()}`, w: 600, c: C.muted });
        }
      });
      if (segs.length) paras.push({ segs, size: f, lh: 1.3, gap: f * 0.15, indent: 0 });
    }
  });
  return paras;
}

/**
 * @param week {monday, days:[{date, sessions:[session]}], name, hyroxName, hyroxDate}
 * @param size {W, H}
 */
export async function renderWeekPoster(week, { W, H }) {
  await ensureFonts();
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const u = W / 1080;
  const M = 72 * u;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // ---- En-tête
  let y = M + 22 * u;
  ctx.fillStyle = C.ink;
  setFont(ctx, 700, 24 * u);
  spaced(ctx, 'THE COACH', M, y, 6 * u);
  if (week.name) {
    setFont(ctx, 600, 24 * u);
    spaced(ctx, week.name.toUpperCase(), W - M, y, 4 * u, 'right');
  }

  const mon = week.monday;
  const sun = week.days[6].date;
  const wk = String(isoWeek(mon)).padStart(2, '0');
  const bigSize = 260 * u;
  const bigBase = y + 40 * u + bigSize * 0.74;
  setFont(ctx, 400, bigSize, SERIF);
  ctx.lineWidth = 2.6 * u;
  ctx.strokeStyle = C.ink;
  ctx.strokeText(wk, M - 8 * u, bigBase);

  const range = mon.getMonth() === sun.getMonth()
    ? `${mon.getDate()} — ${sun.getDate()} ${MONTHS_SHORT[sun.getMonth()]} ${sun.getFullYear()}`
    : `${mon.getDate()} ${MONTHS_SHORT[mon.getMonth()]} — ${sun.getDate()} ${MONTHS_SHORT[sun.getMonth()]} ${sun.getFullYear()}`;
  setFont(ctx, 600, 30 * u);
  ctx.fillStyle = C.ink;
  spaced(ctx, range, W - M, bigBase - 6 * u, 3 * u, 'right');
  setFont(ctx, 600, 22 * u);
  ctx.fillStyle = C.muted;
  spaced(ctx, 'PROGRAMME DE LA SEMAINE', W - M, bigBase - 50 * u, 5 * u, 'right');

  // Compte à rebours (pastille)
  const d = daysUntil(week.hyroxDate);
  if (d != null && d >= 0) {
    const txt = d === 0 ? `JOUR J · ${(week.hyroxName || 'HYROX').toUpperCase()}` : `J-${d} · ${(week.hyroxName || 'HYROX').toUpperCase()}`;
    setFont(ctx, 700, 24 * u);
    const tw = spacedWidth(ctx, txt, 2 * u);
    const ph = 50 * u;
    const pw = tw + 40 * u;
    const px = W - M - pw;
    const py = bigBase - 130 * u - ph;
    ctx.lineWidth = 2.2 * u;
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.stroke();
    ctx.fillStyle = C.ink;
    spaced(ctx, txt, px + 20 * u, py + ph / 2 + 8.5 * u, 2 * u);
  }

  y = bigBase + 34 * u;
  ctx.fillStyle = C.ink;
  ctx.fillRect(M, y, W - 2 * M, 3 * u);
  y += 3 * u;

  // ---- Pied de page
  const footRuleY = H - M - 34 * u;
  const areaTop = y;
  const avail = footRuleY - 6 * u - areaTop;

  // ---- Jours : recherche de la plus grande taille de texte qui tient
  const leftW = 150 * u;
  const textX = M + leftW;
  const textW = W - M - textX;

  const layoutDay = (day, f, compact) => {
    const pad = f * 0.55;
    const dn = Math.max(f * 0.62, 15 * u);
    const dateSize = f * 1.9;
    const leftH = dn + 6 * u + dateSize * 0.74;
    if (!day.sessions.length) return { off: true, pad, dn, dateSize, h: pad * 2 + leftH, paras: [] };
    const paras = dayParagraphs(day.sessions, f, compact).map((p) => {
      const lines = wrapRich(ctx, p.segs, textW - p.indent, p.size);
      return { ...p, lines, h: p.gap + lines.length * p.size * p.lh };
    });
    const contentH = paras.reduce((a, p) => a + p.h, 0);
    return { off: false, pad, dn, dateSize, h: pad * 2 + Math.max(leftH, contentH), paras, contentH };
  };

  let best = null;
  for (const compact of [false, true]) {
    for (let f = 34 * u; f >= (compact ? 12 : 19) * u; f -= 1 * u) {
      const rows = week.days.map((dd) => layoutDay(dd, f, compact));
      const total = rows.reduce((a, r) => a + r.h, 0);
      if (total <= avail) { best = { rows, total, f }; break; }
    }
    if (best) break;
  }
  if (!best) {
    const f = 12 * u;
    const rows = week.days.map((dd) => layoutDay(dd, f, true));
    best = { rows, total: rows.reduce((a, r) => a + r.h, 0), f };
  }
  const extra = Math.max(0, avail - best.total);
  const perRow = Math.min(extra / 7, best.f * 2.4);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, areaTop, W, avail + 4 * u);
  ctx.clip();
  let ry = areaTop;
  best.rows.forEach((row, i) => {
    const day = week.days[i];
    const h = row.h + perRow;
    const top = ry + row.pad + perRow / 2;
    // Colonne jour
    ctx.fillStyle = row.off ? C.muted : C.ink;
    setFont(ctx, 700, row.dn);
    spaced(ctx, DAYS_SHORT[i], M, top + row.dn * 0.8, 3 * u);
    setFont(ctx, 400, row.dateSize, SERIF);
    const dateBase = top + row.dn + 6 * u + row.dateSize * 0.74;
    if (row.off) {
      ctx.lineWidth = 1.4 * u;
      ctx.strokeStyle = C.muted;
      ctx.strokeText(String(day.date.getDate()), M - 2 * u, dateBase);
      setFont(ctx, 600, Math.max(best.f * 0.9, 16 * u));
      ctx.fillStyle = C.muted;
      spaced(ctx, 'OFF', textX, dateBase - row.dateSize * 0.2, 8 * u);
    } else {
      ctx.fillText(String(day.date.getDate()), M - 2 * u, dateBase);
      let cy = top;
      for (const p of row.paras) {
        cy += p.gap;
        for (const line of p.lines) {
          cy += p.size * p.lh;
          drawRichLine(ctx, line, textX + p.indent, cy - p.size * (p.lh - 1) / 2 - p.size * 0.18, p.size);
        }
      }
    }
    ry += h;
    if (i < 6) {
      ctx.fillStyle = C.line;
      ctx.fillRect(M, ry - 0.75 * u, W - 2 * M, 1.5 * u);
    }
  });
  ctx.restore();

  // ---- Pied de page
  ctx.fillStyle = C.ink;
  ctx.fillRect(M, footRuleY, W - 2 * M, 2 * u);
  const nSessions = week.days.reduce((a, dd) => a + dd.sessions.length, 0);
  const nOff = week.days.filter((dd) => !dd.sessions.length).length;
  setFont(ctx, 600, 20 * u);
  spaced(ctx, `${nSessions} SÉANCE${nSessions > 1 ? 'S' : ''} · ${nOff} JOUR${nOff > 1 ? 'S' : ''} OFF`, M, H - M + 6 * u, 3 * u);
  ctx.fillStyle = C.muted;
  const right = week.hyroxDate
    ? `${(week.hyroxName || 'HYROX').toUpperCase()} · ${week.hyroxDate.split('-').reverse().join('.')}`
    : `SEMAINE ${wk}`;
  spaced(ctx, right, W - M, H - M + 6 * u, 3 * u, 'right');
  return cv;
}

// ---------------------------------------------------------------- Affiche d'un résultat de séance
function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}
const gfmt = (g, v) => (g.metric === 'pace' ? fmtValue('pace', v) : fmtValue('time', v));

/** Lignes de l'affiche : moyennes en tête, puis détail par exercice (barres + écart), puis blocs. */
function resultRows(r, cat) {
  const head = [];
  const detail = [];
  const tail = [];
  if (cat === 'muscu') {
    const gs = muscuGroups(r);
    head.push({ kind: 'sec', text: 'PAR EXERCICE' });
    gs.forEach((g) => head.push({
      kind: 'avg',
      text: g.name.toUpperCase(),
      sub: `${g.n} SÉRIE${g.n > 1 ? 'S' : ''}${g.reps ? ` · ${g.reps} REPS` : ''}`,
      val: g.avgLoad != null ? fmtKg(g.avgLoad).toUpperCase() : g.mode === 'reps' ? `${g.reps} REPS` : g.mode === 'time' ? fmtClock(g.qty) : String(g.qty),
      small: g.avgLoad != null ? 'MOY.' : '',
    }));
    gs.filter((g) => g.n > 1).forEach((g) => {
      const metric = (x) => (g.avgLoad != null ? Number(x.e.load) || 0 : Number(x.e.value) || 0);
      const max = Math.max(...g.items.map(metric), 1);
      detail.push({ kind: 'ghead', text: g.name.toUpperCase(), val: '' });
      g.items.forEach((x, k) => detail.push({ kind: 'bar', label: `S${k + 1}`, frac: Math.max(0.04, metric(x) / max), val: setText(x.e).toUpperCase(), delta: '' }));
    });
  } else {
    const gs = timeGroups(r);
    head.push({ kind: 'sec', text: 'MOYENNES' });
    gs.forEach((g) => head.push({
      kind: 'avg', text: g.title.toUpperCase(), sub: g.n > 1 ? `×${g.n}` : '', val: gfmt(g, g.avg), small: g.avgRate ? rateText(g.avgRate).toUpperCase() : '',
    }));
    gs.filter((g) => g.n > 1 && !g.fixed).forEach((g) => {
      const vals = g.items.map((x) => x.v).filter((v) => v != null);
      const max = vals.length ? Math.max(...vals) : 1;
      detail.push({ kind: 'ghead', text: g.title.toUpperCase(), val: `MOY. ${gfmt(g, g.avg)}` });
      g.items.forEach((x, k) => detail.push({
        kind: 'bar', label: String(k + 1), frac: x.v != null && max > 0 ? Math.max(0.04, x.v / max) : 0,
        val: x.v != null ? gfmt(g, x.v) : '—', delta: x.v != null && g.avg != null ? deltaText(x.v - g.avg) : '',
      }));
    });
    if (cat !== 'running') {
      const blocks = (r.blocks || []).filter((b) => b.header);
      if (blocks.length) {
        tail.push({ kind: 'sec', text: 'BLOCS' });
        blocks.forEach((b) => {
          const am = (r.entries || []).find((e) => e.k === 'amrap' && e.bi === b.bi);
          tail.push({ kind: 'avg', text: b.header, sub: '', val: am ? `${am.rounds} TOUR${am.rounds > 1 ? 'S' : ''}` : fmtClock(b.sec), small: '' });
        });
      }
    }
  }
  if (detail.length) detail.unshift({ kind: 'sec', text: 'DÉTAIL PAR EXERCICE' });
  return { head, detail, tail };
}

/**
 * @param r résultat ({cat, sessionName, date, total, effort, rest, rpe, note, complete, entries, blocks})
 * @param opts {name, rpeLabel, W, H}
 */
export async function renderResultPoster(r, { name = '', rpeLabel = '', W = 1080, H = 1920 } = {}) {
  await ensureFonts();
  const cat = resultCat(r);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const u = W / 1080;
  const M = 72 * u;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // ---- En-tête
  let y = M + 22 * u;
  ctx.fillStyle = C.ink;
  setFont(ctx, 700, 24 * u);
  spaced(ctx, 'THE COACH', M, y, 6 * u);
  if (name) {
    setFont(ctx, 600, 24 * u);
    spaced(ctx, name.toUpperCase(), W - M, y, 4 * u, 'right');
  }
  y += 70 * u;
  setFont(ctx, 600, 22 * u);
  ctx.fillStyle = C.muted;
  const [yy, mm, dd] = String(r.date).split('-');
  spaced(ctx, `RÉSULTAT · ${dd}.${mm}.${yy}${r.complete ? '' : ' · INCOMPLÈTE'}${r.order ? ' · ORDRE PERSO' : ''}`, M, y, 5 * u);
  y += 62 * u;
  ctx.fillStyle = C.ink;
  setFont(ctx, 800, 54 * u);
  ctx.fillText(ellipsize(ctx, String(r.sessionName || 'Séance').toUpperCase(), W - 2 * M), M, y);

  // ---- Grand chiffre (temps total, ou nombre de séries en musculation)
  let bigText;
  let side;
  if (cat === 'muscu') {
    const t = muscuTotals(r);
    bigText = String(t.sets);
    side = [
      { t: 'SÉRIES', w: 700, c: C.ink },
      { t: `${t.reps} REPS`, w: 600, c: C.ink },
      { t: `${t.exercises} EXERCICE${t.exercises > 1 ? 'S' : ''}`, w: 600, c: C.muted },
    ];
  } else if (cat === 'running') {
    const rs = runStats(r);
    bigText = fmtClockP(r.total);
    side = [
      { t: 'TEMPS TOTAL', w: 700, c: C.ink },
      { t: `DISTANCE ${distText(rs.distance).toUpperCase()}`, w: 600, c: C.ink },
      ...(rs.pace ? [{ t: `ALLURE ${paceText(rs.pace).toUpperCase()}`, w: 600, c: C.ink }] : []),
      { t: `SANS RÉCUP ${fmtClockP(r.effort)}`, w: 600, c: C.muted },
    ];
  } else {
    bigText = fmtClockP(r.total);
    side = [
      { t: 'TEMPS TOTAL', w: 700, c: C.ink },
      { t: `SANS REPOS ${fmtClockP(r.effort)}`, w: 600, c: C.ink },
      { t: `REPOS ${fmtClockP(r.rest)}`, w: 600, c: C.muted },
    ];
  }
  let big = 250 * u;
  setFont(ctx, 400, big, SERIF);
  const maxBigW = W - 2 * M - 340 * u;
  while (ctx.measureText(bigText).width > maxBigW && big > 110 * u) { big -= 6 * u; setFont(ctx, 400, big, SERIF); }
  const bigBase = y + 30 * u + 250 * u * 0.74;
  ctx.lineWidth = 2.6 * u;
  ctx.strokeStyle = C.ink;
  ctx.strokeText(bigText, M - 8 * u, bigBase);

  let sy = bigBase - 250 * u * 0.74 + 40 * u;
  for (const s of side) {
    setFont(ctx, s.w, 24 * u);
    ctx.fillStyle = s.c;
    spaced(ctx, s.t, W - M, sy, 3 * u, 'right');
    sy += 40 * u;
  }
  if (r.rpe) {
    const txt = `RPE ${r.rpe}${rpeLabel ? ` · ${rpeLabel.toUpperCase()}` : ''}`;
    setFont(ctx, 700, 22 * u);
    const tw = spacedWidth(ctx, txt, 2 * u);
    const ph = 46 * u;
    const pw = tw + 36 * u;
    const px = W - M - pw;
    const py = sy - 10 * u;
    ctx.lineWidth = 2.2 * u;
    ctx.strokeStyle = C.ink;
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.stroke();
    ctx.fillStyle = C.ink;
    spaced(ctx, txt, px + 18 * u, py + ph / 2 + 8 * u, 2 * u);
  }

  y = Math.max(bigBase, sy + (r.rpe ? 46 * u : 0) - 10 * u) + 34 * u;
  ctx.fillStyle = C.ink;
  ctx.fillRect(M, y, W - 2 * M, 3 * u);
  y += 3 * u;

  // ---- Zone des lignes
  const footRuleY = H - M - 34 * u;
  const areaTop = y + 4 * u;
  const avail = footRuleY - 10 * u - areaTop;
  const { head, detail, tail } = resultRows(r, cat);
  const heights = { sec: 2.3, avg: 1.55, ghead: 1.75, bar: 1.22 };
  const measure = (rows, f) => rows.reduce((a, x) => a + heights[x.kind] * f, 0);
  let rows = [...head, ...detail, ...tail];
  let f = 0;
  for (let t = 44 * u; t >= 16 * u; t -= 1 * u) if (measure(rows, t) <= avail) { f = t; break; }
  if (!f) {
    // Trop de lignes : on garde les moyennes (et les blocs).
    rows = [...head, ...tail];
    for (let t = 34 * u; t >= 13 * u; t -= 1 * u) if (measure(rows, t) <= avail) { f = t; break; }
    if (!f) f = 13 * u;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, areaTop, W, avail + 6 * u);
  ctx.clip();
  let ry = areaTop;
  const hasDelta = cat !== 'muscu';
  rows.forEach((x, i) => {
    const h = heights[x.kind] * f;
    const base = ry + h * 0.66;
    if (x.kind === 'sec') {
      setFont(ctx, 700, f * 0.68);
      ctx.fillStyle = C.muted;
      spaced(ctx, x.text, M, ry + h * 0.74, 4 * u);
    } else if (x.kind === 'ghead') {
      setFont(ctx, 700, f * 0.72);
      const vw = x.val ? ctx.measureText(x.val).width : 0;
      ctx.fillStyle = C.ink;
      if (x.val) ctx.fillText(x.val, W - M - vw, base);
      setFont(ctx, 800, f);
      ctx.fillText(ellipsize(ctx, x.text, W - 2 * M - vw - 30 * u), M, base);
      ctx.fillRect(M, ry + h - 1.5 * u, W - 2 * M, 1.5 * u);
    } else if (x.kind === 'bar') {
      setFont(ctx, 700, f * 0.72);
      ctx.fillStyle = C.muted;
      ctx.fillText(x.label, M, base);
      const dW = hasDelta ? 130 * u : 0;
      setFont(ctx, 800, f * 0.88);
      ctx.fillStyle = C.ink;
      const vw = ctx.measureText(x.val).width;
      ctx.fillText(x.val, W - M - dW - vw, base);
      if (hasDelta && x.delta) {
        setFont(ctx, 600, f * 0.7);
        ctx.fillStyle = C.muted;
        ctx.fillText(x.delta, W - M - ctx.measureText(x.delta).width, base);
      }
      const bx = M + 64 * u;
      const bwMax = W - M - dW - vw - 28 * u - bx;
      const bh = Math.max(6 * u, h * 0.36);
      const bw = Math.max(0, bwMax * x.frac);
      if (bw > 0) {
        ctx.fillStyle = C.ink;
        roundRect(ctx, bx, base - f * 0.32 - bh / 2, bw, bh, Math.min(4 * u, bh / 2));
        ctx.fill();
      }
    } else {
      setFont(ctx, 800, f);
      ctx.fillStyle = C.ink;
      const vw = ctx.measureText(x.val).width;
      ctx.fillText(x.val, W - M - vw, base);
      let used = vw;
      if (x.small) {
        setFont(ctx, 600, f * 0.62);
        ctx.fillStyle = C.muted;
        const sw = ctx.measureText(x.small).width;
        ctx.fillText(x.small, W - M - vw - 16 * u - sw, base);
        used += sw + 16 * u;
      }
      setFont(ctx, 500, f);
      ctx.fillStyle = C.ink;
      const main = ellipsize(ctx, x.text, W - 2 * M - used - 40 * u);
      ctx.fillText(main, M, base);
      if (x.sub) {
        const mw = ctx.measureText(main).width;
        setFont(ctx, 600, f * 0.68);
        ctx.fillStyle = C.muted;
        const room = W - 2 * M - used - 40 * u - mw - 14 * u;
        if (room > 40 * u) ctx.fillText(ellipsize(ctx, x.sub, room), M + mw + 14 * u, base);
      }
      const nxt = rows[i + 1];
      if (nxt && nxt.kind === 'avg') {
        ctx.fillStyle = C.line;
        ctx.fillRect(M, ry + h - 0.75 * u, W - 2 * M, 1.5 * u);
      }
    }
    ry += h;
  });
  ctx.restore();

  // ---- Pied de page
  ctx.fillStyle = C.ink;
  ctx.fillRect(M, footRuleY, W - 2 * M, 2 * u);
  const note = (r.note || '').replace(/\s+/g, ' ').trim();
  const count = cat === 'muscu' ? `${muscuTotals(r).sets} SÉRIES` : `${(r.entries || []).filter((e) => e.k === 'work' || e.k === 'run').length} EXERCICES`;
  const left = note ? `« ${note} »` : count;
  ctx.fillStyle = C.ink;
  setFont(ctx, note ? 500 : 600, 20 * u);
  ctx.fillText(ellipsize(ctx, left, W - 2 * M - 220 * u), M, H - M + 6 * u);
  setFont(ctx, 600, 20 * u);
  ctx.fillStyle = C.muted;
  spaced(ctx, 'THE COACH', W - M, H - M + 6 * u, 3 * u, 'right');
  return cv;
}

// ---------------------------------------------------------------- PDF minimal (une page, image JPEG)
export function canvasToPdfBlob(canvas) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const bin = atob(dataUrl.split(',')[1]);
  const img = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) img[i] = bin.charCodeAt(i);

  const pw = 595.28;
  const ph = +(pw * (canvas.height / canvas.width)).toFixed(2);
  const enc = (s) => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff; return a; };
  const chunks = [];
  const offsets = [];
  let len = 0;
  const add = (part) => { const b = typeof part === 'string' ? enc(part) : part; chunks.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; add(`${n} 0 obj\n`); body(); add('\nendobj\n'); };

  const content = `q\n${pw} 0 0 ${ph} 0 0 cm\n/Im0 Do\nQ`;
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => {
    add(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`);
    add(img);
    add('\nendstream');
  });
  obj(5, () => add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = len;
  add(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

export const weekKey = (mon) => ymd(mon);
