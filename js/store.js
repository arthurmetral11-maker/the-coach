// Stockage local (localStorage) + règles métier : bibliothèques partagées, planning personnel.
//
// - exercises / sessions : bibliothèques COMMUNES (synchronisées). Suppression = "pierre tombale" (deleted:true)
//   pour que la suppression se propage aux autres appareils.
// - plan : planning PERSONNEL (local). Chaque entrée référence une séance + garde une copie ("snapshot").
//   Règle : pour aujourd'hui et le futur, on affiche la séance à jour de la bibliothèque ;
//   pour le passé, on affiche la copie telle qu'elle était -> une modification ne change que le futur.
import { uid, clone, todayYmd, ymd } from './utils.js';
import { SEED_VERSION, SEED_EXERCISES, SEED_SESSIONS } from './seed.js';

const K = { exercises: 'tc.exercises', sessions: 'tc.sessions', plan: 'tc.plan', settings: 'tc.settings' };

export const db = { exercises: {}, sessions: {}, plan: [], settings: {} };

const listeners = new Set();
let pushHook = null;
export const setPushHook = (fn) => { pushHook = fn; };
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(what) {
  listeners.forEach((fn) => {
    try { fn(what); } catch (e) { console.error(e); }
  });
}

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function persist(...colls) {
  for (const c of colls) {
    try {
      localStorage.setItem(K[c], JSON.stringify(db[c]));
    } catch (e) {
      console.error(e);
      alert('Stockage plein : supprimez des photos d’exercices ou exportez une sauvegarde.');
    }
  }
}

export function load() {
  db.exercises = read(K.exercises, {});
  db.sessions = read(K.sessions, {});
  db.plan = read(K.plan, []);
  db.settings = Object.assign(
    { name: '', hyroxName: '', hyroxDate: '', teamCode: '', seedVersion: 0 },
    read(K.settings, {}),
  );
  if ((db.settings.seedVersion || 0) < SEED_VERSION) {
    for (const e of SEED_EXERCISES) if (!db.exercises[e.id]) db.exercises[e.id] = clone(e);
    for (const s of SEED_SESSIONS) if (!db.sessions[s.id]) db.sessions[s.id] = clone(s);
    db.settings.seedVersion = SEED_VERSION;
    persist('exercises', 'sessions', 'settings');
  }
  refreshSnapshots(todayYmd());
  try { navigator.storage?.persist?.(); } catch { /* ignore */ }
}

const alive = (o) => o && !o.deleted;
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });

export const listExercises = () => Object.values(db.exercises).filter(alive).sort(byName);
export const getExercise = (id) => (alive(db.exercises[id]) ? db.exercises[id] : null);
export const listSessions = () => Object.values(db.sessions).filter(alive).sort(byName);
export const getSession = (id) => (alive(db.sessions[id]) ? db.sessions[id] : null);

function stamp(doc) {
  doc.updatedAt = Date.now();
  doc.updatedBy = db.settings.name || '';
  return doc;
}

function saveDoc(coll, doc) {
  stamp(doc);
  db[coll][doc.id] = doc;
  persist(coll);
  pushHook?.(coll, doc);
  if (refreshSnapshots(todayYmd())) emit('plan');
  emit(coll);
}

export const saveExercise = (ex) => saveDoc('exercises', ex);
export const saveSession = (s) => saveDoc('sessions', s);

export function deleteExercise(id) {
  const d = db.exercises[id];
  if (d) saveDoc('exercises', Object.assign(d, { deleted: true }));
}
export function deleteSession(id) {
  const d = db.sessions[id];
  if (d) saveDoc('sessions', Object.assign(d, { deleted: true }));
}

