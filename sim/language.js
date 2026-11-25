// Emergent language. Nobody gives the crabs a vocabulary: words are invented
// by individuals and spread (or die out) through a "naming game" — each time
// two crabs talk about something, the listener either already uses the same
// word (success, both grow more confident) or may adopt the speaker's word.
// Over many encounters the group converges on a shared lexicon. Separated
// groups drift apart into dialects.
import { CLICKS, SYLLABLES, MEANINGS } from './world.js';

// Innate species-level chirps, available with 'chirp-signals' before any
// invented words exist (real Coenobita stridulate when stressed or crowded).
const INNATE = { FOOD: 'chk-chk', DANGER: 'krrrr', HELLO: 'tk', HIDE: 'skt-skt', WARM: 'prr' };

export function availableMeanings(crab) {
  const caps = crab.mind.caps;
  let list = [...MEANINGS.base];
  for (const [cap, words] of Object.entries(MEANINGS)) if (cap !== 'base' && caps[cap] !== undefined) list = list.concat(words);
  return list;
}

export function inventWord(crab, rng) {
  const voice = crab.body.voice;
  const n = rng.weighted([[1, 3], [2, 4], [3, 1 + voice * 2]]);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(rng.chance(voice) ? rng.pick(SYLLABLES) : rng.pick(CLICKS));
  return parts.join(voice > 0.5 ? '' : '-');
}

function wordFor(crab, meaning, rng, events, day) {
  const lex = crab.mind.lexicon;
  if (!lex[meaning]) {
    lex[meaning] = { form: inventWord(crab, rng), score: 0, since: day };
    crab.stats.wordsInvented++;
    events.push({ type: 'word-invented', crab: crab.id, meaning, form: lex[meaning].form, minor: true });
  }
  return lex[meaning].form;
}

function hear(listener, speaker, meaning, form, rng, events, day) {
  const caps = listener.mind.caps;
  if (caps.naming === undefined && caps.imitation === undefined) return false;
  const lex = listener.mind.lexicon;
  const mine = lex[meaning];
  if (mine && mine.form === form) {
    mine.score += 1;
    speaker.mind.lexicon[meaning].score += 1;
    return true;
  }
  const affinity = listener.relations[speaker.id] ?? 0;
  const pAdopt = (0.35 + 0.3 * affinity) / (1 + (mine ? mine.score : 0) * 0.5);
  if (rng.chance(pAdopt)) {
    lex[meaning] = { form, score: mine ? 0 : 0.5, since: day, from: speaker.id };
    events.push({ type: 'word-learned', crab: listener.id, from: speaker.id, meaning, form, minor: true });
  } else if (mine) {
    speaker.mind.lexicon[meaning].score = Math.max(0, speaker.mind.lexicon[meaning].score - 0.25);
  }
  return false;
}

// Choose what a crab would talk about in a given context.
export function pickTopic(speaker, ctx, rng) {
  const avail = availableMeanings(speaker);
  const options = [];
  const add = (m, w) => { if (avail.includes(m)) options.push([m, w]); };
  add('HELLO', 2);
  if (ctx.activity === 'eat') add('FOOD', 5);
  if (ctx.activity === 'drink') add('WATER', 5);
  if (ctx.activity === 'bask') add('WARM', 4);
  if (ctx.activity === 'rest') add('HIDE', 2);
  if (ctx.activity === 'dig') add('DIG', 3);
  if (ctx.activity === 'climb') { add('UP', 3); add('MOSS', 2); }
  if (ctx.activity === 'build') { add('CARRY', 3); add('TOGETHER', 3); add('PUSH', 2); }
  if (ctx.activity === 'shell') { add('SHELL', 5); add('BIG', 1); add('SMALL', 1); }
  if (ctx.stressed) add('DANGER', 3);
  if (ctx.escapeMinded) { add('OUT', 3); add('BEYOND', 2); add('LID', 1); }
  if (ctx.sawWatcher) { add('WATCHERS', 3); add('FACE', 1); }
  for (const m of avail) if (!options.find((o) => o[0] === m)) options.push([m, 0.3]);
  return rng.weighted(options);
}

