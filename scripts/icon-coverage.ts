// Dev script: prints the handoff §11 coverage table for the §6 slugs. Uses the network.
// Run: scripts/dev.sh node --experimental-strip-types scripts/icon-coverage.ts
const BASE =
  process.env.IRIS_ICONS_BASE ??
  'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@f1d048d9885b97a7319e0a51e508217459f212df';

const SLUGS = [
  'plex',
  'tautulli',
  'overseerr',
  'radarr',
  'sonarr',
  'prowlarr',
  'bazarr',
  'profilarr',
  'maintainerr',
  'qbittorrent',
  'autobrr',
  'cleanuperr',
  'flaresolverr',
  'gotify',
  'glances',
  'docker',
  'mealie',
  'gluetun',
  'cloudflare',
];

const res = await fetch(`${BASE}/tree.json`);
if (!res.ok) throw new Error(`tree.json: HTTP ${res.status}`);
const tree = (await res.json()) as Record<string, string[]>;
const names = (k: string) => new Set((tree[k] ?? []).map((n) => n.replace(/\.[^.]+$/, '')));
const svg = names('svg');
const png = names('png');

let missing = 0;
console.log(`base: ${BASE}\n`);
console.log('slug'.padEnd(14) + 'result'.padEnd(8) + 'variants');
for (const slug of SLUGS) {
  const result = svg.has(slug) ? 'svg' : png.has(slug) ? 'png' : 'MISS';
  if (result === 'MISS') missing++;
  const variants = [
    svg.has(`${slug}-dark`) || png.has(`${slug}-dark`) ? 'light theme: -dark' : '',
    svg.has(`${slug}-light`) || png.has(`${slug}-light`) ? 'dark theme: -light' : '',
  ]
    .filter(Boolean)
    .join(', ');
  console.log(slug.padEnd(14) + result.padEnd(8) + variants);
}
console.log(`\n${SLUGS.length - missing}/${SLUGS.length} found`);
process.exitCode = missing ? 1 : 0;

export {};
