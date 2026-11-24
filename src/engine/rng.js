// Seeded RNG (mulberry32). The whole state is one 32-bit integer, so a game
// can be saved/replayed by storing `rng.state`.

export class Rng {
  constructor(seed = 1) {
    this.state = (seed >>> 0) || 1;
  }

  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  chance(p) { return this.next() < p; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** Standard normal via Box-Muller (uses two draws). */
  normal(mean = 0, sd = 1) {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Pick an item with probability proportional to weight(item). */
  weighted(items, weight) {
    let total = 0;
    const ws = items.map((it) => {
      const w = Math.max(0, weight(it));
      total += w;
      return w;
    });
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= ws[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }
}

export function mulberry32(seed) {
  const r = new Rng(seed);
  return () => r.next();
}
