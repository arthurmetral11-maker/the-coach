// Données de départ : les 8 stations Hyrox + la course (charges Hyrox Open Homme), et 2 séances exemples.
// Les identifiants sont fixes : chaque appareil crée les mêmes, la synchro ne crée donc pas de doublons.

export const SEED_VERSION = 1;

const ex = (id, name, icon, mode, value, load = 0, note = '') => ({
  id, name, icon, image: '', mode, value, load, note, updatedAt: 1, updatedBy: '',
});

export const SEED_EXERCISES = [
  ex('seed-run', 'Run', '\u{1F3C3}', 'distance', 1000),
  ex('seed-skierg', 'SkiErg', '⛷️', 'distance', 1000),
  ex('seed-sledpush', 'Sled Push', '\u{1F6F7}', 'distance', 50, 152, 'Charge totale du traîneau (Open Homme)'),
  ex('seed-sledpull', 'Sled Pull', '\u{1FAA2}', 'distance', 50, 103, 'Charge totale du traîneau (Open Homme)'),
  ex('seed-bbj', 'Burpee Broad Jumps', '\u{1F438}', 'distance', 80),
  ex('seed-row', 'Rowing', '\u{1F6A3}', 'distance', 1000),
  ex('seed-farmers', 'Farmers Carry', '\u{1F9F3}', 'distance', 200, 24, 'Charge par main (2 × 24 kg)'),
  ex('seed-lunges', 'Sandbag Lunges', '\u{1F392}', 'distance', 100, 20),
  ex('seed-wallballs', 'Wall Balls', '\u{1F3D0}', 'reps', 100, 6),
];

const it = (id, exerciseId, mode, value, load = 0, restAfter = 0) => {
  const e = SEED_EXERCISES.find((x) => x.id === exerciseId);
  return { id, exerciseId, name: e.name, icon: e.icon, mode, value, load, restAfter, perSet: [] };
};

const simItems = [];
const stations = [
  ['seed-skierg', 'distance', 1000, 0],
  ['seed-sledpush', 'distance', 50, 152],
  ['seed-sledpull', 'distance', 50, 103],
  ['seed-bbj', 'distance', 80, 0],
  ['seed-row', 'distance', 1000, 0],
  ['seed-farmers', 'distance', 200, 24],
  ['seed-lunges', 'distance', 100, 20],
  ['seed-wallballs', 'reps', 100, 6],
];
stations.forEach(([id, mode, v, l], i) => {
  simItems.push(it(`seed-sim-run${i}`, 'seed-run', 'distance', 1000));
  simItems.push(it(`seed-sim-st${i}`, id, mode, v, l));
});

export const SEED_SESSIONS = [
  {
    id: 'seed-session-engine',
    name: 'The Engine',
    tag: 'Hyrox',
    notes: '',
    updatedAt: 1,
    updatedBy: '',
    blocks: [
      {
        id: 'seed-engine-b1', type: 'wod', format: 'rounds', rounds: 5, timeCap: 40, duration: 12, interval: 60,
        restBetween: 0, restAfter: 0, variable: false, sets: 1,
        items: [
          it('seed-engine-i1', 'seed-run', 'distance', 600),
          it('seed-engine-i2', 'seed-wallballs', 'reps', 50, 6),
          it('seed-engine-i3', 'seed-lunges', 'reps', 40, 20),
          it('seed-engine-i4', 'seed-bbj', 'reps', 30),
        ],
      },
    ],
  },
  {
    id: 'seed-session-simulation',
    name: 'Simulation Hyrox',
    tag: 'Hyrox',
    notes: 'Course complète : 8 × (1 km + station).',
    updatedAt: 1,
    updatedBy: '',
    blocks: [
      {
        id: 'seed-sim-b1', type: 'wod', format: 'fortime', rounds: 1, timeCap: 0, duration: 12, interval: 60,
        restBetween: 0, restAfter: 0, variable: false, sets: 1,
        items: simItems,
      },
    ],
  },
];

export const ICONS = [
  '\u{1F3C3}', '⛷️', '\u{1F6F7}', '\u{1FAA2}', '\u{1F438}', '\u{1F6A3}', '\u{1F9F3}', '\u{1F392}', '\u{1F3D0}',
  '\u{1F3CB}️', '\u{1F4AA}', '\u{1F9B5}', '\u{1F938}', '\u{1F6B4}', '\u{1F3CA}', '\u{1F9D8}', '\u{1F94A}', '\u{1FA9C}',
  '⏱️', '\u{1F525}', '\u{1F3AF}', '\u{1F998}', '\u{1F9D7}', '⚡', '\u{1FAC0}', '\u{1F9BE}', '\u{1FAA8}',
  '\u{1F3C5}', '\u{1F9F1}', '⛹️', '\u{1F93C}', '\u{1F6F6}', '\u{1F45F}', '⚖️', '\u{1F300}', '\u{1F4A5}',
];
