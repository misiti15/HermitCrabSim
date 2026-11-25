// One-time creation of the world. Refuses to run if a world already exists,
// because re-running genesis would erase the crabs' entire history.
import fs from 'node:fs';
import { createWorld } from '../sim/genesis.js';
import { paths, writeJSON, todayUTC } from './lib.js';

if (fs.existsSync(paths.world()) && !process.argv.includes('--i-really-mean-to-erase-everything')) {
  console.error('A world already exists. Genesis would erase the crabs\' history. Aborting.');
  process.exit(1);
}
const startDate = process.env.GENESIS_DATE || todayUTC();
const world = createWorld({ seed: process.env.CRAB_SEED || `hermit-crab-sim/${startDate}`, startDate, timezone: process.env.CRAB_TZ || 'America/New_York' });
writeJSON(paths.world(), world);
writeJSON(paths.index(), { genesisDate: startDate, days: [] }, true);
writeJSON(paths.history(), []);
writeJSON(paths.interventions(), [], true);
console.log(`Genesis: ${world.crabs.map((c) => c.name).join(', ')} — starting ${startDate}.`);
