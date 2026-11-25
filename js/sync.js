// Synchronisation des bibliothèques communes (exercices + séances) via Firebase Firestore.
// Chemin des données : teams/{codeEquipe}/{exercises|sessions}/{id}
// Le planning reste local à chaque appareil.
import { firebaseConfig } from '../firebase-config.js';
import { db, mergeDocs, setPushHook } from './store.js';

const V = '10.12.2';
const COLLS = ['exercises', 'sessions'];

let fs = null;
let fdb = null;
let team = '';
let unsubs = [];
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

const cleanDoc = (d) => JSON.parse(JSON.stringify(d));

function push(coll, doc) {
  if (!fdb || !team) return;
  fs.setDoc(fs.doc(fdb, 'teams', team, coll, doc.id), cleanDoc(doc)).catch((e) => {
    console.error(e);
    setStatus('error', e.message);
  });
}

export function stopSync() {
  unsubs.forEach((u) => u());
  unsubs = [];
  team = '';
}

export async function startSync() {
  stopSync();
  const code = (db.settings.teamCode || '').trim();
  if (!firebaseConfig) return setStatus('off', 'Firebase non configuré');
  if (!code) return setStatus('off', 'Aucun code d’équipe');
  setStatus('connecting');
  try {
    const appMod = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
    const authMod = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
    fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
    const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
    await authMod.signInAnonymously(authMod.getAuth(app));
    if (!fdb) {
      try {
        fdb = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
      } catch {
        fdb = fs.getFirestore(app);
      }
    }
    team = code;
    setPushHook(push);
    for (const coll of COLLS) {
      let reconciled = false;
      const ref = fs.collection(fdb, 'teams', team, coll);
      const unsub = fs.onSnapshot(
        ref,
        { includeMetadataChanges: true },
        (snap) => {
          const remote = {};
          snap.docs.forEach((d) => { remote[d.id] = d.data(); });
          mergeDocs(coll, Object.values(remote));
          // Première réponse du serveur : on envoie ce qui n'existe qu'en local (ou est plus récent en local).
          if (!reconciled && !snap.metadata.fromCache) {
            reconciled = true;
            for (const local of Object.values(db[coll])) {
              const r = remote[local.id];
              if (!r || (Number(local.updatedAt) || 0) > (Number(r.updatedAt) || 0)) push(coll, local);
            }
          }
          setStatus(snap.metadata.fromCache ? 'offline' : 'online');
        },
        (err) => {
          console.error(err);
          setStatus('error', err.message);
        },
      );
      unsubs.push(unsub);
    }
  } catch (e) {
    console.error(e);
    setStatus(navigator.onLine ? 'error' : 'offline', e.message || String(e));
  }
}

/** Génère un code d'équipe difficile à deviner, à partager avec ses amis. */
export function generateTeamCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const rnd = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(rnd, (b) => alphabet[b % alphabet.length]).join('');
  return `coach-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

window.addEventListener('online', () => {
  if (state.status === 'offline' || state.status === 'error') startSync();
});
