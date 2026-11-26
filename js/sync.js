// Comptes + synchronisation Firebase.
//
// Compte : nom d'utilisateur + code à 4 chiffres (Firebase Authentication "E-mail / mot de passe" :
//   le nom devient une adresse interne nom@<authDomain>, le code devient le mot de passe).
// Données :
//   teams/{codeEquipe}/{exercises|sessions}/{id}  -> bibliothèques communes de l'équipe
//   users/{nom}                                   -> profil (prénom, course, code d'équipe)
//   users/{nom}/{plan|results}/{id}               -> planning et résultats, visibles par ce seul compte
import { firebaseConfig } from '../firebase-config.js';
import * as S from './store.js';

const V = '10.12.2';
const TEAM_COLLS = ['exercises', 'sessions'];
const USER_COLLS = ['plan', 'results'];

let mods = null;
let auth = null;
let fdb = null;
let unsubs = [];
let liveUser = '';
const state = { status: 'off', message: '' };
const listeners = new Set();

export const syncState = state;
export const isConfigured = () => !!firebaseConfig;
export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setStatus(status, message = '') {
  state.status = status;
  state.message = message;
  listeners.forEach((f) => f(state));
}

// ---------------------------------------------------------------- Identifiants
/** "Arthur M." -> "arthur-m" (lettres sans accent, chiffres, . - _) */
export function normUser(u) {
  return String(u || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 24);
}
const emailOf = (u) => `${u}@${firebaseConfig.authDomain}`;
const pwdOf = (pin) => `tc-${pin}-coach`;
export const PIN_RE = /^\d{4}$/;

const ERRORS = {
  'auth/invalid-credential': 'Nom d’utilisateur ou code incorrect.',
  'auth/wrong-password': 'Nom d’utilisateur ou code incorrect.',
  'auth/user-not-found': 'Nom d’utilisateur ou code incorrect.',
  'auth/invalid-login-credentials': 'Nom d’utilisateur ou code incorrect.',
  'auth/email-already-in-use': 'Ce nom d’utilisateur est déjà pris.',
  'auth/too-many-requests': 'Trop d’essais. Réessaie dans quelques minutes.',
  'auth/network-request-failed': 'Pas de connexion internet.',
  'auth/operation-not-allowed': 'La connexion « E-mail / mot de passe » n’est pas activée dans Firebase (voir README).',
  'auth/weak-password': 'Code refusé par Firebase.',
  'permission-denied': 'Accès refusé par les règles Firestore (voir README).',
};
export function errorText(e) {
  return ERRORS[e?.code] || e?.message || String(e);
}
function fail(code, message) {
  const e = new Error(message || ERRORS[code] || code);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------- Initialisation
async function init() {
  if (mods) return mods;
  if (!firebaseConfig) throw fail('no-config', 'Firebase n’est pas configuré.');
  const [appMod, authMod, fs] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
  auth = authMod.getAuth(app);
  try {
    fdb = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
  } catch {
    fdb = fs.getFirestore(app);
  }
  mods = { authMod, fs };
  return mods;
}

const cleanDoc = (d) => JSON.parse(JSON.stringify(d));

function refFor(coll, id) {
  const { fs } = mods;
  const acc = S.db.account;
  if (TEAM_COLLS.includes(coll)) return fs.doc(fdb, 'teams', acc.teamCode, coll, id);
  return fs.doc(fdb, 'users', acc.username, coll, id);
}

function push(coll, doc) {
  if (!mods || !liveUser || !S.db.account) return;
  const { fs } = mods;
  const p = coll === 'profile'
    ? fs.setDoc(fs.doc(fdb, 'users', S.db.account.username), cleanDoc(doc), { merge: true })
    : fs.setDoc(refFor(coll, doc.id), cleanDoc(doc));
  p.catch((e) => {
    console.error(e);
    setStatus('error', errorText(e));
  });
}

// ---------------------------------------------------------------- Écoute en temps réel
function stopListeners() {
  unsubs.forEach((u) => u());
  unsubs = [];
  liveUser = '';
}

function startListeners() {
  stopListeners();
  const { fs } = mods;
  const { username, teamCode } = S.db.account;
  liveUser = username;
  S.setPushHook(push);
  setStatus('connecting');

  const pending = new Set([...TEAM_COLLS, ...USER_COLLS]);
  const listen = (coll, ref) => {
    let reconciled = false;
    const unsub = fs.onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        const remote = {};
        snap.docs.forEach((d) => { remote[d.id] = d.data(); });
        S.mergeDocs(coll, Object.values(remote));
        // Première réponse du serveur : on envoie ce qui n'existe qu'en local (ou est plus récent en local).
        if (!reconciled && !snap.metadata.fromCache) {
          reconciled = true;
          for (const local of Object.values(S.db[coll])) {
            const r = remote[local.id];
            if (!r || (Number(local.updatedAt) || 0) > (Number(r.updatedAt) || 0)) push(coll, local);
          }
        }
        if (!snap.metadata.fromCache) pending.delete(coll);
        setStatus(snap.metadata.fromCache ? 'offline' : pending.size ? 'connecting' : 'online');
      },
      (err) => {
        console.error(coll, err);
        setStatus('error', errorText(err));
      },
    );
    unsubs.push(unsub);
  };
  TEAM_COLLS.forEach((c) => listen(c, fs.collection(fdb, 'teams', teamCode, c)));
  USER_COLLS.forEach((c) => listen(c, fs.collection(fdb, 'users', username, c)));
  unsubs.push(fs.onSnapshot(fs.doc(fdb, 'users', username), (snap) => {
    if (snap.exists()) S.applyProfile(snap.data());
  }, (err) => console.error('profil', err)));
}

