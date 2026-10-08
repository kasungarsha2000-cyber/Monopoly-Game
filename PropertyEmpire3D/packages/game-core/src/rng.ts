/**
 * Small deterministic PRNG (mulberry32). The generator state is a single
 * 32-bit integer stored in the game state, so dice and shuffles are fully
 * reproducible from a seed and survive save/load. Only the authoritative
 * host (solo engine or LAN server) ever advances it.
 */

/** Advance a mulberry32 state. Returns the next state and a float in [0, 1). */
export function mulberry32Next(state: number): { state: number; value: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: next, value };
}

/** Object holding an RNG state, e.g. the GameState. */
export interface RngHolder {
  rngState: number;
}

/** Float in [0, 1) that advances holder.rngState. */
export function nextFloat(holder: RngHolder): number {
  const r = mulberry32Next(holder.rngState);
  holder.rngState = r.state;
  return r.value;
}

/** Integer in [min, max] inclusive. */
export function nextInt(holder: RngHolder, min: number, max: number): number {
  return min + Math.floor(nextFloat(holder) * (max - min + 1));
}

/** In-place Fisher-Yates shuffle. */
export function shuffleInPlace<T>(holder: RngHolder, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(holder, 0, i);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}

/** Standalone seeded random function, used by bots so they never consume game dice randomness. */
export function createRandom(seed: number): () => number {
  const holder: RngHolder = { rngState: seed >>> 0 };
  return () => nextFloat(holder);
}

/** A non-deterministic 32-bit seed using Web Crypto when available. */
export function randomSeed(): number {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  if (g.crypto?.getRandomValues) {
    const a = new Uint32Array(1);
    g.crypto.getRandomValues(a);
    return a[0] as number;
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
