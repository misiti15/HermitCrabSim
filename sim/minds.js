// The crabs' inner lives. Once a day, Claude is shown what each crab
// experienced and what it is cognitively capable of, and writes that crab's
// thoughts, what it is inclined to do tomorrow, and (rarely) a new idea.
//
// Claude does NOT control the simulation: it cannot grant abilities, change
// bodies, or move crabs. Its intentions only nudge activity weights, and any
// "idea" must pass the engine's own readiness check and a roll of the dice.
// If no API key is configured, a simple rule-based fallback is used instead.
import { stageOf, CAP_BY_ID } from './world.js';
import { sharedLexicon } from './language.js';

const MODEL = process.env.CRAB_MINDS_MODEL || 'claude-opus-5-5';
const ACTIVITIES = ['rest', 'eat', 'drink', 'bask', 'explore', 'social', 'dig', 'climb', 'shell', 'build', 'cross', 'watch'];

const SYSTEM = `You are the inner life of a long-running scientific simulation of land hermit crabs (Coenobita). Each day you write what each crab thinks, constrained strictly by its current cognitive stage.

Hard rules:
- Never exceed a crab's stage. A Sensory crab has no words, no "I", no names, no plans — only fragments of sensation. Do not foreshadow abilities it does not have.
- Ground thoughts in real hermit crab experience: humidity on the gills, the smell of food via antennules, shell fit, the heat lamps, molting dread, stridulation chirps, piling together, night activity, being watched through glass.
- Only use the crab's own invented words (given in its lexicon) when it would think in words; render them as they are spelled, optionally followed by a translation in square brackets.
- Personality comes from the temperament numbers and experience — let each crab sound distinct, and let it change over time. Do not invent events that did not happen.
- You do not know where this goes. Do not steer the crabs toward any predetermined future (escape, language, etc.). Follow what they experienced.
- Intentions are weights from 0 to 2 (1 = no change) for tomorrow's activities; keep most near 1 and only push a few that follow naturally from today.
- An "idea" is optional and should usually be null. Only for crabs at stage "Tool & plan" or above, and only when today's experience genuinely suggests something new (a technique, a custom, a concept). It is only a proposal; the simulation decides whether it takes.
- The journal is a field-notes entry by a careful, warm human observer (2–4 short paragraphs), describing what was seen today. Plain language, no hype.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['journal', 'crabs'],
  properties: {
    journal: { type: 'string' },
    crabs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'thoughts', 'focus', 'intentions', 'idea'],
        properties: {
          id: { type: 'string' },
          thoughts: { type: 'array', items: { type: 'string' } },
          focus: { type: 'string' },
          intentions: {
            type: 'object',
            additionalProperties: false,
            required: ACTIVITIES,
            properties: Object.fromEntries(ACTIVITIES.map((a) => [a, { type: 'number' }])),
          },
          idea: {
            anyOf: [
              { type: 'null' },
              { type: 'object', additionalProperties: false, required: ['name', 'description'], properties: { name: { type: 'string' }, description: { type: 'string' } } },
            ],
          },
        },
      },
    },
  },
};

export function crabDigest(world, c, lastDay) {
  const st = stageOf(c.mind.neuro);
  const named = (id) => world.crabs.find((x) => x.id === id)?.name ?? id;
  const ev = (lastDay?.events ?? []).filter((e) => e.crab === c.id || e.other === c.id).map((e) => e.text).filter(Boolean).slice(0, 12);
  const said = (lastDay?.speech ?? []).filter((s) => s.crab === c.id || s.to === c.id).slice(0, 10).map((s) => `${named(s.crab)} → ${named(s.to)}: "${s.form}"${s.gloss ? ` (${s.gloss})` : ''}`);
  return {
    id: c.id,
    name: c.name,
    note: 'The crab does not know its human-given name unless it has a word for itself.',
    stage: st.name,
    stage_register: st.register,
    neuro: Number(c.mind.neuro.toFixed(3)),
    abilities: Object.keys(c.mind.caps).map((k) => CAP_BY_ID[k]?.name ?? k),
    temperament: Object.fromEntries(['boldness', 'sociability', 'curiosity', 'aggression', 'patience', 'playfulness'].map((k) => [k, Number(c.genome[k].toFixed(2))])),
    body: { size_cm: c.body.size, shell: c.shell ? `${c.shell.type} (${c.shell.size} cm)` : 'none', molt: c.molt.stage, armor: c.body.armor, voice: c.body.voice },
    needs: Object.fromEntries(Object.entries(c.needs).map(([k, v]) => [k, Number(v.toFixed(2))])),
    mood: c.mood,
    tank: world.tanks.find((t) => t.id === c.tank)?.name,
    restlessness: Number(c.mind.restlessness.toFixed(2)),
    relationships: Object.fromEntries(Object.entries(c.relations).map(([id, v]) => [named(id), Number(v.toFixed(2))])),
    lexicon: Object.fromEntries(Object.entries(c.mind.lexicon).map(([m, w]) => [m, w.form])),
    memories: c.mind.memories.slice(0, 12).map((m) => `day ${m.day}: ${m.text}`),
    yesterday_events: ev,
    yesterday_speech: said,
    previous_thoughts: c.mind.thoughts?.slice(0, 4) ?? [],
    previous_focus: c.mind.focus,
  };
}

export async function generateMinds(world, lastDay) {
  const living = world.crabs.filter((c) => c.alive);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return fallbackMinds(world, lastDay);
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const payload = {
      day: world.day + 1,
      world: {
        known_places: world.tanks.filter((t) => t.discoveredDay !== null).map((t) => t.name),
        shared_words: sharedLexicon(world.crabs).filter((w) => w.speakers >= 2).slice(0, 40),
        projects: world.projects.filter((p) => !p.done).map((p) => `${p.label}: ${Math.round(p.progress * 100)}%`),
        discoveries: (world.culture.discoveries ?? []).slice(-10),
        yesterday_headline: lastDay?.headline ?? 'The first day.',
      },
      crabs: living.map((c) => crabDigest(world, c, lastDay)),
    };
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Here is the state of the colony at the end of yesterday. Write today's thoughts (3–6 per crab, shorter and simpler for simpler minds), focus, intentions and optional idea for every crab listed, plus the observer's journal.\n\n${JSON.stringify(payload, null, 1)}` }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') throw new Error(`stop_reason ${msg.stop_reason}`);
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text);
    const crabs = {};
    for (const m of parsed.crabs ?? []) if (living.find((c) => c.id === m.id)) crabs[m.id] = { thoughts: (m.thoughts ?? []).map(String).slice(0, 8), focus: m.focus, intentions: m.intentions, idea: m.idea };
    return { source: 'claude', model: MODEL, journal: String(parsed.journal ?? ''), crabs };
  } catch (err) {
    console.error('[minds] Claude call failed, using rule-based minds:', err?.message ?? err);
    return fallbackMinds(world, lastDay);
  }
}

