// Deterministic random numbers. Every day of the simulation is seeded from the
// world seed + the date, so a day can always be re-derived exactly.

export function hashString(str) {
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) * 4294967296 + (h1 >>> 0);
}

export function makeRng(seedStr) {
  let a = hashString(String(seedStr)) % 4294967296;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    normal: (mu = 0, sd = 1) => {
      const u = Math.max(1e-12, next()), v = next();
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    // multiplicative noise centred on 1 — used so growth is lumpy, never clockwork
    lognormal: (sd = 0.5) => Math.exp(rng.normal(-sd * sd / 2, sd)),
    weighted: (entries) => {
      // entries: [[item, weight], ...]
      const total = entries.reduce((s, e) => s + Math.max(0, e[1]), 0);
      if (total <= 0) return entries[0][0];
      let r = next() * total;
      for (const [item, w] of entries) { r -= Math.max(0, w); if (r <= 0) return item; }
      return entries[entries.length - 1][0];
    },
    fork: (label) => makeRng(String(seedStr) + '/' + label),
  };
  return rng;
}

export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
