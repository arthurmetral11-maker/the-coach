// Annonces vocales du mode séance (synthèse vocale du navigateur, en français).
// Sur iPhone, la voix doit être « débloquée » par un premier appel pendant un appui (bouton Démarrer).
import { distText } from './format.js';

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
let voice = null;

function pickVoice() {
  if (!supported()) return;
  const all = speechSynthesis.getVoices() || [];
  const fr = all.filter((v) => /^fr/i.test(v.lang));
  voice = fr.find((v) => /fr[-_]FR/i.test(v.lang) && v.localService) || fr.find((v) => /fr[-_]FR/i.test(v.lang)) || fr[0] || null;
}
if (supported()) {
  pickVoice();
  try { speechSynthesis.addEventListener('voiceschanged', pickVoice); } catch { /* ignore */ }
}

export function say(text) {
  if (!supported() || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    if (voice) u.voice = voice;
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
/** À appeler pendant un appui de l'utilisateur. */
export function unlock() {
  if (!supported()) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
export function stop() {
  if (supported()) try { speechSynthesis.cancel(); } catch { /* ignore */ }
}
export const isSupported = supported;

// ---------------------------------------------------------------- Textes parlés
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
/** 90 -> "1 minute 30", 45 -> "45 secondes", 120 -> "2 minutes" */
export function spokenTime(sec) {
  sec = Math.round(Number(sec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${plural(h, 'heure')}${m ? ` ${m}` : ''}`;
  if (!m) return plural(s, 'seconde');
  return `${plural(m, 'minute')}${s ? ` ${s}` : ''}`;
}
export function spokenDist(m) {
  m = Math.round(Number(m) || 0);
  if (m >= 1000) {
    const km = Math.floor(m / 1000);
    const rest = m % 1000;
    return `${plural(km, 'kilomètre')}${rest ? ` ${rest}` : ''}`;
  }
  return distText(m).replace(' m', ' mètres');
}
export const spokenPace = (s) => {
  s = Math.round(Number(s) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} minute${m > 1 ? 's' : ''}${r ? ` ${r}` : ''} au kilomètre`;
};
export function spokenQty(mode, v) {
  v = Number(v) || 0;
  if (mode === 'time') return spokenTime(v);
  if (mode === 'distance') return spokenDist(v);
  if (mode === 'cal') return plural(v, 'calorie');
  return plural(v, 'répétition');
}
export const spokenLoad = (kg) => (Number(kg) > 0 ? `${String(Number(kg)).replace('.', ',')} kilos` : '');
