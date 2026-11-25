# Hermit Crab Sim

A live, perpetual simulation of four hermit crabs: **Sheladon, Sheladactyl, Spike and Kyle**. They live in a virtual copy of their real tank, with the same coconut hut, moss trail, pellet pile, sea sponge, green water dish and two heat lamps.

They begin as ordinary land hermit crabs (*Coenobita*). Over a long time they may learn from each other, invent a language, change shape across molts, build things, find a way out, and have young. Nothing is scripted. Nobody, including the people who built it, knows where it goes.

**Watch it:** the viewer lives in `docs/` and is published with GitHub Pages. Anyone with the link sees the same crabs at the same moment.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Engine | `sim/engine.js` | Simulates each day minute by minute: needs (hunger, thirst, gill humidity, energy), nocturnal rhythm, foraging, bathing, basking, burrowing, climbing, shell inspection and swaps, shell fights, piling and chirping. Then the slow changes: learning, language, molts, personality drift, building, reproduction. |
| World | `sim/world.js` | The tank layout from the photos, the tank below, procedurally generated places beyond, and the list of abilities that *can* emerge. |
| Language | `sim/language.js` | Words are invented by individual crabs and spread through a "naming game". The group converges on a shared vocabulary. Separated groups drift into dialects. |
| Minds | `sim/minds.js` | Once a day Claude writes each crab's thoughts, held to that crab's current level of mind, plus an observer's journal. Claude cannot change the world. It can only nudge tomorrow's inclinations and propose ideas, which the engine may or may not accept. Without an API key, simple rule-based thoughts are used. |
| Daily job | `.github/workflows/advance.yml` | Runs every day, simulates through tomorrow (UTC), and commits the result to `docs/data/`. |
| Viewer | `docs/` | A top-down live tank, speech and thought bubbles, crab profiles, journal, vocabulary and growth charts. Any past day can be replayed at up to 1200× speed. |

### Why it isn't on a timeline
Each ability has a minimum "readiness" of mind and some prerequisites. Once a crab is ready, there is only a daily *chance* of a breakthrough. That chance rises with curiosity, problem solving, novelty, and contact with crabs that already have the ability. Growth slows as a mind gets larger and speeds up as the shared culture gets richer (more words, structures, places and discoveries). Different random seeds produce clearly different histories. You can see this with `npm run preview -- 1500 some-seed`, which never touches the real data.

## Setup (one time)

1. **Make this branch the main branch.** Merge it into `main`. Scheduled GitHub Actions only run on the default branch.
2. **Turn on GitHub Pages.** Settings → Pages → *Deploy from a branch* → `main` / `/docs`.
3. **Allow the daily job to commit.** Settings → Actions → General → Workflow permissions → *Read and write*.
4. **Give the crabs their minds (optional, recommended).** Settings → Secrets and variables → Actions → New secret `ANTHROPIC_API_KEY`. Cost is roughly one Claude request per day. Without it the simulation still runs, with simpler rule-based thoughts.
5. Optionally run the workflow once by hand (Actions → *Advance the crabs* → Run workflow).

The tank clock uses `America/New_York` (lamps on 08:00–20:00). This is set in `docs/data/world.json` (`timezone`). Changing it only affects days not yet simulated.

## Commands

```bash
npm install
npm run advance            # simulate any missing days through tomorrow (uses ANTHROPIC_API_KEY if set)
npm run preview -- 800 x   # dry run 800 days with seed "x" in memory; prints what happened
npm run serve              # view docs/ locally at http://localhost:8080
node scripts/intervene.js note "Cleaned the real tank today"
```

See **STEWARDSHIP.md** before changing anything, and **RESEARCH.md** for the hermit crab biology the simulation is built on.
