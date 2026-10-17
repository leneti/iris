export const MAX_STRANDS = 8;
export const MAX_ARCS = 4;
export const MAX_PARTICLES = 40000;
export const STATE_WIDTH = 256;

export type Rgb = number[];

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

export const mixColor = (a: Rgb, b: Rgb, t: number): Rgb =>
  a.map((v, i) => v + ((b[i] ?? 0) - v) * t);

export const wrapAngle = (a: number): number =>
  a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

/** A small deterministic generator (mulberry32). */
export const seeded = (start: number): (() => number) => {
  let state = start >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
