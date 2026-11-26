// Stockage local (localStorage, sert aussi de cache hors connexion) + règles métier.
//
// - exercises / sessions : bibliothèques COMMUNES à l'équipe (synchronisées).
// - plan / results       : données PERSONNELLES du compte (synchronisées entre ses appareils, invisibles des autres).
// Suppression = "pierre tombale" (deleted:true) pour qu'elle se propage aux autres appareils.
//
// Planning : chaque entrée référence une séance + garde une copie ("snapshot").
// Pour aujourd'hui et le futur, on affiche la séance à jour de la bibliothèque ;
// pour le passé, la copie telle qu'elle était -> une modification ne change que le futur.
import { uid, clone, todayYmd, ymd } from './utils.js';
import { SEED_VERSION, SEED_EXERCISES, SEED_SESSIONS } from './seed.js';

const K = {
  exercises: 'tc.exercises', sessions: 'tc.sessions', plan: 'tc.myplan', results: 'tc.results',
  settings: 'tc.settings', account: 'tc.account',
};
const LEGACY_PLAN = 'tc.plan'; // planning d'avant les comptes (conservé tel quel sur l'appareil)
export const COLLS = ['exercises', 'sessions', 'plan', 'results'];
const PROFILE_FIELDS = ['name', 'hyroxName', 'hyroxDate'];

export const db = { exercises: {}, sessions: {}, plan: {}, results: {}, settings: {}, account: null };

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
      alert('Stockage plein : supprimez des photos d’exercices ou des résultats anciens.');
    }
  }
}

function seed() {
  if ((db.settings.seedVersion || 0) >= SEED_VERSION) return;
  for (const e of SEED_EXERCISES) if (!db.exercises[e.id]) db.exercises[e.id] = clone(e);
  for (const s of SEED_SESSIONS) if (!db.sessions[s.id]) db.sessions[s.id] = clone(s);
  db.settings.seedVersion = SEED_VERSION;
  persist('exercises', 'sessions', 'settings');
}

export function load() {
  db.exercises = read(K.exercises, {});
  db.sessions = read(K.sessions, {});
  db.plan = read(K.plan, {});
  db.results = read(K.results, {});
  db.account = read(K.account, null);
  db.settings = Object.assign(
    { name: '', hyroxName: '', hyroxDate: '', teamCode: '', seedVersion: 0, voice: true, profileUpdatedAt: 0, owner: '', libTeam: '' },
    read(K.settings, {}),
  );
  seed();
  refreshSnapshots(todayYmd());
  try { navigator.storage?.persist?.(); } catch { /* ignore */ }
}

const alive = (o) => o && !o.deleted;
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });

export const listExercises = () => Object.values(db.exercises).filter(alive).sort(byName);
export const getExercise = (id) => (alive(db.exercises[id]) ? db.exercises[id] : null);
export const listSessions = () => Object.values(db.sessions).filter(alive).sort(byName);
export const getSession = (id) => (alive(db.sessions[id]) ? db.sessions[id] : null);

const who = () => db.settings.name || db.account?.username || '';

function stamp(doc) {
  doc.updatedAt = Date.now();
  doc.updatedBy = who();
  return doc;
}

function saveDoc(coll, doc) {
  stamp(doc);
  db[coll][doc.id] = doc;
  persist(coll);
  pushHook?.(coll, doc);
  if ((coll === 'exercises' || coll === 'sessions') && refreshSnapshots(todayYmd())) emit('plan');
  emit(coll);
}
function tombstone(coll, id) {
  if (!db[coll][id]) return;
  saveDoc(coll, { id, deleted: true });
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
    if (coll === 'exercises' || coll === 'sessions') {
      if (refreshSnapshots(minDate)) emit('plan');
    } else if (coll === 'plan') {
      refreshSnapshots(todayYmd());
    }
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
  for (const p of Object.values(db.plan)) {
    if (!alive(p) || p.date < fromYmd) continue;
    const s = getSession(p.sessionId);
    if (!s) continue;
    const snap = resolveSession(s);
    if (JSON.stringify(snap) !== JSON.stringify(p.snapshot)) {
      p.snapshot = snap;
      stamp(p);
      pushHook?.('plan', p);
      changed = true;
    }
  }
  if (changed) persist('plan');
  return changed;
}

// ---------- Planning (personnel) ----------
export const getPlan = (id) => (alive(db.plan[id]) ? db.plan[id] : null);
export const planFor = (date) =>
  Object.values(db.plan).filter((p) => alive(p) && p.date === date)
    .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));

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
  saveDoc('plan', e);
  return e;
}
export const removePlan = (id) => tombstone('plan', id);
/** Ordre personnel des exercices (Hyrox) pour cette séance planifiée. null = ordre de la séance. */
export function setPlanOrder(id, order) {
  const p = getPlan(id);
  if (!p) return;
  p.myOrder = order || null;
  saveDoc('plan', p);
}
export function movePlan(id, date) {
  const p = getPlan(id);
  if (!p) return;
  p.date = date;
  p.order = planFor(date).length;
  const s = getSession(p.sessionId);
  if (s && date >= todayYmd()) p.snapshot = resolveSession(s);
  saveDoc('plan', p);
}