/**
 * Au démarrage, si un compte est mémorisé sur l'appareil : reprend la session Firebase et lance la synchro.
 * `onSignedOut` est appelé si la session n'est plus valide (compte supprimé, autre appareil…).
 */
export async function resume(onSignedOut) {
  if (!S.db.account) return;
  setStatus('connecting');
  try {
    await init();
  } catch (e) {
    console.error(e);
    setStatus(navigator.onLine ? 'error' : 'offline', errorText(e));
    return;
  }
  mods.authMod.onAuthStateChanged(auth, (user) => {
    const acc = S.db.account;
    if (!acc) return;
    if (user && user.email === emailOf(acc.username)) {
      if (liveUser !== acc.username) startListeners();
    } else if (!user) {
      stopListeners();
      setStatus('off');
      onSignedOut?.();
    }
  });
}

// ---------------------------------------------------------------- Compte
async function teamExists(code) {
  const { fs } = mods;
  const q = fs.query(fs.collection(fdb, 'teams', code, 'exercises'), fs.limit(1));
  const snap = await fs.getDocsFromServer(q);
  return !snap.empty;
}

/** Connexion. Renvoie le profil. */
export async function signIn(rawUser, pin) {
  const username = normUser(rawUser);
  if (!username || !PIN_RE.test(pin)) throw fail('input', 'Saisis ton nom d’utilisateur et ton code à 4 chiffres.');
  await init();
  const { authMod, fs } = mods;
  await authMod.signInWithEmailAndPassword(auth, emailOf(username), pwdOf(pin));
  const snap = await fs.getDocFromServer(fs.doc(fdb, 'users', username));
  const prof = snap.exists() ? snap.data() : null;
  if (!prof?.teamCode) {
    await authMod.signOut(auth);
    throw fail('no-profile', 'Ce compte n’a pas de profil. Recrée-le avec « Créer un compte ».');
  }
  S.setAccount({ username, teamCode: prof.teamCode });
  S.applyProfile(prof);
  startListeners();
  return prof;
}

/**
 * Création de compte. `team` = code d'équipe existant (invitation) ou null pour créer une nouvelle équipe.
 * Si un profil existe déjà pour ce nom (compte supprimé dans Firebase après un code oublié),
 * il est repris : planning et résultats sont retrouvés.
 */
export async function signUp(rawUser, pin, team, firstName) {
  const username = normUser(rawUser);
  if (username.length < 2) throw fail('input', 'Nom d’utilisateur trop court (2 caractères minimum).');
  if (!PIN_RE.test(pin)) throw fail('input', 'Le code doit faire exactement 4 chiffres.');
  await init();
  const { authMod, fs } = mods;
  const cred = await authMod.createUserWithEmailAndPassword(auth, emailOf(username), pwdOf(pin));
  try {
    const ref = fs.doc(fdb, 'users', username);
    const old = await fs.getDocFromServer(ref);
    let prof;
    if (old.exists() && old.data().teamCode) {
      prof = old.data();
    } else {
      let teamCode = (team || '').trim();
      if (teamCode) {
        if (!(await teamExists(teamCode))) throw fail('bad-team', 'Code d’équipe inconnu. Vérifie-le auprès de la personne qui t’a invité.');
      } else {
        teamCode = generateTeamCode();
      }
      prof = {
        username, teamCode, name: firstName || rawUser.trim(), hyroxName: '', hyroxDate: '',
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await fs.setDoc(ref, prof);
    }
    S.setAccount({ username, teamCode: prof.teamCode });
    S.applyProfile(prof);
    startListeners();
    return prof;
  } catch (e) {
    try { await cred.user.delete(); } catch { /* ignore */ }
    throw e;
  }
}

export async function signOut() {
  stopListeners();
  S.setPushHook(null);
  try {
    await init();
    await mods.authMod.signOut(auth);
  } catch (e) { console.error(e); }
  S.clearAccount();
  setStatus('off');
}

export async function changePin(oldPin, newPin) {
  if (!PIN_RE.test(newPin)) throw fail('input', 'Le nouveau code doit faire exactement 4 chiffres.');
  await init();
  const { authMod } = mods;
  const user = auth.currentUser;
  if (!user) throw fail('auth/network-request-failed');
  const cred = authMod.EmailAuthProvider.credential(user.email, pwdOf(oldPin));
  await authMod.reauthenticateWithCredential(user, cred);
  await authMod.updatePassword(user, pwdOf(newPin));
}

/** Génère un code d'équipe difficile à deviner, à partager avec ses amis. */
export function generateTeamCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const rnd = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(rnd, (b) => alphabet[b % alphabet.length]).join('');
  return `coach-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

window.addEventListener('online', () => {
  if (S.db.account && (state.status === 'offline' || state.status === 'error') && !mods) resume();
});
