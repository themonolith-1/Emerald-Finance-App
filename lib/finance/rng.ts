function hashStringToUint32(input: string): number {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRng(seed: string) {
  let state = hashStringToUint32(seed) || 1;

  // Mulberry32
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (minInclusive: number, maxInclusive: number) => {
    const r = next();
    return Math.floor(r * (maxInclusive - minInclusive + 1)) + minInclusive;
  };

  const float = (minInclusive: number, maxInclusive: number) => {
    return next() * (maxInclusive - minInclusive) + minInclusive;
  };

  const pick = <T,>(arr: readonly T[]): T => {
    return arr[int(0, arr.length - 1)];
  };

  return { next, int, float, pick };
}
