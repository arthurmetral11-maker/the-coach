// Mode séance : suivi pas à pas, chrono, minuteurs, alarmes sonores, mesure des temps.
//
// - Exercices aux répétitions / distance / calories : bouton « Suivant ».
// - Exercices au temps, repos, préparation, AMRAP, EMOM : enchaînement automatique à la fin du décompte.
// - Préparation (10 s par défaut, réglable) avant chaque exercice, sauf si un repos est déjà programmé
//   juste avant, et jamais à l'intérieur d'un WOD (le chrono y tourne en continu).
// - Bips sur les 5 dernières secondes de chaque décompte.
import { esc, fmtClock, fmtShortTime, uid, ymd } from './utils.js';
import { valueShort, blockHeader, loadText } from './format.js';
import { getExercise } from './store.js';

// ---------------------------------------------------------------- Son
let actx = null;
function ensureAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'; // iPhone : son même en mode silencieux (si supporté)
  } catch { /* ignore */ }
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
  }
  if (actx.state === 'suspended') actx.resume();
  // "Déverrouille" l'audio sur iOS avec un son muet.
  const b = actx.createBuffer(1, 1, 22050);
  const s = actx.createBufferSource();
  s.buffer = b;
  s.connect(actx.destination);
  s.start(0);
}
function beep(freq = 880, dur = 0.15, delay = 0, vol = 0.5) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const tick = () => beep(660, 0.12, 0, 0.35);
function goBeep() {
  beep(1320, 0.55, 0, 0.55);
  try { navigator.vibrate?.(400); } catch { /* ignore */ }
}
function alarm() {
  beep(880, 0.18, 0);
  beep(880, 0.18, 0.25);
  beep(880, 0.18, 0.5);
  beep(1320, 0.7, 0.8);
  try { navigator.vibrate?.([300, 120, 300, 120, 600]); } catch { /* ignore */ }
}
const BEEP_SECONDS = 5;

// ---------------------------------------------------------------- Construction des étapes
export function buildSteps(session, { transition = 10 } = {}) {
  const T = Math.max(0, Math.round(Number(transition) || 0));
  const steps = [];
  const blocks = session.blocks || [];
  const prep = (bi, b) => {
    const prev = steps[steps.length - 1];
    if (T > 0 && (!prev || prev.kind !== 'rest')) steps.push({ kind: 'prep', bi, block: b, duration: T, label: 'Préparation' });
  };
  blocks.forEach((b, bi) => {
    const work = (it, v, label) => steps.push({
      kind: 'work', bi, block: b, item: it, mode: it.mode, value: Number(v.value) || 0, load: Number(v.load) || 0, label,
    });
    const rest = (duration, label, after = false) => {
      if (Number(duration) > 0) steps.push({ kind: 'rest', bi, block: b, duration: Number(duration), label, after });
    };

    if (b.type === 'sets') {
      const it = b.items?.[0];
      if (!it) return;
      const n = Math.max(1, Number(b.sets) || 1);
      for (let s = 0; s < n; s++) {
        const v = b.variable && it.perSet?.[s] ? it.perSet[s] : it;
        prep(bi, b);
        work(it, v, `Série ${s + 1}/${n}`);
        if (s < n - 1) rest(b.restBetween, 'Récup entre séries');
      }
    } else if (b.format === 'amrap') {
      if (!b.items?.length) return;
      prep(bi, b);
      steps.push({ kind: 'amrap', bi, block: b, duration: (Number(b.duration) || 1) * 60, label: `AMRAP ${b.duration} min` });
    } else if (b.format === 'emom') {
      if (!b.items?.length) return;
      prep(bi, b);
      steps.push({ kind: 'emom', bi, block: b, duration: (Number(b.duration) || 1) * 60, interval: Number(b.interval) || 60, label: blockHeader(b) });
    } else {
      const items = b.items || [];
      if (!items.length) return;
      const R = Math.max(1, Number(b.rounds) || 1);
      prep(bi, b);
      for (let r = 0; r < R; r++) {
        items.forEach((it, i) => {
          work(it, it, `Tour ${r + 1}/${R} · ${i + 1}/${items.length}`);
          const lastInRound = i === items.length - 1;
          if (Number(it.restAfter) > 0 && !(lastInRound && (r === R - 1 || Number(b.restBetween) > 0))) rest(it.restAfter, 'Repos');
        });
        if (r < R - 1) rest(b.restBetween, 'Récup entre tours');
      }
    }
    if (bi < blocks.length - 1) rest(b.restAfter, 'Repos avant le bloc suivant', true);
  });
  let n = 0;
  steps.forEach((s) => { if (s.kind !== 'rest' && s.kind !== 'prep') s.no = ++n; });
  steps.total = n;
  return steps;
}

