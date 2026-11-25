// The only sanctioned way to change the world from outside. Every
// intervention is applied to the current state (never to past days) and is
// logged publicly in docs/data/interventions.json.
//
//   node scripts/intervene.js add-shell <tankId> <type> <sizeCm> "<note>"
//   node scripts/intervene.js set-sex <crabId> <F|M> "<note>"     (only before the sim reveals it)
//   node scripts/intervene.js note "<text>"                         (record a real-world event, no effect)
import { paths, readJSON, writeJSON } from './lib.js';

const [cmd, ...args] = process.argv.slice(2);
const world = readJSON(paths.world());
const log = readJSON(paths.interventions(), []);
const entry = { at: new Date().toISOString(), afterDay: world.day, cmd, args };

if (cmd === 'add-shell') {
  const [tankId, type, size] = args;
  const tank = world.tanks.find((t) => t.id === tankId);
  if (!tank) throw new Error('No such tank: ' + tankId);
  tank.shells.push({ id: `sh-keeper-${Date.now()}`, type, size: Number(size), x: 10 + Math.random() * 40, y: 10 + Math.random() * 25 });
} else if (cmd === 'set-sex') {
  const [id, sex] = args;
  const c = world.crabs.find((x) => x.id === id);
  if (!c) throw new Error('No such crab: ' + id);
  if (c.sex.revealed) throw new Error(`${c.name}'s sex has already been revealed in the simulation; changing it now would contradict its history.`);
  if (!['F', 'M'].includes(sex)) throw new Error('Sex must be F or M');
  c.sex.value = sex;
  entry.args = [id, '(hidden)', args[2]]; // keep it hidden in the public log too
} else if (cmd === 'note') {
  // no effect on the world
} else {
  console.error('Usage: add-shell <tank> <type> <size> "<note>" | set-sex <crab> <F|M> "<note>" | note "<text>"');
  process.exit(1);
}
log.push(entry);
writeJSON(paths.world(), world);
writeJSON(paths.interventions(), log, true);
console.log('Recorded intervention:', cmd);
