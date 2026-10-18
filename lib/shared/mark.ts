// Iris's mark: the crystal ball from the Overview, still. A glowing pink rim on the page's dark
// ground, dust settled in the lower half and a few sparks above it. Colours are the theme's
// (globals.css) written out, since an icon is drawn outside the page.

const BG = '#0b0710';
const PINK = '#f25bd0';
const PINK_SOFT = '#ff9fe6';
// The rim's hot core, as the static ball's: pink pulled toward white.
const RIM_HOT = '#f9b5ea';

const C = 32;
// The ball's radius: on the square it sits on the dark ground; round, it is the whole icon, with
// just enough room left for the rim's glow.
const RADIUS = { square: 22, round: 25.5 } as const;

// A fixed seed, so every build draws the same dust.
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Dust as circles: dense low in the ball, thinning upward, all inside the rim. */
function dust(R: number) {
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
 * The mark as an SVG document on a 64 unit square. `round` is the browser favicon: the ball alone on
 * a clear ground, its inside filled dark so it reads on a light tab bar. `square` is the Apple touch
 * icon, on the dark ground edge to edge, since iOS masks it and would turn a clear ground black.
 */
export function markSvg({ shape }: { shape: 'round' | 'square' }) {
  const R = RADIUS[shape];
  const ground =
    shape === 'square'
      ? `<rect width="64" height="64" fill="${BG}"/><circle cx="${C}" cy="${C}" r="${R + 8}" fill="url(#haze)"/>`
      : `<circle cx="${C}" cy="${C}" r="${R}" fill="${BG}"/>`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<defs>',
    `<radialGradient id="haze" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${PINK}" stop-opacity="0.16"/><stop offset="1" stop-color="${PINK}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="pool" cx="50%" cy="100%" r="70%"><stop offset="0" stop-color="${PINK}" stop-opacity="0.7"/><stop offset="0.55" stop-color="${PINK}" stop-opacity="0.2"/><stop offset="1" stop-color="${PINK}" stop-opacity="0"/></radialGradient>`,
    '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>',
    `<clipPath id="inside"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>`,
    '</defs>',
    ground,
    `<g clip-path="url(#inside)"><rect x="${C - R}" y="${C - R}" width="${R * 2}" height="${R * 2}" fill="url(#pool)"/>${dust(R)}</g>`,
    `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${PINK}" stroke-width="5" filter="url(#glow)"/>`,
    `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${RIM_HOT}" stroke-width="3"/>`,
    '</svg>',
  ].join('');
}