// --- rule-based fallback --------------------------------------------------
export function fallbackMinds(world, lastDay) {
  const crabs = {};
  for (const c of world.crabs.filter((x) => x.alive)) {
    const st = stageOf(c.mind.neuro).name;
    const n = c.needs;
    const frag = [];
    if (c.molt.stage === 'buried') frag.push('dark. still. soft.', 'wait.', 'skin… tight… new.');
    else {
      if (n.hunger > 0.5) frag.push('smell… food.');
      if (n.thirst > 0.5 || n.humidity < 0.5) frag.push('dry. water.');
      if (c.molt.stage === 'pre') frag.push('dig. deep. need dark.');
      if (c.mood.stress > 0.5) frag.push('shadow. pull in.');
      frag.push(pick(['warm sand.', 'night. move.', 'moss. soft.', 'shell… heavy… good.', 'click. click.', 'other one near.']));
    }
    let thoughts = frag.slice(0, 3);
    if (['Proto-linguistic', 'Tool & plan', 'Symbolic', 'Reflective', 'Philosophical', 'Uncharted'].includes(st)) {
      const word = (m) => c.mind.lexicon[m]?.form;
      thoughts = thoughts.concat([word('FOOD') ? `${word('FOOD')} [food] — there, by the warm place.` : 'food… there.', word('ME') ? `${word('ME')} [me]. ${word('ME')} is here.` : 'here.']);
    }
    crabs[c.id] = { thoughts, focus: thoughts[0], intentions: null, idea: null };
  }
  return { source: 'rules', journal: null, crabs };
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
