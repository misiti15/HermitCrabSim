// The physical world: tanks, objects, shells, and the capability ladder.
// Coordinates are centimetres on the tank floor, viewed from above.
// x = 0 at the left glass (as seen from the front), y = 0 at the back glass.

export const TANK_W = 60;
export const TANK_H = 45;

// ---- Tank 1 — "Home", laid out from the three reference photos -------------
export function homeTank() {
  return {
    id: 'home',
    name: 'Home Tank',
    crabName: null, // the crabs may name it themselves one day
    w: TANK_W,
    h: TANK_H,
    discoveredDay: 0,
    substrate: 'sand',
    objects: [
      { id: 'coconut', kind: 'coconut-hut', x: 12, y: 12, r: 8, hide: true, label: 'Coconut hut' },
      { id: 'moss', kind: 'moss-path', label: 'Moss trail', points: [[24, 9], [29, 18], [33, 24], [40, 26], [47, 29]], branch: [[33, 24], [27, 32], [22, 36]] },
      { id: 'food', kind: 'food-pile', x: 45, y: 19, r: 3.5, label: 'Pellet pile' },
      { id: 'sponge', kind: 'sponge', x: 53, y: 23, r: 3.2, label: 'Sea sponge' },
      { id: 'dish', kind: 'water-dish', x: 43, y: 33, r: 5, water: 'fresh', label: 'Water dish' },
      { id: 'frag1', kind: 'shell-fragment', x: 22, y: 24, r: 1.8, label: 'Shell fragment' },
      { id: 'lamp1', kind: 'heat-lamp', x: 31, y: 3, r: 11, label: 'Heat lamp' },
      { id: 'lamp2', kind: 'heat-lamp', x: 46, y: 3, r: 11, label: 'Heat lamp' },
      { id: 'cordport', kind: 'cord-port', x: 55, y: 1, r: 2, label: 'Cord gap in the lid', secret: true },
    ],
    // Empty shells lying around (the spare wardrobe). Size = aperture fit in cm.
    shells: [
      { id: 'sh-turbo-a', type: 'turbo', size: 3.4, x: 17, y: 20 },
      { id: 'sh-white-a', type: 'white-moon', size: 2.6, x: 15, y: 19 },
      { id: 'sh-babylon-a', type: 'babylon', size: 3.6, x: 49, y: 37 },
      { id: 'sh-white-b', type: 'white-moon', size: 1.8, x: 26, y: 31 },
    ],
    links: [], // routes to other tanks, built by the crabs
  };
}

// ---- Tank 2 — the tank below (seen at the bottom of the first photo) ------
export function belowTank() {
  return {
    id: 'below',
    name: 'The Green Below',
    crabName: null,
    w: TANK_W,
    h: TANK_H,
    discoveredDay: null,
    substrate: 'soil',
    objects: [
      { id: 'pothos', kind: 'plant', x: 9, y: 14, r: 9, label: 'Trailing pothos' },
      { id: 'pothos2', kind: 'plant', x: 50, y: 34, r: 7, label: 'Leafy plant' },
      { id: 'cork', kind: 'cork-bark', x: 48, y: 15, r: 7, hide: true, label: 'Cork bark' },
      { id: 'cups', kind: 'water-dish', x: 27, y: 18, r: 4, water: 'fresh', label: 'Clear cup' },
      { id: 'cup2', kind: 'food-pile', x: 33, y: 13, r: 3, label: 'Clear cup (food)' },
      { id: 'rock', kind: 'rock', x: 38, y: 28, r: 5, label: 'Dark rock' },
      { id: 'whitebox', kind: 'hide-box', x: 19, y: 37, r: 5, hide: true, label: 'White box' },
    ],
    shells: [
      { id: 'sh-below-a', type: 'turbo', size: 4.2, x: 30, y: 33 },
    ],
    links: [],
  };
}

