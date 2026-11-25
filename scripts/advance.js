// Advances the world day by day until it covers tomorrow (UTC), so viewers
// always have the current day available to watch live. Safe to run any number
// of times: already-simulated days are never touched again.
import { simulateDay, ENGINE_VERSION } from '../sim/engine.js';
import { generateMinds, fallbackMinds } from '../sim/minds.js';
import { paths, readJSON, writeJSON, addDays, todayUTC, historyRow } from './lib.js';

const target = process.env.ADVANCE_TO || addDays(todayUTC(), 1);
const maxClaudeDays = Number(process.env.MAX_CLAUDE_DAYS ?? 5); // cap catch-up cost
const noClaude = process.argv.includes('--no-claude');

let world = readJSON(paths.world());
if (!world) { console.error('No world. Run `npm run genesis` first.'); process.exit(1); }
const index = readJSON(paths.index(), { genesisDate: world.genesisDate, days: [] });
const history = readJSON(paths.history(), []);

let claudeDays = 0, made = 0;
while (true) {
  const next = world.lastSimulatedDate ? addDays(world.lastSimulatedDate, 1) : world.genesisDate;
  if (next > target) break;
  const lastDay = world.lastSimulatedDate ? readJSON(paths.day(world.lastSimulatedDate)) : null;
  // When catching up on many missed days, only the most recent ones get Claude.
  const daysBehind = Math.round((new Date(target) - new Date(next)) / 86400000);
  const useClaude = !noClaude && claudeDays < maxClaudeDays && daysBehind < maxClaudeDays;
  const minds = useClaude ? await generateMinds(world, lastDay) : fallbackMinds(world, lastDay);
  if (minds.source === 'claude') claudeDays++;
  const { world: w2, day } = simulateDay(world, next, minds);
  world = w2;
  writeJSON(paths.day(next), day);
  writeJSON(paths.minds(next), { date: next, source: minds.source, model: minds.model ?? null, journal: minds.journal, crabs: minds.crabs }, true);
  index.days = index.days.filter((d) => d.date !== next);
  index.days.push({ date: next, day: day.day, headline: day.headline, major: day.events.filter((e) => e.major).map((e) => e.text).slice(0, 6), minds: minds.source, engine: ENGINE_VERSION });
  history.push(historyRow(world, day));
  made++;
  console.log(`${next} (day ${day.day}) [${minds.source}] ${day.headline}`);
}
index.lastSimulatedDate = world.lastSimulatedDate;
index.updatedAt = new Date().toISOString();
writeJSON(paths.world(), world);
writeJSON(paths.index(), index, true);
writeJSON(paths.history(), history);
console.log(made ? `Simulated ${made} day(s).` : 'Already up to date.');
