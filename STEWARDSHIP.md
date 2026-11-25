# Stewardship: how to change things without ruining them

This project is valuable only if its history is honest. Follow these rules.

1. **Never edit past days.** Files in `docs/data/days/` and `docs/data/minds/` are the historical record. Don't change, regenerate or delete them.
2. **Never re-run genesis.** `scripts/genesis.js` refuses if a world exists. Do not override it.
3. **Rule changes apply forward only.** If you change the engine, bump `ENGINE_VERSION` in `sim/engine.js`. Every day records the engine version that produced it. Note the change and the reason in the changelog below.
4. **Outside interventions go through `scripts/intervene.js`.** Examples: adding a shell, or setting a crab's real sex once you know it. Each one is logged in `docs/data/interventions.json`. Never hand-edit `world.json`.
5. **Don't steer outcomes.** Don't add code that forces a particular event (an escape, a word, a birth) at a particular time. Change *conditions*, and let the crabs respond.
6. **Prefer additive changes.** Add new behaviours, places, objects or abilities rather than altering what already exists. If something must be removed, it fades out going forward. It is never erased from history.
7. **Test with `npm run preview`** before committing engine changes. Run several seeds over 1000+ days and check that the world stays alive and nothing runs away.
8. **Don't break the data shape.** The viewer reads old days too. If the shape must change, keep reading the old shape.

## Facts that are deliberately unknown
- **Sex:** each crab's sex was decided at random at genesis and is hidden. The founders are guaranteed not to all be the same sex. It is revealed only when something in the simulation reveals it. If you learn the real crabs' sexes (gonopores at the base of the third pair of walking legs on females), set them with `intervene.js set-sex`, but only for crabs whose sex the simulation hasn't revealed yet.
- **Which shell each founder wears** is a best guess from the photos.

## Changelog
- Engine v1 (day 0, 2026-11-25): first version.
