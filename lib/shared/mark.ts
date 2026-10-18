// Iris's mark: the crystal ball from the Overview, still. A glowing pink rim on the page's dark
// ground, dust settled in the lower half and a few sparks above it. Colours are the theme's
// (globals.css) written out, since an icon is drawn outside the page.

const BG = '#0b0710';
const PINK = '#f25bd0';
const PINK_SOFT = '#ff9fe6';
// The rim's hot core, as the static ball's: pink pulled toward white.
const RIM_HOT = '#f9b5ea';

const C = 32;
const R = 22;

// A fixed seed, so every build draws the same dust.
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Dust as circles: dense low in the ball, thinning upward, all inside the rim. */
function dust() {
  const next = random(7);
  const dots: string[] = [];
  const inner = R - 2;
  for (let i = 0; i < 170; i++) {
    // Biased low, so the dust fills the ball to about its middle and thins into sparks above.
    const y = C + inner - Math.pow(next(), 1.8) * inner * 2;
    // Spread across the ball's width at that height.
    const half = Math.sqrt(Math.max(inner * inner - (y - C) * (y - C), 0));
    const x = C + (next() * 2 - 1) * half;
    const depth = (y - (C - R)) / (R * 2);
    const r = 0.25 + next() * 0.4 * depth;
    const fill = next() < 0.3 ? PINK_SOFT : PINK;
    const opacity = 0.45 + depth * 0.55;
    dots.push(
      `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" fill="${fill}" opacity="${opacity.toFixed(2)}"/>`,
    );
  }
  return dots.join('');
}

/**
 * The mark as an SVG document on a 64 unit square. `rounded` gives the browser favicon its own
 * corners; the Apple touch icon stays square, since iOS masks it.
 */
export function markSvg({ rounded }: { rounded: boolean }) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<defs>',
    `<radialGradient id="haze" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${PINK}" stop-opacity="0.16"/><stop offset="1" stop-color="${PINK}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="pool" cx="50%" cy="100%" r="70%"><stop offset="0" stop-color="${PINK}" stop-opacity="0.7"/><stop offset="0.55" stop-color="${PINK}" stop-opacity="0.2"/><stop offset="1" stop-color="${PINK}" stop-opacity="0"/></radialGradient>`,
    '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>',
    `<clipPath id="inside"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>`,
    '</defs>',
    `<rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="${BG}"/>`,
    `<circle cx="${C}" cy="${C}" r="${R + 8}" fill="url(#haze)"/>`,
    `<g clip-path="url(#inside)"><rect x="${C - R}" y="${C - R}" width="${R * 2}" height="${R * 2}" fill="url(#pool)"/>${dust()}</g>`,
    `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${PINK}" stroke-width="5" filter="url(#glow)"/>`,
    `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${RIM_HOT}" stroke-width="3"/>`,
    '</svg>',
  ].join('');
}
