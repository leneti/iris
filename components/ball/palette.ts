import { clamp, mixColor, type Rgb } from './math';

export type Palette = {
  rim: Rgb;
  rimHot: Rgb;
  rimMid: Rgb;
  rimDeep: Rgb;
  spark: Rgb;
  sparkGlow: Rgb;
  haze: Rgb;
  edge: Rgb;
  tones: Rgb[];
};

const WHITE: Rgb = [1, 1, 1];
const BLACK: Rgb = [0, 0, 0];

/** A CSS colour as sRGB channels 0..1; `fallback` if the browser cannot resolve it. */
export const parseColor = (value: string, fallback: Rgb): Rgb => {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return fallback;
    ctx.fillStyle = '#000000';
    ctx.fillStyle = value;
    const resolved = ctx.fillStyle;
    if (resolved.startsWith('#')) {
      const n = parseInt(resolved.slice(1), 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    const parts = resolved.match(/[\d.]+/g);
    if (!parts || parts.length < 3) return fallback;
    return [Number(parts[0]) / 255, Number(parts[1]) / 255, Number(parts[2]) / 255];
  } catch {
    return fallback;
  }
};

const toLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toGamma = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const toOklab = (rgb: Rgb): Rgb => {
  const [r = 0, g = 0, b = 0] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const fromOklab = ([L = 0, a = 0, b = 0]: Rgb): Rgb => {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => clamp(toGamma(clamp(v, 0, 1)), 0, 1));
};

const blend = (a: Rgb, b: Rgb, t: number): Rgb => fromOklab(mixColor(toOklab(a), toOklab(b), t));

const shift = (rgb: Rgb, hue: number, lightness: number, chroma: number): Rgb => {
  const [L = 0, a = 0, b = 0] = toOklab(rgb);
  const c = Math.hypot(a, b) * chroma;
  const h = Math.atan2(b, a) + (hue * Math.PI) / 180;
  return fromOklab([clamp(L + lightness, 0, 1), c * Math.cos(h), c * Math.sin(h)]);
};

/** The dark-theme palette: the rim, its glow, the haze and the five dust tones. */
export const buildPalette = (color: Rgb): Palette => ({
  rim: color,
  rimHot: mixColor(color, WHITE, 0.72),
  rimMid: mixColor(color, BLACK, 0.15),
  rimDeep: mixColor(color, BLACK, 0.45),
  spark: mixColor(color, WHITE, 0.45),
  sparkGlow: shift(color, 0, -0.15, 1),
  haze: mixColor(color, BLACK, 0.6),
  edge: shift(color, 0, -0.3, 0.9),
  tones: [
    shift(color, 0, -0.06, 1),
    shift(color, 16, -0.02, 1),
    shift(color, -16, -0.12, 1.05),
    shift(blend(color, WHITE, 0.25), 0, 0.04, 1),
    blend(color, WHITE, 0.7),
  ],
});

/** Cross-fade two palettes entry by entry. */
export const mixPalette = (a: Palette, b: Palette, t: number): Palette => ({
  rim: mixColor(a.rim, b.rim, t),
  rimHot: mixColor(a.rimHot, b.rimHot, t),
  rimMid: mixColor(a.rimMid, b.rimMid, t),
  rimDeep: mixColor(a.rimDeep, b.rimDeep, t),
  spark: mixColor(a.spark, b.spark, t),
  sparkGlow: mixColor(a.sparkGlow, b.sparkGlow, t),
  haze: mixColor(a.haze, b.haze, t),
  edge: mixColor(a.edge, b.edge, t),
  tones: a.tones.map((tone, i) => mixColor(tone, b.tones[i] ?? tone, t)),
});
