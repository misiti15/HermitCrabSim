import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageOf } from '../sim/world.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = process.env.CRAB_DATA_DIR ? path.resolve(process.env.CRAB_DATA_DIR) : path.join(ROOT, 'docs', 'data');

export const readJSON = (p, fallback = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
export const writeJSON = (p, v, pretty = false) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, pretty ? 1 : 0) + '\n'); };

export const addDays = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const todayUTC = () => new Date().toISOString().slice(0, 10);

export const paths = {
  world: () => path.join(DATA, 'world.json'),
  index: () => path.join(DATA, 'index.json'),
  history: () => path.join(DATA, 'history.json'),
  day: (date) => path.join(DATA, 'days', `${date}.json`),
  minds: (date) => path.join(DATA, 'minds', `${date}.json`),
  interventions: () => path.join(DATA, 'interventions.json'),
};

export function historyRow(world, day) {
  return {
    date: day.date,
    day: day.day,
    crabs: Object.fromEntries(world.crabs.filter((c) => c.alive).map((c) => [c.id, {
      n: Number(c.mind.neuro.toFixed(4)), s: c.body.size, caps: Object.keys(c.mind.caps).length,
      words: Object.keys(c.mind.lexicon).length, stage: stageOf(c.mind.neuro).name, tank: c.tank,
    }])),
    sharedWords: world.culture.sharedWords,
  };
}