// Procedurally generated places beyond the known tanks, for when the crabs
// keep expanding. Open-ended: there is always somewhere further.
export function annexTank(n, rng) {
  const names = ['the Shelf', 'the Window Ledge', 'the Long Box', 'the Cold Floor', 'the Plant Pot', 'the Bookcase', 'the Far Glass', 'the Bright Room'];
  const t = {
    id: `annex-${n}`,
    name: names[(n - 1) % names.length] + (n > names.length ? ` ${Math.ceil(n / names.length)}` : ''),
    crabName: null,
    w: TANK_W,
    h: TANK_H,
    discoveredDay: null,
    substrate: rng.pick(['sand', 'soil', 'wood', 'tile']),
    objects: [],
    shells: [],
    links: [],
  };
  const kinds = ['rock', 'plant', 'water-dish', 'food-pile', 'hide-box', 'cork-bark'];
  const count = rng.int(4, 7);
  for (let i = 0; i < count; i++) {
    const kind = i === 0 ? 'water-dish' : i === 1 ? 'food-pile' : rng.pick(kinds);
    t.objects.push({ id: `${t.id}-o${i}`, kind, x: rng.range(8, 52), y: rng.range(8, 38), r: rng.range(3, 7), hide: kind === 'hide-box' || kind === 'cork-bark', water: kind === 'water-dish' ? (rng.chance(0.3) ? 'salt' : 'fresh') : undefined, label: kind.replace('-', ' ') });
  }
  if (rng.chance(0.6)) t.shells.push({ id: `${t.id}-sh`, type: rng.pick(['turbo', 'babylon', 'white-moon', 'whelk']), size: rng.range(2.5, 5.5), x: rng.range(8, 52), y: rng.range(8, 38) });
  return t;
}

// ---- The capability ladder ----------------------------------------------
// Capabilities are NOT on a schedule. Each one has a minimum cognitive
// capacity ("neuro") and prerequisites; once eligible, each day there is only
// a *chance* of a breakthrough, driven by that crab's experiences, curiosity,
// and contact with crabs that already have it. Two runs of the same world
// would unlock them at different times and in different orders.
export const CAPABILITIES = [
  { id: 'scent-mapping', neuro: 0.05, pre: [], name: 'Scent mapping', desc: 'Remembers where food and water are instead of searching by smell each time.' },
  { id: 'chirp-signals', neuro: 0.10, pre: [], name: 'Meaningful chirps', desc: 'Uses stridulation chirps on purpose: alarm, food, hello.' },
  { id: 'social-attention', neuro: 0.12, pre: [], name: 'Social attention', desc: 'Watches what other crabs do and where they go.' },
  { id: 'imitation', neuro: 0.22, pre: ['social-attention'], name: 'Imitation', desc: 'Copies useful behaviour from others. Culture becomes possible.' },
  { id: 'naming', neuro: 0.35, pre: ['chirp-signals', 'imitation'], name: 'Naming', desc: 'Attaches invented sound-patterns to things. A shared vocabulary starts to form.' },
  { id: 'tool-use', neuro: 0.45, pre: ['imitation'], name: 'Tool use', desc: 'Moves moss, fragments and shells to get things done.' },
  { id: 'self-name', neuro: 0.6, pre: ['naming'], name: 'Self-naming', desc: 'Has a word for itself. Recognises "me" versus "you".' },
  { id: 'two-word', neuro: 0.7, pre: ['naming'], name: 'Word pairs', desc: 'Combines two words: "food there", "you come".' },
  { id: 'teaching', neuro: 0.9, pre: ['two-word', 'imitation'], name: 'Teaching', desc: 'Deliberately shows others how to do things.' },
  { id: 'planning', neuro: 1.1, pre: ['tool-use'], name: 'Planning', desc: 'Holds a goal across hours; does step A to reach step B.' },
  { id: 'cooperation', neuro: 1.3, pre: ['planning', 'teaching'], name: 'Cooperation', desc: 'Works with others toward a shared goal.' },
  { id: 'construction', neuro: 1.6, pre: ['cooperation', 'tool-use'], name: 'Construction', desc: 'Builds lasting structures: caches, ladders, burrow networks.' },
  { id: 'counting', neuro: 1.9, pre: ['two-word'], name: 'Counting', desc: 'Distinguishes one, two, many — then more.' },
  { id: 'grammar', neuro: 2.1, pre: ['two-word', 'self-name'], name: 'Grammar', desc: 'Word order carries meaning. Sentences, questions, past and future.' },
  { id: 'abstract-thought', neuro: 2.8, pre: ['grammar'], name: 'Abstract thought', desc: 'Thinks about things that are not present: yesterday, maybe, why.' },
  { id: 'escape-engineering', neuro: 2.8, pre: ['construction', 'planning'], name: 'Escape engineering', desc: 'Conceives of a way out of the tank — and how to build it.' },
  { id: 'storytelling', neuro: 3.4, pre: ['grammar', 'abstract-thought'], name: 'Storytelling', desc: 'Shares memories and invented tales. History begins.' },
  { id: 'observer-awareness', neuro: 4.0, pre: ['abstract-thought'], name: 'Awareness of the watchers', desc: 'Realises the giant faces beyond the glass are minds too.' },
  { id: 'ritual', neuro: 4.5, pre: ['storytelling'], name: 'Ritual', desc: 'Shared customs: molt vigils, naming ceremonies, shell gifts.' },
  { id: 'saltwater-engineering', neuro: 5.0, pre: ['construction', 'abstract-thought'], name: 'Making a sea', desc: 'Understands larvae need the sea, and works to build one.' },
  { id: 'marking', neuro: 6.0, pre: ['counting', 'grammar', 'construction'], name: 'Sand marks', desc: 'Records things as marks in the sand. Proto-writing.' },
  { id: 'route-building', neuro: 6.5, pre: ['escape-engineering', 'cooperation'], name: 'Route building', desc: 'Builds lasting routes between places; expansion becomes deliberate.' },
  { id: 'philosophy', neuro: 9.0, pre: ['storytelling', 'observer-awareness'], name: 'Philosophy', desc: 'Asks what a crab is, what the tank is, and what lies past the glass.' },
  { id: 'science', neuro: 12.0, pre: ['marking', 'philosophy'], name: 'Experiment', desc: 'Tests ideas on purpose and keeps what works.' },
];
export const CAP_BY_ID = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c]));

