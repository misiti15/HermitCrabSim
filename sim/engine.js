// The simulation engine. simulateDay() takes the world at the end of one day
// and produces the next day: a minute-by-minute record of where every crab
// was and what it was doing (for the viewer), plus the long-term changes
// (learning, language, bodies, relationships, discoveries).
//
// Design rule: nothing here is scheduled by date. Every change happens
// because of something the crabs experienced, with randomness on top, so the
// future is genuinely unknown — including to the people who wrote this.
import { makeRng, clamp, dist } from './rng.js';
import { CAPABILITIES, CAP_BY_ID, stageOf, annexTank } from './world.js';
import { converse, ensureSelfName, sharedLexicon } from './language.js';
import { newCrab } from './genesis.js';

export const ENGINE_VERSION = 1;
const DAY = 86400;

// ---------------------------------------------------------------- time ----
function tzOffsetMinutes(dateStr, tz) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((p) => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((local - d.getTime()) / 60000);
}
export function lightAt(localHour) {
  // lamps on 08:00–20:00 local; crabs are mostly nocturnal / crepuscular
  return { lampsOn: localHour >= 8 && localHour < 20, night: localHour >= 20 || localHour < 6.5 };
}

// ---------------------------------------------------------------- helpers -
const objOf = (tank, kind) => tank.objects.filter((o) => o.kind === kind);
function jitter(p, r, rng, tank) {
  const a = rng.range(0, Math.PI * 2), d = rng.range(0, r);
  return { x: clamp(p.x + Math.cos(a) * d, 2, tank.w - 2), y: clamp(p.y + Math.sin(a) * d, 2, tank.h - 2) };
}
function mossPoint(tank, rng) {
  const m = tank.objects.find((o) => o.kind === 'moss-path');
  if (!m) return null;
  const pts = rng.chance(0.3) && m.branch ? m.branch : m.points;
  const i = rng.int(0, pts.length - 2), f = rng.next();
  return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f };
}
const cellKey = (p) => `${Math.floor(p.x / 7.5)},${Math.floor(p.y / 7.5)}`;
const has = (c, cap) => c.mind.caps[cap] !== undefined;
function shellFit(body, shell) {
  if (!shell) return body.armor > 0.9 ? 0.9 : 0;
  const ideal = body.size * 1.15;
  return clamp(1 - Math.abs(shell.size - ideal) / (body.size * 0.8), 0, 1);
}
function remember(c, day, text, salience = 0.5) {
  c.mind.memories.push({ day, text, salience });
  c.mind.memories.sort((a, b) => b.salience - a.salience || b.day - a.day);
  if (c.mind.memories.length > 40) c.mind.memories.length = 40;
}
function tankOf(world, id) { return world.tanks.find((t) => t.id === id); }

// Where a crab is at time t, from its keyframes so far.
function posAt(c, t) {
  const k = c._kf;
  if (!k.length) return { ...c.pos };
  if (t <= k[0][0]) return { x: k[0][1], y: k[0][2] };
  for (let i = 0; i < k.length - 1; i++) {
    if (t >= k[i][0] && t <= k[i + 1][0]) {
      const f = (t - k[i][0]) / Math.max(1, k[i + 1][0] - k[i][0]);
      return { x: k[i][1] + (k[i + 1][1] - k[i][1]) * f, y: k[i][2] + (k[i + 1][2] - k[i][2]) * f };
    }
  }
  const l = k[k.length - 1];
  return { x: l[1], y: l[2] };
}