const isTimed = (s) => s && (s.kind === 'rest' || s.kind === 'prep' || s.kind === 'amrap' || s.kind === 'emom' || (s.kind === 'work' && s.mode === 'time'));
const stepDuration = (s) => (s.kind === 'work' ? s.value : s.duration);
const isEffort = (s) => s && (s.kind === 'work' || s.kind === 'amrap' || s.kind === 'emom');

function stepShort(s) {
  if (!s) return 'Fin de la séance';
  if (s.kind === 'rest') return `Repos ${fmtShortTime(s.duration)}`;
  if (s.kind === 'prep') return `Préparation ${fmtShortTime(s.duration)}`;
  if (s.kind === 'amrap' || s.kind === 'emom') return s.label;
  const l = loadText(s.load);
  return `${valueShort(s.mode, s.value)} ${s.item.name.toUpperCase()}${l ? ` · ${l}` : ''}`;
}

// ---------------------------------------------------------------- Lecteur
/**
 * @param session séance (résolue) à jouer
 * @param opts {transition (s), planEntryId, onEnd(result|null)}
 */
export function openPlayer(session, opts = {}) {
  const steps = buildSteps(session, { transition: opts.transition });
  const root = document.getElementById('player-root');
  const el = document.createElement('div');
  el.className = 'player';
  root.innerHTML = '';
  root.appendChild(el);
  document.body.style.overflow = 'hidden';

  const st = {
    idx: -1, started: false, done: false, paused: false, pausedAt: 0,
    startedAt: 0, stepStart: 0, blockStart: {}, fired: new Set(), capFired: new Set(), amrapRounds: 0,
    times: [], rounds: {},
  };
  let timer = null;
  let wakeLock = null;

  const now = () => Date.now();
  const clockNow = () => (st.paused ? st.pausedAt : now());
  const elapsedStep = () => (clockNow() - st.stepStart) / 1000;
  const elapsedTotal = () => st.times.reduce((a, t) => a + (t || 0), 0) + (st.idx >= 0 && !st.done ? elapsedStep() : 0);

  async function lockScreen() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  }
  const onVis = () => { if (document.visibilityState === 'visible' && st.started && !st.done) lockScreen(); };
  document.addEventListener('visibilitychange', onVis);
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); act('next'); }
    else if (e.key === 'ArrowLeft') act('prev');
    else if (e.key === ' ') { e.preventDefault(); act('pause'); }
    else if (e.key === 'Escape') act('close');
  };
  document.addEventListener('keydown', onKey);

  function close(result = null) {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('keydown', onKey);
    try { wakeLock?.release(); } catch { /* ignore */ }
    el.remove();
    document.body.style.overflow = '';
    opts.onEnd?.(result);
  }

  /** Clôt le temps de l'étape en cours (à l'instant `at`). */
  function closeStep(at) {
    if (st.idx < 0 || st.idx >= steps.length) return;
    const sec = Math.max(0, ((st.paused ? st.pausedAt : at) - st.stepStart) / 1000);
    st.times[st.idx] = (st.times[st.idx] || 0) + sec;
    if (steps[st.idx].kind === 'amrap') st.rounds[st.idx] = st.amrapRounds;
  }

  function goTo(i, at = now()) {
    closeStep(at);
    st.idx = i;
    st.stepStart = at;
    if (st.paused) st.pausedAt = at;
    st.fired = new Set();
    st.amrapRounds = st.rounds[i] || 0;
    el.classList.remove('alarm');
    if (i >= steps.length) {
      st.done = true;
      clearInterval(timer);
      alarm();
      finish(true);
      return;
    }
    const s = steps[i];
    if (st.blockStart[s.bi] == null && s.kind !== 'prep') st.blockStart[s.bi] = at;
    draw();
    update();
  }

  // ---------- Résultat
  function buildResult(complete) {
    const entries = [];
    const blocks = [];
    steps.forEach((s, i) => {
      const sec = st.times[i];
      if (sec == null) return;
      const base = { bi: s.bi, label: s.label, sec: Math.round(sec) };
      if (s.kind === 'work') {
        entries.push({
          k: 'work', ...base, exerciseId: s.item.exerciseId || '', name: s.item.name, icon: s.item.icon || '',
          mode: s.mode, value: s.value, load: s.load,
        });
      } else if (s.kind === 'amrap') entries.push({ k: 'amrap', ...base, rounds: st.rounds[i] || 0 });
      else if (s.kind === 'emom') entries.push({ k: 'emom', ...base });
      if (s.kind !== 'prep' && !s.after) {
        let blk = blocks.find((x) => x.bi === s.bi);
        if (!blk) blocks.push((blk = { bi: s.bi, header: s.block.type === 'sets' ? '' : blockHeader(s.block), sec: 0 }));
        blk.sec += sec;
      }
    });
    blocks.forEach((b) => { b.sec = Math.round(b.sec); });
    const total = Math.round(st.times.reduce((a, t) => a + (t || 0), 0));
    const effort = entries.reduce((a, e) => a + e.sec, 0);
    return {
      id: uid(),
      sessionId: session.id || '',
      sessionName: session.name || 'Séance',
      planEntryId: opts.planEntryId || '',
      date: ymd(new Date(st.startedAt)),
      startedAt: st.startedAt,
      endedAt: now(),
      complete,
      total,
      effort,
      rest: Math.max(0, total - effort),
      rpe: null,
      note: '',
      entries,
      blocks,
      snapshot: JSON.parse(JSON.stringify(session)),
    };
  }

  function finish(complete) {
    const r = buildResult(complete);
    close(r.entries.length ? r : null);
  }

  function act(a) {
    if (a === 'close') {
      if (!st.started || st.done) { close(null); return; }
      if (!confirm('Arrêter la séance ?')) return;
      closeStep(now());
      st.idx = steps.length; // plus de temps compté
      st.done = true;
      const anyDone = steps.some((s, i) => isEffort(s) && st.times[i] != null);
      if (anyDone && confirm('Enregistrer les exercices déjà faits ? (séance marquée « incomplète »)')) {
        const r = buildResult(false);
        close(r);
      } else {
        close(null);
      }
      return;
    }
    if (a === 'start') {
      ensureAudio();
      lockScreen();
      st.started = true;
      st.startedAt = now();
      timer = setInterval(update, 200);
      goTo(0);
      return;
    }
    if (!st.started || st.done) return;
    if (a === 'next') { goBeep(); goTo(st.idx + 1); }
    if (a === 'prev') goTo(Math.max(0, st.idx - 1));
    if (a === 'pause') {
      if (st.paused) {
        const d = now() - st.pausedAt;
        st.stepStart += d;
        Object.keys(st.blockStart).forEach((k) => { st.blockStart[k] += d; });
        st.paused = false;
      } else {
        st.paused = true;
        st.pausedAt = now();
      }
      draw();
      update();
    }
    if (a === 'r+') { st.amrapRounds++; draw(); update(); }
    if (a === 'r-') { st.amrapRounds = Math.max(0, st.amrapRounds - 1); draw(); update(); }
  }

  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a) act(a);
  });

  const top = () => `
    <div class="p-top">
      <button class="btn btn-icon" data-a="close" aria-label="Fermer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <span class="p-session">${esc(session.name || 'Séance')}</span>
      <span class="p-total" data-total>${st.started ? fmtClock(elapsedTotal()) : ''}</span>
    </div>
    <div class="p-progress"><i style="width:${steps.length ? Math.round((Math.max(0, st.idx) / steps.length) * 100) : 0}%"></i></div>`;

  const controls = (s) => `
    <div class="p-controls">
      <button class="btn" data-a="prev" ${st.idx <= 0 ? 'disabled' : ''} aria-label="Précédent">←</button>
      <button class="btn" data-a="pause">${st.paused ? '▶' : '❚❚'}</button>
      <button class="btn btn-primary" data-a="next">${st.idx >= steps.length - 1 ? 'Terminer ✔' : s.kind === 'prep' ? 'Go →' : isTimed(s) ? 'Passer →' : 'Suivant →'}</button>
    </div>`;

  function draw() {
    const cur = steps[st.idx];
    el.classList.toggle('rest', !st.done && cur?.kind === 'rest');
    el.classList.toggle('prep', !st.done && cur?.kind === 'prep');
    if (!st.started) {
      const T = Math.max(0, Math.round(Number(opts.transition) || 0));
      el.innerHTML = `${top()}
        <div class="p-body">
          <div class="kicker">Prêt ?</div>
          <div class="outline p-stepno">${String(steps.total || 0).padStart(2, '0')}</div>
          <div class="title-caps" style="font-size:22px">${esc(session.name || '')}</div>
          <hr class="p-rule">
          <div class="p-items">${(session.blocks || []).map((b) => `<div><b>${esc(b.type === 'sets' ? `${b.sets}×` : blockHeader(b))}</b> ${esc((b.items || []).map((it) => it.name).join(' · '))}</div>`).join('')}</div>
          <p class="small muted">Gardez le son activé. Les exercices au temps, les repos et les préparations${T ? ` (${T} s)` : ''} s’enchaînent tout seuls ; pour les autres, appuyez sur « Suivant ».</p>
        </div>
        <div class="p-controls" style="grid-template-columns:1fr"><button class="btn btn-primary" data-a="start" ${steps.length ? '' : 'disabled'}>▶ Démarrer</button></div>`;
      return;
    }
    if (st.done) return;
    const s = cur;
    const next = steps[st.idx + 1];
    const b = s.block;
    const blockTitle = b.type === 'sets' ? 'SÉRIES' : blockHeader(b);
    const cap = (b.format === 'rounds' || b.format === 'fortime') && Number(b.timeCap) > 0 ? Number(b.timeCap) * 60 : 0;
    const hasBlockClock = b.type !== 'sets' && (b.format === 'rounds' || b.format === 'fortime');
    let body = '';

    if (s.kind === 'rest') {
      body = `
        <div class="kicker">${esc(s.label)}</div>
        <div class="title-caps" style="font-size:42px;letter-spacing:.1em">REPOS</div>
        <hr class="p-rule">
        <div class="p-timer" data-timer></div>
        <div class="p-next">Ensuite : <b>${esc(stepShort(next))}</b></div>`;
    } else if (s.kind === 'prep') {
      body = `
        <div class="kicker">Préparation · ensuite</div>
        <div class="p-prep-next">${esc(stepShort(next))}</div>
        <hr class="p-rule">
        <div class="p-timer" data-timer></div>
        <div class="p-next">${next?.kind === 'work' ? esc(next.label) : ''}</div>`;
    } else if (s.kind === 'work') {
      const ex = getExercise(s.item.exerciseId);
      const img = ex?.image ? `<img class="p-ex-img" src="${ex.image}" alt="">` : `<span style="font-size:56px">${esc(s.item.icon || '')}</span>`;
      const l = loadText(s.load);
      body = `
        <div class="p-label"><span class="outline p-stepno">${String(s.no).padStart(2, '0')}</span><span class="title-caps" style="text-align:right">${esc(blockTitle)}<br><span class="muted small">${esc(s.label)}</span></span></div>
        <hr class="p-rule">
        <div class="p-main">${img}<span class="n">${esc(valueShort(s.mode, s.value))}</span><span class="nm">${esc(s.item.name)}</span></div>
        <div class="p-sub">${l ? `<span class="pill">${esc(l)}</span>` : ''}${cap ? `<span class="pill">TIME CAP ${b.timeCap} MIN</span>` : ''}${hasBlockClock ? '<span class="pill soft" data-block></span>' : ''}</div>
        <div class="p-timer ${s.mode === 'time' ? '' : 'small'}" data-timer></div>
        <div class="p-next">Ensuite : <b>${esc(stepShort(next))}</b></div>`;
    } else if (s.kind === 'amrap') {
      body = `
        <div class="p-label"><span class="outline p-stepno">${String(s.no).padStart(2, '0')}</span><span class="title-caps" style="text-align:right">${esc(s.label)}</span></div>
        <hr class="p-rule">
        <div class="p-timer" data-timer></div>
        <div class="p-items">${b.items.map((it) => `<div><b>${esc(valueShort(it.mode, it.value))}</b>${esc(it.name)}${loadText(it.load) ? ` <span class="muted">${esc(loadText(it.load))}</span>` : ''}</div>`).join('')}</div>
        <div class="counter"><span class="kicker">Tours</span><button class="btn btn-icon" data-a="r-">−</button><span class="val">${st.amrapRounds}</span><button class="btn btn-icon btn-primary" data-a="r+">+</button></div>
        <div class="p-next">Ensuite : <b>${esc(stepShort(next))}</b></div>`;
    } else if (s.kind === 'emom') {
      body = `
        <div class="p-label"><span class="outline p-stepno">${String(s.no).padStart(2, '0')}</span><span class="title-caps" style="text-align:right">${esc(s.label)}<br><span class="muted small" data-emin></span></span></div>
        <hr class="p-rule">
        <div class="p-timer" data-timer></div>
        <div class="p-items" data-emitems>${b.items.map((it, i) => `<div data-ei="${i}"><b>${esc(valueShort(it.mode, it.value))}</b>${esc(it.name)}${loadText(it.load) ? ` <span class="muted">${esc(loadText(it.load))}</span>` : ''}</div>`).join('')}</div>
        <div class="small muted" data-etotal></div>
        <div class="p-next">Ensuite : <b>${esc(stepShort(next))}</b></div>`;
    }
    el.innerHTML = `${top()}<div class="p-body">${body}${st.paused ? '<div class="pill solid" style="align-self:flex-start">EN PAUSE</div>' : ''}</div>${controls(s)}`;
  }

  /** Bips des 5 dernières secondes d'un décompte (clé unique par seconde). */
  function countdownBeeps(rem, key = '') {
    const sec = Math.ceil(rem);
    if (sec >= 1 && sec <= BEEP_SECONDS && rem > 0.05 && !st.fired.has(`${key}${sec}`)) {
      st.fired.add(`${key}${sec}`);
      tick();
    }
  }

  function update() {
    if (!st.started || st.done) return;
    // Enchaînement automatique (boucle : rattrape les étapes écoulées si l'écran était en veille).
    for (let guard = 0; guard < steps.length && !st.paused; guard++) {
      const s = steps[st.idx];
      if (!s || !isTimed(s)) break;
      const dur = stepDuration(s);
      if (elapsedStep() < dur) break;
      goBeep();
      goTo(st.idx + 1, st.stepStart + dur * 1000);
      if (st.done) return;
    }

    const totalEl = el.querySelector('[data-total]');
    if (totalEl) totalEl.textContent = fmtClock(elapsedTotal());
    const s = steps[st.idx];
    if (!s) return;
    const e = elapsedStep();
    const tEl = el.querySelector('[data-timer]');
    const b = s.block;

    // Chrono de bloc + time cap (Rounds / For time)
    if (b.type !== 'sets' && (b.format === 'rounds' || b.format === 'fortime') && st.blockStart[s.bi] != null && s.kind !== 'prep') {
      const be = (clockNow() - st.blockStart[s.bi]) / 1000;
      const blEl = el.querySelector('[data-block]');
      if (blEl) blEl.textContent = `BLOC ${fmtClock(be)}`;
      const cap = Number(b.timeCap) * 60;
      if (cap > 0 && be >= cap) {
        if (!st.capFired.has(s.bi)) {
          st.capFired.add(s.bi);
          alarm();
          el.classList.add('alarm');
        }
        if (blEl) blEl.textContent = 'TIME CAP ATTEINT';
      }
    }

    if (s.kind === 'emom') {
      const iv = s.interval;
      const total = s.duration;
      const k = Math.min(Math.floor(e / iv), Math.ceil(total / iv) - 1);
      const inRem = Math.max(0, Math.min(iv, total - k * iv) - (e - k * iv));
      if (tEl) tEl.textContent = fmtClock(Math.ceil(inRem));
      const nItems = b.items.length;
      el.querySelectorAll('[data-ei]').forEach((d) => d.classList.toggle('cur', +d.dataset.ei === k % nItems));
      const em = el.querySelector('[data-emin]');
      if (em) em.textContent = `Intervalle ${k + 1}/${Math.ceil(total / iv)}`;
      const et = el.querySelector('[data-etotal]');
      if (et) et.textContent = `Temps restant total : ${fmtClock(Math.max(0, Math.ceil(total - e)))}`;
      if (k > 0 && !st.fired.has(`go${k}`)) { st.fired.add(`go${k}`); goBeep(); }
      countdownBeeps(inRem, `${k}-`);
      return;
    }

    if (isTimed(s)) {
      const rem = stepDuration(s) - e;
      if (tEl) tEl.textContent = fmtClock(Math.ceil(Math.max(0, rem)));
      countdownBeeps(rem);
    } else if (tEl) {
      tEl.textContent = fmtClock(e);
    }
  }

  draw();
}
