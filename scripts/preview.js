// Dry run: simulate N days into a throwaway directory, with rule-based minds,
// to see how the dynamics behave. NEVER touches the real world data.
// Usage: node scripts/preview.js [days] [seed]
import { createWorld } from '../sim/genesis.js';
import { simulateDay } from '../sim/engine.js';
import { fallbackMinds } from '../sim/minds.js';
import { stageOf } from '../sim/world.js';
import { addDays } from './lib.js';

const days = Number(process.argv[2] ?? 365);
const seed = process.argv[3] ?? 'preview-' + Date.now();
let world = createWorld({ seed, startDate: '2030-01-01' });
let last = null;
for (let i = 0; i < days; i++) {
  const date = addDays('2030-01-01', i);
  const r = simulateDay(world, date, fallbackMinds(world, last));
  world = r.world; last = r.day;
  for (const e of r.day.events) if (e.major) console.log(`d${String(i).padStart(4)}  ${e.text}`);
  if (i % 60 === 59) console.log(`      -- day ${i + 1}: ` + world.crabs.filter((c) => c.alive).map((c) => `${c.name} ${c.mind.neuro.toFixed(2)} ${stageOf(c.mind.neuro).name} caps:${Object.keys(c.mind.caps).length}`).join(' | ') + ` | shared words ${world.culture.sharedWords}`);
}