// --------------------------------------------------------- the main day ---
export function simulateDay(worldIn, date, minds = null) {
  const world = structuredClone(worldIn);
  const dayIndex = world.day + 1;
  const rng = makeRng(`${world.seed}/${date}`);
  const tzOff = tzOffsetMinutes(date, world.timezone);
  const localHour = (t) => (((t / 3600 + tzOff / 60) % 24) + 24) % 24;
  const events = [];
  const speech = [];
  const crabsById = Object.fromEntries(world.crabs.map((c) => [c.id, c]));
  const living = world.crabs.filter((c) => c.alive);
  const intentions = minds?.crabs ?? {};

  // Keepers refill food & water each day.
  for (const t of world.tanks) for (const o of t.objects) if (o.kind === 'food-pile') o.amount = 1;

  // Daily counters
  for (const c of living) {
    c._kf = [[0, round(c.pos.x), round(c.pos.y), c.molt.stage === 'buried' ? 'molt' : 'rest']];
    c._t = rng.range(0, 600);
    c._last = 0;
    c._day = { newCells: 0, social: 0, talks: 0, problem: 0, eaten: 0, drank: 0, climbed: 0, dug: 0, built: 0, explored: 0, met: {} , fights: 0, tanksVisited: new Set([c.tank]) };
    c._act = 'rest';
    c._startTank = c.tank;
  }

  // -------- discrete-event loop: each crab decides when its last action ends
  let guard = 0;
  while (guard++ < 20000) {
    let c = null;
    for (const x of living) if (!c || x._t < c._t) c = x;
    if (!c || c._t >= DAY) break;
    decide(c);
  }

  function updateNeeds(c, t) {
    const dt = (t - c._last) / 60; // minutes
    c._last = t;
    const m = c.genome.metabolism;
    const resting = c._act === 'rest' || c._act === 'molt';
    c.needs.hunger = clamp(c.needs.hunger + dt * 0.0011 * m * (c.molt.stage === 'pre' ? 1.6 : 1));
    c.needs.thirst = clamp(c.needs.thirst + dt * 0.0013 * m);
    c.needs.humidity = clamp(c.needs.humidity - dt * 0.0006);
    c.needs.energy = clamp(c.needs.energy + dt * (resting ? 0.0028 : -0.0012));
  }

  function push(c, t, p, act, tank) {
    const k = [Math.round(t), round(p.x), round(p.y), act];
    if (tank) k.push(tank);
    c._kf.push(k);
  }

  function decide(c) {
    const t = c._t;
    updateNeeds(c, t);
    const tank = tankOf(world, c.tank);
    const here = { ...c.pos };
    const h = localHour(t);
    const { lampsOn, night } = lightAt(h);

    if (c.molt.stage === 'buried') { c._t = DAY; return; }

    const g = c.genome;
    const w = intentions[c.id]?.intentions ?? {};
    const wt = (k) => (typeof w[k] === 'number' ? clamp(w[k], 0, 2.5) : 1);
    const awake = night ? 1 : h < 8 || h > 18 ? 0.6 : 0.25;
    const moltPre = c.molt.stage === 'pre';
    const lonely = 1 - Math.min(1, c._day.social / 6);
    const escapeProject = world.projects.find((p) => !p.done && p.tank === c.tank);
    const links = tank.links.filter((l) => l.open);

    const options = [
      ['rest', (1 - c.needs.energy) * 1.6 + (night ? 0.1 : 0.9) + (moltPre ? 0.4 : 0)],
      ['eat', c.needs.hunger ** 1.5 * 2.2 * awake + (moltPre ? 0.5 : 0)],
      ['drink', Math.max(c.needs.thirst, 1 - c.needs.humidity) ** 1.5 * 2.0 * awake + (moltPre ? 0.3 : 0)],
      ['bask', lampsOn ? 0.25 + (1 - g.boldness) * 0.1 : 0],
      ['explore', (0.25 + g.curiosity * 0.6 + c.mind.restlessness * 0.5) * awake],
      ['social', (0.15 + g.sociability * 0.6 * lonely) * awake],
      ['dig', (0.12 + (moltPre ? 0.8 : 0)) * awake],
      ['climb', (0.08 + g.boldness * 0.25 + g.playfulness * 0.15) * awake],
      ['shell', (0.05 + g.curiosity * 0.08 + (1 - shellFit(c.body, c.shell)) * 0.6) * awake],
      ['build', escapeProject && (has(c, 'construction') || (has(c, 'imitation') && rng.chance(0.3))) ? (0.15 + g.patience * 0.3) * awake : 0],
      ['cross', links.length && (has(c, 'escape-engineering') || has(c, 'imitation')) ? (0.06 + c.mind.restlessness * 0.4 + g.curiosity * 0.1) * awake : 0],
      ['watch', has(c, 'observer-awareness') ? 0.08 * awake : 0],
    ].map(([k, v]) => [k, v * wt(k)]);
    const act = rng.weighted(options);
    c._act = act;

    let target = here, stay = 60, tankChange = null;
    switch (act) {
      case 'rest': {
        const hides = tank.objects.filter((o) => o.hide);
        const r = rng.next();
        if (hides.length && r < 0.55) target = jitter(rng.pick(hides), 4, rng, tank);
        else if (r < 0.8) target = jitter(here, 3, rng, tank); // dig in where it stands
        else { const m = mossPoint(tank, rng); target = m ?? here; }
        stay = rng.range(night ? 600 : 1800, night ? 2400 : 7200);
        break;
      }
      case 'eat': {
        const f = rng.pick(objOf(tank, 'food-pile')) ?? tank.objects[0];
        // without scent-mapping, finding food takes a meandering search
        if (!has(c, 'scent-mapping') && rng.chance(0.5)) { const mid = jitter({ x: (here.x + f.x) / 2, y: (here.y + f.y) / 2 }, 8, rng, tank); travel(c, t, mid, 'walk'); }
        target = jitter(f, f.r * 0.8, rng, tank); stay = rng.range(180, 720);
        break;
      }
      case 'drink': { const d = rng.pick(objOf(tank, 'water-dish')) ?? tank.objects[0]; target = jitter(d, d.r * 0.7, rng, tank); stay = rng.range(120, 900); break; }
      case 'bask': { const l = rng.pick(objOf(tank, 'heat-lamp')); target = l ? jitter({ x: l.x, y: l.y + 8 }, 5, rng, tank) : here; stay = rng.range(600, 2400); break; }
      case 'explore': target = jitter(here, 20, rng, tank); stay = rng.range(20, 180); break;
      case 'social': {
        const others = living.filter((o) => o !== c && o.tank === c.tank && o.molt.stage !== 'buried');
        if (others.length) {
          const o = rng.weighted(others.map((o) => [o, 1 + (c.relations[o.id] ?? 0) * 3]));
          target = jitter(posAt(o, t), 3, rng, tank); stay = rng.range(120, 1500);
        } else { target = jitter(here, 10, rng, tank); stay = 60; }
        break;
      }
      case 'dig': target = jitter(here, 8, rng, tank); stay = rng.range(400, 1800); break;
      case 'climb': {
        const choices = [];
        const m = mossPoint(tank, rng); if (m) choices.push(m);
        for (const o of tank.objects) if (['coconut-hut', 'sponge', 'cork-bark', 'rock'].includes(o.kind)) choices.push({ x: o.x, y: o.y });
        choices.push({ x: rng.pick([2, tank.w - 2]), y: rng.range(4, tank.h - 4) }); // climbing the glass corner
        target = rng.pick(choices); stay = rng.range(60, 900);
        break;
      }
      case 'shell': {
        const s = tank.shells.length ? rng.pick(tank.shells) : null;
        target = s ? jitter(s, 1.2, rng, tank) : jitter(here, 10, rng, tank); stay = rng.range(60, 400);
        break;
      }
      case 'build': target = jitter(escapeProject, 3, rng, tank); stay = rng.range(600, 2400); break;
      case 'cross': { const l = rng.pick(links); target = { x: l.x, y: l.y }; stay = 30; tankChange = l; break; }
      case 'watch': target = { x: rng.range(8, tank.w - 8), y: tank.h - 2 }; stay = rng.range(120, 600); break; // front glass
    }

    const arrive = travel(c, t, target, act);
    applyArrival(c, act, arrive, stay, tank, tankChange);
    c._t = Math.min(DAY, arrive + stay);
  }

  function travel(c, t, target, act) {
    const tank = tankOf(world, c.tank);
    const d = dist(c.pos, target);
    const start = c._kf.length ? Math.max(t, c._kf[c._kf.length - 1][0]) : t;
    if (d < 0.4) { push(c, start, c.pos, act); return start; }
    const speed = 0.7 * c.body.legLen * (0.6 + c.needs.energy * 0.6); // cm/s
    push(c, start, c.pos, 'walk');
    const arrive = start + d / speed;
    c.pos = { x: clamp(target.x, 1.5, tank.w - 1.5), y: clamp(target.y, 1.5, tank.h - 1.5) };
    push(c, arrive, c.pos, act);
    c.usage.walk += d;
    c._day.explored += d;
    const fam = (c.mind.familiarity[c.tank] = c.mind.familiarity[c.tank] || {});
    const k = cellKey(c.pos);
    if (!fam[k]) c._day.newCells++;
    fam[k] = (fam[k] || 0) + 1;
    return arrive;
  }

  function applyArrival(c, act, t, stay, tank, link) {
    const mins = stay / 60;
    switch (act) {
      case 'eat': c.needs.hunger = 0; c._day.eaten++; break;
      case 'drink': c.needs.thirst = 0; c.needs.humidity = 1; c._day.drank++; break;
      case 'rest': break;
      case 'bask': c.needs.warmth = 1; break;
      case 'dig': c.usage.dig += mins; c._day.dug += mins; break;
      case 'climb': c.usage.climb += mins; c._day.climbed += mins; break;
      case 'shell': tryShell(c, tank, t); break;
      case 'build': build(c, tank, mins, t); break;
      case 'cross': crossTo(c, link, t); break;
      case 'watch': c._day.watched = true; break;
    }
    // Encounters with whoever is nearby.
    for (const o of living) {
      if (o === c || o.tank !== c.tank || o.molt.stage === 'buried') continue;
      const op = posAt(o, t);
      if (dist(op, c.pos) > 7) continue;
      encounter(c, o, act, t);
    }
  }

  function encounter(a, b, act, t) {
    a._day.social++; b._day.social++;
    a.usage.social++; b.usage.social++;
    a._day.met[b.id] = (a._day.met[b.id] || 0) + 1;
    b._day.met[a.id] = (b._day.met[a.id] || 0) + 1;
    const ga = a.genome;
    // Shell envy: real hermit crabs rap on each other's shells to evict.
    const fitMine = shellFit(a.body, a.shell), fitTheirs = shellFit(a.body, b.shell);
    if (b.shell && a.shell && fitTheirs > fitMine + 0.25 && rng.chance(0.08 + ga.aggression * 0.15)) {
      a._day.fights++; b._day.fights++;
      const win = rng.chance(0.3 + 0.4 * ga.aggression + 0.1 * (a.body.size - b.body.size));
      if (win && shellFit(b.body, a.shell) > 0.15) {
        [a.shell, b.shell] = [b.shell, a.shell];
        a.stats.shellSwaps++; b.stats.shellSwaps++;
        events.push({ type: 'shell-fight', crab: a.id, other: b.id, t, text: `${a.name} rapped on ${b.name}'s shell until they swapped shells.` });
        remember(a, dayIndex, `took ${b.name}'s shell`, 0.6);
        remember(b, dayIndex, `${a.name} took my shell`, 0.8);
        rel(b, a, -0.12); rel(a, b, -0.03);
      } else {
        events.push({ type: 'shell-fight', crab: a.id, other: b.id, t, minor: true, text: `${a.name} rapped on ${b.name}'s shell, but ${b.name} held on.` });
        rel(b, a, -0.06);
      }
      return;
    }
    // Otherwise: antennae touching, piling, chirping, talking.
    rel(a, b, 0.012 + 0.02 * ga.sociability);
    rel(b, a, 0.008 + 0.02 * b.genome.sociability);
    if (rng.chance(0.25 + 0.5 * ga.sociability)) {
      const ctx = { activity: act, stressed: a.mood.stress > 0.6, escapeMinded: a.mind.restlessness > 0.5, sawWatcher: a._day.watched, crabsById };
      const s = converse(a, b, ctx, rng, events, dayIndex);
      a._day.talks++;
      speech.push({ t: Math.round(t + rng.range(0, 30)), crab: a.id, to: b.id, form: s.form, gloss: s.gloss, ok: s.understood ?? null });
      if (rng.chance(0.4)) {
        const r = converse(b, a, ctx, rng, events, dayIndex);
        speech.push({ t: Math.round(t + rng.range(30, 70)), crab: b.id, to: a.id, form: r.form, gloss: r.gloss, ok: r.understood ?? null });
        b._day.talks++;
      }
    }
    // Social learning: watching someone who knows something you don't.
    for (const [teacher, learner] of [[a, b], [b, a]]) {
      if (!has(learner, 'social-attention')) continue;
      for (const cap of Object.keys(teacher.mind.caps)) {
        if (has(learner, cap) || !CAP_BY_ID[cap]) continue;
        const ex = (learner.mind.exposure = learner.mind.exposure || {});
        ex[cap] = (ex[cap] || 0) + (has(teacher, 'teaching') ? 1.0 : has(learner, 'imitation') ? 0.3 : 0.08);
      }
    }
  }

  function rel(a, b, d) { a.relations[b.id] = clamp((a.relations[b.id] ?? 0) + d, -1, 1); }

  function tryShell(c, tank, t) {
    if (!tank.shells.length) return;
    const nearest = tank.shells.reduce((best, s) => (dist(s, c.pos) < dist(best, c.pos) ? s : best));
    if (dist(nearest, c.pos) > 3) return;
    const cur = shellFit(c.body, c.shell), alt = shellFit(c.body, nearest);
    c._day.problem += 0.3; // shell assessment is real problem solving for a crab
    if (alt > cur + 0.12 && c.molt.stage !== 'buried') {
      const old = c.shell;
      c.shell = { type: nearest.type, size: nearest.size };
      tank.shells = tank.shells.filter((s) => s !== nearest);
      if (old) tank.shells.push({ id: `sh-${dayIndex}-${c.id}-${rng.int(0, 1e6)}`, type: old.type, size: old.size, x: round(c.pos.x + 1.5), y: round(c.pos.y) });
      c.stats.shellSwaps++;
      events.push({ type: 'shell-swap', crab: c.id, t, text: `${c.name} tried on a ${nearest.type} shell and moved in${old ? `, leaving the ${old.type} behind` : ''}.` });
      remember(c, dayIndex, `found a better ${nearest.type} shell`, 0.6);
      // Vacancy chain: others may now inspect the shell left behind
      for (const o of living) if (o !== c && o.tank === c.tank && rng.chance(0.3)) o._t = Math.min(o._t, t + rng.range(60, 900));
    }
  }

  function build(c, tank, mins, t) {
    const p = world.projects.find((p) => !p.done && p.tank === c.tank);
    if (!p) return;
    const helpers = living.filter((o) => o !== c && o.tank === c.tank && o._act === 'build').length;
    const amount = mins * (0.3 + c.body.dexterity) * (1 + 0.3 * helpers) / p.work;
    p.progress = clamp(p.progress + amount);
    p.contributors[c.id] = (p.contributors[c.id] || 0) + mins;
    c.usage.build += mins; c._day.built += mins; c._day.problem += 0.2;
    if (p.progress >= 1 && !p.done) completeProject(p, t);
  }

  function completeProject(p, t) {
    p.done = true; p.doneDay = dayIndex;
    const names = Object.keys(p.contributors).map((id) => crabsById[id].name).join(', ');
    const home = tankOf(world, p.tank);
    if (p.type === 'moss-ladder' || p.type === 'route') {
      let dest = p.dest ? tankOf(world, p.dest) : null;
      if (!dest) { dest = annexTank(world.nextAnnex++, rng.fork('annex')); world.tanks.push(dest); p.dest = dest.id; }
      dest.discoveredDay = dest.discoveredDay ?? dayIndex;
      home.links.push({ to: dest.id, x: p.x, y: p.y, open: true, builtDay: dayIndex });
      dest.links.push({ to: home.id, x: rng.range(10, 50), y: 2, open: true, builtDay: dayIndex });
      events.push({ type: 'escape', t, major: true, text: `The ${p.label} is finished (${names}). A way out of ${home.name} now leads to ${dest.name}.` });
      world.firsts[`route:${dest.id}`] = { day: dayIndex };
    } else if (p.type === 'salt-pool') {
      home.objects.push({ id: `saltpool-${dayIndex}`, kind: 'water-dish', water: 'salt', x: p.x, y: p.y, r: 4, label: 'Salt pool (crab-made)' });
      events.push({ type: 'construction', t, major: true, text: `${names} finished a salt pool — a small sea, made by crabs.` });
    } else {
      home.objects.push({ id: `${p.type}-${dayIndex}`, kind: p.type, x: p.x, y: p.y, r: 4, label: p.label, builtBy: Object.keys(p.contributors) });
      events.push({ type: 'construction', t, major: true, text: `${names} finished building a ${p.label}.` });
    }
    for (const id of Object.keys(p.contributors)) remember(crabsById[id], dayIndex, `we finished the ${p.label}`, 0.9);
  }

  function crossTo(c, link, t) {
    const dest = tankOf(world, link.to);
    const back = dest.links.find((l) => l.to === c.tank);
    const first = !(c.mind.familiarity[dest.id]);
    c.tank = dest.id;
    c.mind.familiarity[dest.id] = c.mind.familiarity[dest.id] || {};
    c.pos = back ? { x: back.x, y: back.y } : { x: dest.w / 2, y: 3 };
    push(c, t + 20, c.pos, 'explore', dest.id);
    c._day.tanksVisited.add(dest.id);
    c._day.problem += first ? 2 : 0.2;
    if (first) {
      events.push({ type: 'new-place', crab: c.id, t, major: true, text: `${c.name} crossed into ${dest.name} for the first time.` });
      remember(c, dayIndex, `went to ${dest.name}`, 0.95);
    }
  }

  // ---------------------------------------------------- end of the day ---
  for (const c of living) {
    updateNeeds(c, DAY);
    const last = c._kf[c._kf.length - 1];
    if (last[0] < DAY) push(c, DAY, c.pos, c._act === 'walk' ? 'rest' : c.molt.stage === 'buried' ? 'molt' : c._act);
  }

  const culture = world.culture;
  for (const c of living) {
    c.stats.daysLived++;
    lifeCycle(c);
    learn(c);
    personalityDrift(c);
    moodUpdate(c);
  }
  projectsUpdate();
  reproduction();
  larvaeUpdate();
  mortality();

  const lex = sharedLexicon(world.crabs);
  culture.sharedWords = lex.filter((w) => w.speakers >= 2).length;
  applyMindsIdeas();

  // Record
  world.day = dayIndex;
  world.lastSimulatedDate = date;
  const dayRecord = {
    engine: ENGINE_VERSION,
    date,
    day: dayIndex,
    tzOffsetMinutes: tzOff,
    tanks: world.tanks.filter((t) => t.discoveredDay !== null).map((t) => t.id),
    startTank: Object.fromEntries(living.map((c) => [c.id, c._startTank])),
    tracks: Object.fromEntries(living.map((c) => [c.id, c._kf])),
    speech: speech.sort((a, b) => a.t - b.t),
    thoughts: placeThoughts(),
    events: events.map(({ minor, ...e }) => ({ ...e, minor: !!minor })),
    headline: headline(),
    narration: minds?.journal ?? null,
    mindsSource: minds?.source ?? 'none',
  };
  for (const c of world.crabs) { delete c._kf; delete c._t; delete c._last; delete c._day; delete c._act; delete c._startTank; }
  return { world, day: dayRecord };

  // ---------------------------------------------------------------------
  function lifeCycle(c) {
    const m = c.molt;
    if (m.stage === 'none' && m.nextDue !== null && dayIndex >= m.nextDue - rng.int(5, 10)) {
      m.stage = 'pre'; m.daysIn = 0;
      events.push({ type: 'molt', crab: c.id, text: `${c.name} is eating and drinking more and digging a lot — signs of an upcoming molt.` });
    } else if (m.stage === 'pre') {
      m.daysIn++;
      if (dayIndex >= m.nextDue && c._day.dug > 5) {
        m.stage = 'buried'; m.daysIn = 0; m.length = rng.int(12, 30);
        events.push({ type: 'molt', crab: c.id, major: true, text: `${c.name} has buried itself to molt. It will stay underground, vulnerable, for a while.` });
        remember(c, dayIndex, 'went under to molt', 0.7);
      }
    } else if (m.stage === 'buried') {
      m.daysIn++;
      if (m.daysIn >= m.length) emergeFromMolt(c);
    } else if (m.stage === 'post') {
      m.daysIn++;
      if (m.daysIn > 5) m.stage = 'none';
    }
  }

  function emergeFromMolt(c) {
    const m = c.molt, b = c.body, u = c.usage, p = c.genome.plasticity;
    const before = { ...b };
    const since = Math.max(10, dayIndex - (m.lastDay ?? c.bornDay - 30));
    const norm = (v, perDay) => clamp(v / since / perDay, 0, 1);
    b.size = round(b.size * rng.range(1.04, 1.13), 3);
    // Developmental plasticity: the body grows toward what it has been used for.
    b.legLen = round(b.legLen + p * (0.04 * norm(u.climb, 60) + 0.02 * norm(u.walk, 1500) + rng.normal(0, 0.01)), 3);
    b.dexterity = round(clamp(b.dexterity + p * (0.05 * norm(u.build, 90) + (has(c, 'tool-use') ? 0.03 : 0) + rng.normal(0, 0.01))), 3);
    b.voice = round(clamp(b.voice + p * (0.06 * norm(u.talk, 12) + rng.normal(0, 0.01))), 3);
    b.posture = round(clamp(b.posture + p * (has(c, 'tool-use') ? 0.02 + 0.03 * norm(u.build, 90) + rng.normal(0, 0.005) : 0)), 3);
    b.armor = round(clamp(b.armor + p * (0.01 + (c.shell ? 0.02 * (1 - shellFit(b, c.shell)) : 0.05) + rng.normal(0, 0.005))), 3);
    b.clawL = round(b.clawL + rng.normal(0.01, 0.02) + 0.02 * norm(u.dig, 60), 3);
    b.clawR = round(b.clawR + rng.normal(0, 0.015) + 0.03 * norm(u.build, 90), 3);
    b.eyeStalk = round(b.eyeStalk + rng.normal(0, 0.015) + (has(c, 'observer-awareness') ? 0.02 : 0), 3);
    b.antenna = round(b.antenna + rng.normal(0, 0.02), 3);
    b.cranium = round(clamp(Math.log10(1 + c.mind.neuro * 3) / 2, 0, 1.5), 3);
    b.hue = round(((b.hue + rng.normal(0, 0.01)) + 1) % 1, 3);
    c.usage = { walk: 0, climb: 0, dig: 0, build: 0, talk: 0, social: 0 };
    // New nerve tissue after a molt — a small, real boost to learning capacity.
    c.mind.neuro *= 1 + 0.03 * c.genome.brain;
    m.stage = 'post'; m.daysIn = 0; m.count++; m.lastDay = dayIndex;
    m.nextDue = dayIndex + Math.round(rng.range(50, 110) * (1 + b.size / 6));
    const changes = ['legLen', 'dexterity', 'voice', 'posture', 'armor', 'clawR'].filter((k) => b[k] - before[k] > 0.015).map((k) => ({ legLen: 'longer legs', dexterity: 'finer claw control', voice: 'a wider range of sounds', posture: 'a more upright stance', armor: 'a tougher abdomen', clawR: 'a stronger small claw' }[k]));
    events.push({ type: 'molt', crab: c.id, major: true, text: `${c.name} emerged from its molt, bigger (${before.size.toFixed(2)} → ${b.size.toFixed(2)} cm)${changes.length ? ', with ' + changes.join(', ') : ''}. It ate its old exoskeleton.` });
    remember(c, dayIndex, 'came back up, bigger and soft', 0.8);
    // Outgrown shell? Look for a new one soon.
    if (c.shell && shellFit(b, c.shell) < 0.4) c.mind.restlessness = clamp(c.mind.restlessness + 0.1);
    if (b.armor >= 0.9 && c.shell) {
      events.push({ type: 'evolution', crab: c.id, major: true, text: `${c.name}'s abdomen is now so armoured that it left its shell behind for good.` });
      tankOf(world, c.tank).shells.push({ id: `sh-left-${c.id}-${dayIndex}`, type: c.shell.type, size: c.shell.size, x: round(c.pos.x), y: round(c.pos.y) });
      c.shell = null;
    }
  }

  function learn(c) {
    const d = c._day, g = c.genome, mind = c.mind;
    const tanksKnown = Object.keys(mind.familiarity).length;
    // Experience this day (log-scaled: a busy day is worth more, but not unboundedly more)
    const crossed = d.tanksVisited.size > 1 ? 1.5 : 0;
    const novelty = d.newCells + crossed * 2;
    const exp = 0.3 + g.curiosity * Math.log1p(d.newCells) * 0.6 + g.sociability * Math.log1p(d.social) * 0.4 + d.problem * 0.5 + Math.log1p(d.talks) * 0.15 + d.built / 200 + crossed;
    // Diminishing returns on capacity, with slow cumulative-culture acceleration:
    // a richer shared world (words, structures, places, discoveries) makes learning easier.
    const doneProjects = world.projects.filter((p) => p.done).length;
    const cultureBoost = 1 + 0.015 * culture.sharedWords + 0.1 * doneProjects + 0.2 * (tanksKnown - 1) + 0.15 * (culture.discoveries?.length ?? 0) + 0.1 * c.generation;
    const gain = 0.0018 * exp * g.brain * rng.lognormal(0.8) * cultureBoost / (1 + mind.neuro) ** 0.75;
    mind.neuro = round(mind.neuro + gain, 5);

    // Familiarity breeds restlessness — the pressure that may one day push them out.
    const famTank = mind.familiarity[c.tank] || {};
    const explored = Object.keys(famTank).length / 48;
    if (novelty < 0.5 && explored > 0.8) mind.restlessness = clamp(mind.restlessness + 0.004 * g.curiosity * (1 + mind.neuro));
    else if (novelty > 2) mind.restlessness = clamp(mind.restlessness - 0.1);

    // Breakthroughs: chance, not schedule.
    const eligible = CAPABILITIES.filter((cap) => !has(c, cap.id) && cap.pre.every((p) => has(c, p)) && mind.neuro >= cap.neuro * 0.7);
    for (const cap of shuffle(eligible, rng)) {
      const readiness = 1 / (1 + Math.exp(-(mind.neuro - cap.neuro) / (0.18 * cap.neuro)));
      const ex = mind.exposure?.[cap.id] ?? 0;
      const p = 0.018 * readiness * (0.5 + g.curiosity) * (1 + Math.min(ex, 20) * 0.15) * (1 + d.problem * 0.2);
      if (rng.chance(p)) {
        mind.caps[cap.id] = dayIndex;
        const first = !world.firsts[cap.id];
        if (first) world.firsts[cap.id] = { day: dayIndex, crab: c.id };
        const learned = ex > 3 ? ' (picked up from the others)' : '';
        events.push({ type: 'breakthrough', crab: c.id, cap: cap.id, major: first, text: `${c.name}: ${cap.name}${learned}. ${first ? 'A first for the colony.' : ''}`.trim() });
        remember(c, dayIndex, `understood something new: ${cap.name.toLowerCase()}`, first ? 0.85 : 0.6);
        if (cap.id === 'self-name') ensureSelfName(c, rng, events, dayIndex);
        break; // at most one per day
      }
    }
    // Sex can be revealed by the crab itself once it has the words for it.
    if (!c.sex.revealed && has(c, 'grammar') && has(c, 'self-name') && rng.chance(0.01)) {
      c.sex.revealed = true;
      events.push({ type: 'revelation', crab: c.id, major: true, text: `${c.name} made it clear, in its own words, that it is ${c.sex.value === 'F' ? 'female' : 'male'}.` });
    }
    // Memorable bits of the day
    if (d.tanksVisited.size > 1) remember(c, dayIndex, 'travelled between places', 0.7);
    const best = Object.entries(d.met).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 4) remember(c, dayIndex, `spent much of the night near ${crabsById[best[0]].name}`, 0.35);
    // stage change
    const stageNow = stageOf(mind.neuro).name;
    if (mind.stage && mind.stage !== stageNow) events.push({ type: 'stage', crab: c.id, major: true, text: `${c.name}'s mind has shifted: now ${stageNow.toLowerCase()}.` });
    mind.stage = stageNow;
  }

  function personalityDrift(c) {
    // Temperament is shaped by experience — slowly and in either direction.
    const d = c._day, g = c.genome;
    const nudge = (k, v) => { g[k] = round(clamp(g[k] + v), 4); };
    if (d.fights) nudge('boldness', (rng.chance(0.5) ? 1 : -1) * 0.004 * d.fights);
    if (d.social > 6) nudge('sociability', 0.0015);
    if (d.social === 0) nudge('sociability', -0.001);
    if (d.newCells > 2) nudge('curiosity', 0.001);
    if (d.built > 60) nudge('patience', 0.0015);
    for (const k of ['boldness', 'sociability', 'curiosity', 'aggression', 'patience', 'playfulness']) nudge(k, rng.normal(0, 0.0015));
    // relationships fade without contact
    for (const id of Object.keys(c.relations)) if (!d.met[id]) c.relations[id] = round(c.relations[id] * 0.997, 4);
  }

  function moodUpdate(c) {
    const n = c.needs;
    const discomfort = (n.hunger + n.thirst + (1 - n.humidity)) / 3;
    c.mood.stress = round(clamp(c.mood.stress * 0.7 + discomfort * 0.3 + c._day.fights * 0.1 + (c.molt.stage === 'buried' ? 0.1 : 0)), 3);
    c.mood.valence = round(clamp(c.mood.valence * 0.6 + 0.4 * (0.5 - discomfort + Math.min(c._day.social, 8) * 0.03 + c._day.newCells * 0.02 - c._day.fights * 0.1), -1, 1), 3);
  }

  function projectsUpdate() {
    for (const tank of world.tanks) {
      if (world.projects.some((p) => !p.done && p.tank === tank.id)) continue;
      const here = living.filter((c) => c.tank === tank.id);
      const builders = here.filter((c) => has(c, 'construction'));
      if (!builders.length) continue;
      const want = (cap) => here.some((c) => has(c, cap));
      const done = (type) => world.projects.some((p) => p.tank === tank.id && p.type === type && p.done);
      const restless = here.reduce((s, c) => s + c.mind.restlessness, 0) / here.length;
      let proj = null;
      if (want('escape-engineering') && !done('moss-ladder') && tank.id === 'home' && restless > 0.25) {
        const port = tank.objects.find((o) => o.kind === 'cord-port');
        proj = { type: 'moss-ladder', label: 'moss-and-shell ladder to the cord gap', x: port.x, y: port.y + 3, work: 16000, dest: 'below' };
      } else if (want('saltwater-engineering') && !world.tanks.some((t) => t.objects.some((o) => o.water === 'salt')) && !world.projects.some((p) => p.type === 'salt-pool' && !p.done)) {
        proj = { type: 'salt-pool', label: 'salt pool', x: rng.range(10, 50), y: rng.range(10, 35), work: 22000 };
      } else if (want('route-building') && restless > 0.4 && !world.projects.some((p) => p.type === 'route' && !p.done) && world.tanks.filter((t) => t.discoveredDay !== null).every((t) => here.every((c) => Object.keys(c.mind.familiarity[t.id] || {}).length > 30))) {
        proj = { type: 'route', label: 'route to somewhere new', x: rng.range(5, 55), y: 2, work: 25000 + 8000 * world.nextAnnex };
      } else if (!done('shell-cache')) {
        proj = { type: 'shell-cache', label: 'shell cache', x: rng.range(8, 20), y: rng.range(25, 40), work: 2500 };
      } else if (!done('burrow-network')) {
        proj = { type: 'burrow-network', label: 'burrow network', x: rng.range(10, 50), y: rng.range(20, 40), work: 6000 };
      } else if (rng.chance(0.01)) {
        proj = { type: 'monument', label: rng.pick(['shell circle', 'moss mound', 'sand spiral', 'pebble line']), x: rng.range(8, 52), y: rng.range(8, 38), work: 3000 };
      }
      if (proj) {
        world.projects.push({ id: `p${world.projects.length + 1}`, tank: tank.id, progress: 0, contributors: {}, done: false, startDay: dayIndex, ...proj });
        events.push({ type: 'project', major: true, text: `${builders.map((b) => b.name).join(' & ')} started work on a ${proj.label}.` });
      }
    }
  }

  function reproduction() {
    const saltIn = (tid) => tankOf(world, tid).objects.some((o) => o.water === 'salt');
    for (const f of living) {
      if (f.sex.value !== 'F' || f.gravid || f.molt.stage !== 'none' || f.body.size < 2.2) continue;
      if (!saltIn(f.tank)) continue; // larvae need the sea; nothing happens without it
      for (const m of living) {
        if (m.sex.value !== 'M' || m.tank !== f.tank || m.molt.stage !== 'none') continue;
        const bond = Math.min(f.relations[m.id] ?? 0, m.relations[f.id] ?? 0);
        if (bond > 0.45 && rng.chance(0.01 * bond)) {
          f.gravid = { father: m.id, since: dayIndex };
          const newly = [f, m].filter((x) => !x.sex.revealed);
          for (const x of newly) x.sex.revealed = true;
          const reveal = newly.length ? ` (This reveals that ${newly.map((x) => `${x.name} is ${x.sex.value === 'F' ? 'female' : 'male'}`).join(' and ')}.)` : '';
          events.push({ type: 'reproduction', crab: f.id, other: m.id, major: true, text: `${f.name} is carrying eggs — ${m.name} is the father.${reveal}` });
          break;
        }
      }
    }
    for (const f of living) {
      if (!f.gravid || dayIndex - f.gravid.since < 30) continue;
      const count = rng.int(200, 900);
      world.larvae.push({ mother: f.id, father: f.gravid.father, released: dayIndex, count, tank: f.tank });
      events.push({ type: 'reproduction', crab: f.id, major: true, text: `${f.name} released ${count} larvae into the salt pool. Most will not survive.` });
      f.gravid = null;
    }
  }

  function larvaeUpdate() {
    world.larvae = world.larvae.filter((batch) => {
      if (dayIndex - batch.released < 28) return true;
      const mother = crabsById[batch.mother], father = crabsById[batch.father];
      const nursery = living.some((c) => has(c, 'ritual') || has(c, 'science')) ? 4 : 1;
      const survivors = Math.min(4, [...Array(Math.min(batch.count, 1000))].filter(() => rng.chance(0.0012 * nursery)).length);
      for (let i = 0; i < survivors; i++) birth(mother, father, batch.tank);
      events.push({ type: 'reproduction', major: survivors > 0, text: survivors ? `${survivors} young crab${survivors > 1 ? 's' : ''} from ${mother.name} and ${father.name}'s brood came ashore.` : `None of ${mother.name}'s larvae survived to come ashore.` });
      return false;
    });
  }

  function birth(mother, father, tankId) {
    const mix = (a, b, sd = 0.06) => a * 0.5 + b * 0.5 + rng.normal(0, sd);
    const gm = mother.genome, gf = father.genome;
    const genome = {};
    for (const k of Object.keys(gm)) genome[k] = k === 'lifespanDays' ? Math.round(mix(gm[k], gf[k], 300)) : round(k === 'brain' ? Math.max(0.5, mix(gm[k], gf[k], 0.08)) : clamp(mix(gm[k], gf[k]), 0, k === 'brain' || k === 'plasticity' || k === 'metabolism' ? 3 : 1), 4);
    // Small heritable upward pressure on the brain if the parents' world was rich (selection).
    genome.brain = round(genome.brain * (1 + 0.04 * Math.log10(1 + (mother.mind.neuro + father.mind.neuro) / 2)), 4);
    const gen = Math.max(mother.generation, father.generation) + 1;
    const n = world.crabs.length + 1;
    const id = `hatchling-${n}`;
    const tank = tankOf(world, tankId);
    const child = newCrab({ id, name: `Hatchling ${n}`, genome, shell: null, pos: { x: rng.range(10, 50), y: rng.range(10, 35) }, tank: tankId, sex: rng.chance(0.5) ? 'F' : 'M', generation: gen, parents: [mother.id, father.id], day: dayIndex, size: 0.5 });
    // Heritable body plan: offspring start from the parents' bodies, plus variation.
    for (const k of ['armor', 'posture', 'dexterity', 'voice', 'legLen', 'clawL', 'clawR', 'eyeStalk', 'antenna']) child.body[k] = round(clamp(mix(mother.body[k], father.body[k], 0.03) * 0.85 + (k === 'legLen' || k.startsWith('claw') || k === 'eyeStalk' || k === 'antenna' ? 0.15 : 0.15 * 0), 0, 3), 3);
    child.body.size = 0.5;
    child.mind.neuro = round(0.02 * genome.brain * (1 + gen * 0.3), 4);
    // Parents who can name things name their child.
    if (has(mother, 'self-name') || has(father, 'self-name')) {
      const word = mother.mind.lexicon['NAME:' + mother.id]?.form ?? 'ka';
      let nm, tries = 0;
      do { nm = cap(word.replace(/-/g, '').slice(0, 3) + rng.pick(['ri', 'lo', 'shu', 'ne', 'ka', 'mi', 'ba', 'zo', 'tu', 'wi']) + (tries > 5 ? rng.pick(['n', 'k', 's']) : '')); tries++; } while (world.crabs.some((x) => x.name === nm) && tries < 20);
      child.name = nm;
    }
    child.molt.nextDue = dayIndex + rng.int(20, 40);
    tank.shells.push({ id: `sh-young-${n}`, type: 'white-moon', size: 0.6, x: child.pos.x, y: child.pos.y });
    child.shell = { type: 'white-moon', size: 0.6 };
    for (const c of living) { child.relations[c.id] = c === mother || c === father ? 0.4 : 0; c.relations[id] = c === mother || c === father ? 0.4 : 0.05; }
    world.crabs.push(child);
    crabsById[id] = child;
    events.push({ type: 'birth', crab: id, major: true, text: `A new crab, ${child.name}, joins the colony (generation ${gen}).` });
  }

  function mortality() {
    for (const c of living) {
      const age = dayIndex - c.bornDay + (c.generation === 0 ? 365 * 3 : 0);
      if (age > c.genome.lifespanDays && rng.chance(0.002)) {
        c.alive = false; c.diedDay = dayIndex;
        tankOf(world, c.tank).shells.push(c.shell ? { id: `sh-of-${c.id}`, type: c.shell.type, size: c.shell.size, x: c.pos.x, y: c.pos.y } : null);
        tankOf(world, c.tank).shells = tankOf(world, c.tank).shells.filter(Boolean);
        events.push({ type: 'death', crab: c.id, major: true, text: `${c.name} died of old age.` });
        for (const o of living) if (o !== c && (o.relations[c.id] ?? 0) > 0.3) remember(o, dayIndex, `${c.name} is gone`, 0.95);
      }
    }
  }

  // Ideas and discoveries proposed by the minds (Claude). The engine decides
  // whether they "take" — a crab must be cognitively ready, and luck matters.
  function applyMindsIdeas() {
    if (!minds?.crabs) return;
    culture.discoveries = culture.discoveries || [];
    for (const [id, m] of Object.entries(minds.crabs)) {
      const c = crabsById[id];
      if (!c || !c.alive) continue;
      if (m.thoughts) c.mind.thoughts = m.thoughts.slice(0, 8);
      if (m.focus) c.mind.focus = String(m.focus).slice(0, 200);
      if (m.idea && typeof m.idea === 'object' && m.idea.name) {
        const neuro = c.mind.neuro;
        const pTake = clamp(0.15 * Math.log10(1 + neuro * 4));
        if (neuro >= 1.2 && rng.chance(pTake)) {
          const disc = { name: String(m.idea.name).slice(0, 80), desc: String(m.idea.description ?? '').slice(0, 300), by: c.id, day: dayIndex };
          culture.discoveries.push(disc);
          c.mind.caps[`discovery:${culture.discoveries.length}`] = dayIndex;
          c.mind.neuro = round(c.mind.neuro * 1.02, 5);
          events.push({ type: 'discovery', crab: c.id, major: true, text: `${c.name} hit on something new: ${disc.name}. ${disc.desc}` });
        } else if (neuro >= 0.3) {
          c.mind.ideas = [...(c.mind.ideas || []), { day: dayIndex, name: String(m.idea.name).slice(0, 80) }].slice(-10);
        }
      }
    }
  }

  function placeThoughts() {
    const out = [];
    for (const c of living) {
      const list = intentions[c.id]?.thoughts ?? [];
      if (!list.length) continue;
      const kf = c._kf.filter((k) => k[3] !== 'molt');
      list.forEach((text, i) => {
        const k = kf.length ? kf[Math.floor(((i + 0.5) / list.length) * kf.length)] : [Math.round((i + 0.5) / list.length * DAY)];
        out.push({ t: k[0] + Math.round(rng.range(5, 60)), crab: c.id, text });
      });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  function headline() {
    const major = events.filter((e) => e.major);
    if (major.length) return major[0].text;
    const b = events.find((e) => e.type === 'breakthrough' || e.type === 'shell-swap' || e.type === 'molt');
    if (b) return b.text;
    const talkers = speech.length;
    return talkers ? `A quiet day. ${talkers} chirps and exchanges were overheard.` : 'A quiet day in the tank.';
  }
}

function shuffle(a, rng) { return a.map((x) => [rng.next(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]); }
function round(v, d = 2) { const f = 10 ** d; return Math.round(v * f) / f; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
