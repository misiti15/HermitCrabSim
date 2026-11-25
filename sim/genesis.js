// Creates Day 0 of the world. Run once (scripts/genesis.js refuses to
// overwrite an existing world).
import { makeRng } from './rng.js';
import { homeTank, belowTank } from './world.js';

// Starting shells are a best guess from the photos; if you know which crab
// wears which shell, edit here BEFORE genesis is run (or use an intervention).
const FOUNDERS = [
  { name: 'Sheladon', shell: { type: 'turbo', size: 3.3 }, pos: { x: 19, y: 22 } },
  { name: 'Sheladactyl', shell: { type: 'babylon', size: 3.5 }, pos: { x: 52, y: 38 } },
  { name: 'Spike', shell: { type: 'turbo', size: 3.0 }, pos: { x: 34, y: 18 } },
  { name: 'Kyle', shell: { type: 'whelk', size: 2.8 }, pos: { x: 31, y: 19 } },
];

export function randomGenome(rng) {
  const t = () => Math.min(1, Math.max(0, rng.normal(0.5, 0.18)));
  return {
    // temperament
    boldness: t(), sociability: t(), curiosity: t(), aggression: t() * 0.8, patience: t(), playfulness: t(),
    // physiology
    brain: rng.range(0.9, 1.15),      // scales how high cognition can climb this lifetime
    plasticity: rng.range(0.85, 1.15),// how readily the body adapts at molts
    metabolism: rng.range(0.9, 1.1),
    lifespanDays: Math.round(rng.range(20, 32) * 365),
    hue: rng.range(0, 1),            // body colour: purple → red → orange
  };
}

export function newCrab({ id, name, genome, shell, pos, tank, sex, generation = 0, parents = [], day = 0, size }) {
  return {
    id, name, generation, parents, bornDay: day, tank,
    alive: true,
    sex: { value: sex, revealed: false },
    genome,
    pos: { ...pos },
    shell: shell ? { ...shell } : null,
    body: {
      size: size ?? (shell ? shell.size * 0.95 : 0.4), // ~ shell aperture the body fits, cm
      legLen: 1, clawL: 1.0, clawR: 0.7, eyeStalk: 1, antenna: 1,
      armor: 0.05,     // abdomen calcification; 1 = no longer needs a shell
      posture: 0,      // 0 sprawled → 1 upright
      dexterity: 0.1,  // claw fine control
      voice: 0,        // 0 = stridulation only → 1 = rich vocal sounds
      cranium: 0,      // visible head/brain growth
      hue: genome.hue,
    },
    needs: { hunger: 0.3, thirst: 0.3, energy: 0.7, humidity: 0.8, warmth: 0.6 },
    mood: { valence: 0.1, stress: 0.2 },
    mind: {
      neuro: 0.02 * genome.brain,
      insight: 0,
      caps: {},
      lexicon: {},          // meaning → { form, score }
      memories: [],         // { day, text, salience }
      familiarity: {},      // tankId → { cellKey: visits }
      restlessness: 0,
      thoughts: [],         // latest thoughts (from the minds step)
      focus: null,
      ideas: [],
    },
    relations: {},          // crabId → affinity (-1..1)
    molt: { stage: 'none', nextDue: null, daysIn: 0, count: 0 },
    usage: { walk: 0, climb: 0, dig: 0, build: 0, talk: 0, social: 0 },
    stats: { daysLived: 0, wordsInvented: 0, shellSwaps: 0 },
  };
}

export function createWorld({ seed = 'hermit-crab-sim', startDate, timezone = 'America/New_York' }) {
  const rng = makeRng(seed + '/genesis');
  // Sex is decided now and hidden. The founders are guaranteed not to be all
  // one sex (otherwise the lineage could never continue); which ones are which
  // stays unknown — even to the people running this — until revealed in-sim.
  let sexes;
  do { sexes = FOUNDERS.map(() => (rng.chance(0.5) ? 'F' : 'M')); } while (new Set(sexes).size < 2);

  const crabs = FOUNDERS.map((f, i) => {
    const genome = randomGenome(rng);
    const c = newCrab({ id: f.name.toLowerCase(), name: f.name, genome, shell: f.shell, pos: f.pos, tank: 'home', sex: sexes[i], size: f.shell.size * rng.range(0.85, 0.97) });
    c.molt.nextDue = Math.round(rng.range(45, 120));
    return c;
  });
  for (const a of crabs) for (const b of crabs) if (a !== b) a.relations[b.id] = rng.range(-0.05, 0.15);

  return {
    schema: 1,
    seed,
    timezone,
    genesisDate: startDate,
    lastSimulatedDate: null,
    day: -1, // index of last simulated day
    tanks: [homeTank(), belowTank()],
    crabs,
    projects: [],
    culture: { sharedWords: 0, traditions: [], ideas: [], stories: [] },
    larvae: [],
    nextAnnex: 1,
    firsts: {},
  };
}
