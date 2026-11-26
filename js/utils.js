// Utilitaires généraux : identifiants, échappement HTML, dates, formats.

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

export const MODES = {
  reps: { label: 'Reps', unit: 'reps' },
  time: { label: 'Temps', unit: 'sec' },
  distance: { label: 'Distance', unit: 'm' },
  cal: { label: 'Cal', unit: 'cal' },
};

export const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const DAYS_SHORT = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SHORT = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];

const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export const todayYmd = () => ymd(new Date());
export function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}
export function mondayOf(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}
export function daysUntil(ymdStr) {
  if (!ymdStr) return null;
  const a = parseYmd(todayYmd());
  const b = parseYmd(ymdStr);
  return Math.round((b - a) / 86400000);
}
export function dayIndex(d) {
  return (d.getDay() + 6) % 7;
}
export function fmtDateLong(ymdStr) {
  const d = parseYmd(ymdStr);
  return `${DAYS[dayIndex(d)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Chrono : 75 -> "1:15", 3725 -> "1:02:05" */
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Durée courte : 45 -> "45s", 90 -> "1'30", 120 -> "2'" */
export function fmtShortTime(sec) {
  sec = Math.round(Number(sec) || 0);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}'${pad(s)}` : `${m}'`;
}

/** "1:15" -> 75, "1:02:05" -> 3725, "45" -> 45. Renvoie null si illisible. */
export function parseClock(str) {
  const s = String(str || '').trim().replace(/[’'h]/g, ':').replace(/[^\d:]/g, '');
  if (!s) return null;
  const parts = s.split(':').map((p) => (p === '' ? 0 : Number(p)));
  if (parts.some((p) => !Number.isFinite(p)) || parts.length > 3) return null;
  return parts.reduce((a, p) => a * 60 + p, 0);
}

export const num = (v, d = 0) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : d;
};

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