// ---------- Résultats (personnels) ----------
export const getResult = (id) => (alive(db.results[id]) ? db.results[id] : null);
export const listResults = () =>
  Object.values(db.results).filter(alive).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
export const resultsFor = (sessionId) => listResults().filter((r) => r.sessionId === sessionId);
export const resultForPlan = (entryId) => entryId && listResults().find((r) => r.planEntryId === entryId);
export const saveResult = (r) => saveDoc('results', r);
export const deleteResult = (id) => tombstone('results', id);

// ---------- Réglages et profil ----------
export function saveSettings(patch) {
  Object.assign(db.settings, patch);
  const profileChanged = Object.keys(patch).some((k) => PROFILE_FIELDS.includes(k));
  if (profileChanged) {
    db.settings.profileUpdatedAt = Date.now();
    pushHook?.('profile', profileDoc());
  }
  persist('settings');
  emit('settings');
}
export function profileDoc() {
  const p = { updatedAt: db.settings.profileUpdatedAt || 0 };
  for (const k of PROFILE_FIELDS) p[k] = db.settings[k] || '';
  return p;
}
/** Profil reçu du serveur (prénom, course) : appliqué s'il est plus récent. */
export function applyProfile(remote) {
  if (!remote) return;
  if ((Number(remote.updatedAt) || 0) <= (db.settings.profileUpdatedAt || 0)) return;
  for (const k of PROFILE_FIELDS) if (remote[k] != null) db.settings[k] = remote[k];
  db.settings.profileUpdatedAt = Number(remote.updatedAt) || 0;
  persist('settings');
  emit('settings');
}

// ---------- Compte ----------
/**
 * Appelé à la connexion. Les données personnelles d'un autre compte (ou d'avant les comptes) sont effacées
 * de l'appareil ; les bibliothèques d'une autre équipe aussi.
 */
export function setAccount({ username, teamCode }) {
  const st = db.settings;
  if (st.owner !== username) {
    db.plan = {};
    db.results = {};
    for (const k of PROFILE_FIELDS) st[k] = '';
    st.profileUpdatedAt = 0;
    persist('plan', 'results');
  }
  const libTeam = st.libTeam || st.teamCode || teamCode;
  if (libTeam !== teamCode) {
    db.exercises = {};
    db.sessions = {};
    st.seedVersion = 0;
    seed();
  }
  st.owner = username;
  st.libTeam = teamCode;
  st.teamCode = teamCode;
  db.account = { username, teamCode };
  localStorage.setItem(K.account, JSON.stringify(db.account));
  persist('settings');
  emit('account');
}
/** Déconnexion : les données personnelles quittent l'appareil (elles restent dans le compte en ligne). */
export function clearAccount() {
  db.account = null;
  localStorage.removeItem(K.account);
  db.plan = {};
  db.results = {};
  for (const k of PROFILE_FIELDS) db.settings[k] = '';
  db.settings.profileUpdatedAt = 0;
  db.settings.owner = '';
  persist('plan', 'results', 'settings');
  emit('account');
}

// ---------- Export / import ----------
export function exportData({ includePlan = false } = {}) {
  const out = clone({
    app: 'the-coach',
    version: 2,
    exportedAt: new Date().toISOString(),
    exportedBy: who(),
    exercises: Object.values(db.exercises),
    sessions: Object.values(db.sessions),
  });
  if (includePlan) {
    out.plan = clone(Object.values(db.plan).filter(alive));
    out.results = clone(listResults());
    out.settings = { name: db.settings.name, hyroxName: db.settings.hyroxName, hyroxDate: db.settings.hyroxDate };
  }
  return out;
}

export function importData(obj) {
  if (!obj || obj.app !== 'the-coach') throw new Error('Ce fichier n’est pas un fichier The Coach.');
  const res = { exercises: 0, sessions: 0, plan: 0, results: 0 };
  res.exercises = mergeDocs('exercises', obj.exercises, { push: true });
  res.sessions = mergeDocs('sessions', obj.sessions, { push: true });
  if (Array.isArray(obj.plan)) res.plan = mergeDocs('plan', obj.plan.filter((p) => p && p.id && !db.plan[p.id]), { push: true });
  if (Array.isArray(obj.results)) res.results = mergeDocs('results', obj.results, { push: true });
  if (obj.settings && !db.settings.hyroxDate && obj.settings.hyroxDate) {
    saveSettings({ hyroxDate: obj.settings.hyroxDate, hyroxName: obj.settings.hyroxName || db.settings.hyroxName });
  }
  return res;
}

export function resetAll() {
  Object.values(K).forEach((k) => localStorage.removeItem(k));
  localStorage.removeItem(LEGACY_PLAN);
}