/** Fusionne des documents venus d'ailleurs (synchro ou import). Le plus récent gagne. */
export function mergeDocs(coll, docs, { push = false } = {}) {
  let changed = 0;
  let minDate = todayYmd();
  for (const d of docs || []) {
    if (!d || !d.id) continue;
    const cur = db[coll][d.id];
    if (!cur || (Number(d.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) {
      db[coll][d.id] = d;
      changed++;
      const dy = ymd(new Date(Number(d.updatedAt) || Date.now()));
      if (dy < minDate) minDate = dy;
      if (push) pushHook?.(coll, d);
    }
  }
  if (changed) {
    persist(coll);
    if (refreshSnapshots(minDate)) emit('plan');
    emit(coll);
  }
  return changed;
}

/** Remplace noms/icônes des exercices par ceux de la bibliothèque. */
export function resolveSession(s) {
  const c = clone(s);
  for (const b of c.blocks || []) {
    for (const it of b.items || []) {
      const e = getExercise(it.exerciseId);
      if (e) {
        it.name = e.name;
        it.icon = e.icon;
      }
    }
  }
  return c;
}

/** Met à jour la copie des séances planifiées à partir de `fromYmd`. Renvoie true si changement. */
export function refreshSnapshots(fromYmd) {
  let changed = false;
  for (const p of db.plan) {
    if (p.date < fromYmd) continue;
    const s = getSession(p.sessionId);
    if (!s) continue;
    const snap = resolveSession(s);
    if (JSON.stringify(snap) !== JSON.stringify(p.snapshot)) {
      p.snapshot = snap;
      changed = true;
    }
  }
  if (changed) persist('plan');
  return changed;
}

export const planFor = (date) =>
  db.plan.filter((p) => p.date === date).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));

/** Séance à afficher pour une entrée du planning. */
export function planSession(entry) {
  const s = getSession(entry.sessionId);
  if (entry.date >= todayYmd() && s) return { session: resolveSession(s), live: true, orphan: false };
  if (entry.snapshot) return { session: entry.snapshot, live: false, orphan: !s };
  if (s) return { session: resolveSession(s), live: true, orphan: false };
  return { session: { name: 'Séance supprimée', blocks: [] }, live: false, orphan: true };
}

export function addPlan(date, sessionId) {
  const s = getSession(sessionId);
  if (!s) return null;
  const e = { id: uid(), date, sessionId, order: planFor(date).length, snapshot: resolveSession(s), createdAt: Date.now() };
  db.plan.push(e);
  persist('plan');
  emit('plan');
  return e;
}
export function removePlan(id) {
  db.plan = db.plan.filter((p) => p.id !== id);
  persist('plan');
  emit('plan');
}
export function movePlan(id, date) {
  const p = db.plan.find((x) => x.id === id);
  if (!p) return;
  p.date = date;
  p.order = planFor(date).length;
  refreshSnapshots(todayYmd());
  persist('plan');
  emit('plan');
}

export function saveSettings(patch) {
  Object.assign(db.settings, patch);
  persist('settings');
  emit('settings');
}

// ---------- Export / import ----------
export function exportData({ includePlan = false } = {}) {
  const out = {
    app: 'the-coach',
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: db.settings.name || '',
    exercises: Object.values(db.exercises),
    sessions: Object.values(db.sessions),
  };
  if (includePlan) {
    out.plan = db.plan;
    out.settings = { name: db.settings.name, hyroxName: db.settings.hyroxName, hyroxDate: db.settings.hyroxDate };
  }
  return out;
}

export function importData(obj) {
  if (!obj || obj.app !== 'the-coach') throw new Error('Ce fichier n’est pas un fichier The Coach.');
  const res = { exercises: 0, sessions: 0, plan: 0 };
  res.exercises = mergeDocs('exercises', obj.exercises, { push: true });
  res.sessions = mergeDocs('sessions', obj.sessions, { push: true });
  if (Array.isArray(obj.plan)) {
    const ids = new Set(db.plan.map((p) => p.id));
    for (const p of obj.plan) {
      if (p && p.id && !ids.has(p.id)) {
        db.plan.push(p);
        res.plan++;
      }
    }
    if (res.plan) {
      refreshSnapshots(todayYmd());
      persist('plan');
      emit('plan');
    }
  }
  if (obj.settings && !db.settings.hyroxDate && obj.settings.hyroxDate) {
    saveSettings({ hyroxDate: obj.settings.hyroxDate, hyroxName: obj.settings.hyroxName || db.settings.hyroxName });
  }
  return res;
}

export function resetAll() {
  Object.values(K).forEach((k) => localStorage.removeItem(k));
}
