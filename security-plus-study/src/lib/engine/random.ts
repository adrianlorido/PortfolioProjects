export type Rng = () => number;

/** Small, fast deterministic PRNG (mulberry32). Deterministic seeds keep tests reproducible. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Weighted sampling without replacement (Efraimidis–Spirakis).
 * Items with weight <= 0 are never selected.
 */
export function weightedSample<T>(items: readonly T[], weight: (item: T) => number, count: number, rng: Rng = Math.random): T[] {
  const keyed: { item: T; key: number }[] = [];
  for (const item of items) {
    const w = weight(item);
    if (!(w > 0)) continue;
    const u = Math.max(rng(), Number.EPSILON);
    keyed.push({ item, key: Math.log(u) / w });
  }
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, Math.max(0, count)).map((k) => k.item);
}