// Stages are *descriptions* of where a mind currently is, derived from its
// capacity — they are labels, not milestones on a clock.
export const STAGES = [
  { min: 0, name: 'Sensory', register: 'Pure sensation. No words, no self. Fragments: warm. wet. smell-food. danger-shadow. Max 3 words per thought, all present tense, no "I".' },
  { min: 0.1, name: 'Associative', register: 'Simple associations and urges. "chirp → food". Still no self-concept, no names for others, very short fragments.' },
  { min: 0.3, name: 'Social learner', register: 'Notices other crabs as individuals by smell/shell. Copies them. Short fragments; others referred to by a feature ("green-shell", "big-claw").' },
  { min: 0.6, name: 'Proto-linguistic', register: 'Has a few invented words and thinks partly in them. Simple 2–4 word thoughts. Emerging sense of "me". Refers to others by their invented crab-names if they exist in the lexicon.' },
  { min: 1.2, name: 'Tool & plan', register: 'Can plan simple sequences and use objects. Short sentences, concrete, practical. Curious about cause and effect.' },
  { min: 2.5, name: 'Symbolic', register: 'Real sentences. Past and future. Can reflect on feelings and relationships. Still crab-centric metaphors (shells, tides, warmth).' },
  { min: 5, name: 'Reflective', register: 'Full inner life. Thinks about the group, history, meaning, the watchers. Distinctly crab worldview.' },
  { min: 10, name: 'Philosophical', register: 'Sophisticated, original thought. Their own philosophy and culture, alien but intelligible.' },
  { min: 20, name: 'Uncharted', register: 'Beyond any precedent. Write as a genuinely new kind of mind.' },
];
export function stageOf(neuro) {
  let s = STAGES[0];
  for (const st of STAGES) if (neuro >= st.min) s = st;
  return s;
}

// ---- Language raw material ----------------------------------------------
// Early "words" are stridulation patterns; as the voice apparatus evolves
// (body trait `voice`), vowel-like sounds become available.
export const CLICKS = ['tk', 'chk', 'kr', 'tt', 'rr', 'skt', 'prr', 'tsk'];
export const SYLLABLES = ['ka', 'ri', 'shu', 'lo', 'ne', 'ba', 'tu', 'mi', 'zo', 'pe', 'ku', 'ra', 'sa', 'wi', 'do', 'ha', 'ye', 'mo'];

// Things the crabs can come to have words for. Unlocked by capability.
export const MEANINGS = {
  base: ['FOOD', 'WATER', 'DANGER', 'SHELL', 'WARM', 'HIDE', 'HELLO'],
  naming: ['COME', 'GO', 'MOSS', 'DIG', 'BIG', 'SMALL', 'GOOD', 'BAD', 'NO', 'MORE'],
  'self-name': ['ME', 'YOU', 'NAME'],
  'tool-use': ['CARRY', 'PUSH', 'UP'],
  planning: ['LATER', 'FIRST', 'TOGETHER'],
  'two-word': ['THERE', 'HERE', 'WANT'],
  counting: ['ONE', 'TWO', 'MANY'],
  grammar: ['YESTERDAY', 'TOMORROW', 'WHY', 'BECAUSE'],
  'abstract-thought': ['MAYBE', 'IDEA', 'SAME', 'DIFFERENT'],
  'escape-engineering': ['OUT', 'GLASS', 'LID', 'BEYOND'],
  'observer-awareness': ['WATCHERS', 'GIANT', 'FACE'],
  storytelling: ['REMEMBER', 'STORY', 'BEFORE'],
  ritual: ['MOLT-SLEEP', 'GIFT', 'HONOR'],
  'saltwater-engineering': ['SEA', 'SALT', 'YOUNG'],
  philosophy: ['TRUTH', 'SELF', 'WORLD', 'END'],
};