// One communicative exchange; returns a speech record for the viewer.
export function converse(speaker, listener, ctx, rng, events, day) {
  const caps = speaker.mind.caps;
  speaker.usage.talk++;
  if (caps['chirp-signals'] === undefined) {
    return { form: rng.pick(['chk', 'tk-tk', 'krr', 'chk-chk-chk']), gloss: null };
  }
  if (caps.naming === undefined) {
    const meaning = rng.pick(Object.keys(INNATE));
    return { form: INNATE[meaning], gloss: `(${meaning.toLowerCase()}?)` };
  }
  const meaning = pickTopic(speaker, ctx, rng);
  const form = wordFor(speaker, meaning, rng, events, day);
  const ok = hear(listener, speaker, meaning, form, rng, events, day);
  let words = [form], gloss = [meaning];

  // A second word, once word-pairs exist: a place, a person, or "you/me".
  if (caps['two-word'] !== undefined) {
    const second = [];
    if (caps['self-name'] !== undefined) {
      const nk = 'NAME:' + listener.id;
      if (listener.mind.lexicon['NAME:' + listener.id]) {
        // address the listener by the name the listener calls itself, if known
        speaker.mind.lexicon[nk] = speaker.mind.lexicon[nk] || { form: listener.mind.lexicon[nk].form, score: 0, since: day };
        second.push([nk, 2]);
      }
      second.push(['YOU', 1], ['ME', 1]);
    }
    for (const m of ['THERE', 'HERE', 'COME', 'MORE', 'GOOD', 'WANT', 'TOGETHER', 'LATER']) if (availableMeanings(speaker).includes(m)) second.push([m, 1]);
    if (second.length && rng.chance(0.7)) {
      const m2 = rng.weighted(second);
      const f2 = m2.startsWith('NAME:') ? speaker.mind.lexicon[m2].form : wordFor(speaker, m2, rng, events, day);
      if (!m2.startsWith('NAME:')) hear(listener, speaker, m2, f2, rng, events, day);
      words.push(f2);
      gloss.push(m2.startsWith('NAME:') ? nameGloss(m2, ctx.crabsById) : m2);
    }
  }
  // Grammar: three-part utterances with ordering (subject-verb-object-ish).
  if (caps.grammar !== undefined && rng.chance(0.5)) {
    const pool = availableMeanings(speaker).filter((m) => !gloss.includes(m));
    const m3 = rng.pick(pool);
    words.push(wordFor(speaker, m3, rng, events, day));
    gloss.push(m3);
  }
  return { form: words.join(' '), gloss: gloss.join(' '), understood: ok };
}

function nameGloss(key, crabsById) {
  const id = key.slice(5);
  return crabsById?.[id]?.name?.toUpperCase() ?? 'NAME';
}

// A crab coins a name for itself once it can.
export function ensureSelfName(crab, rng, events, day) {
  const k = 'NAME:' + crab.id;
  if (!crab.mind.lexicon[k]) {
    const form = inventWord({ body: { voice: Math.max(0.5, crab.body.voice) } }, rng);
    crab.mind.lexicon[k] = { form, score: 3, since: day };
    crab.crabName = form;
    events.push({ type: 'self-named', crab: crab.id, form, text: `${crab.name} has begun calling itself "${form}".` });
  }
}

// The words most of the group agrees on.
export function sharedLexicon(crabs) {
  const tally = {};
  for (const c of crabs) {
    if (!c.alive) continue;
    for (const [meaning, w] of Object.entries(c.mind.lexicon)) {
      tally[meaning] = tally[meaning] || {};
      tally[meaning][w.form] = (tally[meaning][w.form] || 0) + 1;
    }
  }
  const out = [];
  for (const [meaning, forms] of Object.entries(tally)) {
    const [form, n] = Object.entries(forms).sort((a, b) => b[1] - a[1])[0];
    out.push({ meaning, form, speakers: n, variants: Object.keys(forms).length });
  }
  return out.sort((a, b) => b.speakers - a.speakers || a.meaning.localeCompare(b.meaning));
}
