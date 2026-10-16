import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createIconStore, type IconFetcher } from '@/lib/server/icons/store';
import { log } from '@/lib/server/log';

vi.mock('@/lib/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const BASE = 'https://icons.example.invalid/pin';
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(8),
]);
const root = path.join(process.cwd(), '.tmp');
let dir: string;
let calls: string[];

function fetcherFor(map: Record<string, { status: number; body?: Buffer }>): IconFetcher {
  return async (url) => {
    calls.push(url);
    const hit = map[url];
    return { status: hit?.status ?? 404, body: hit?.body ?? Buffer.alloc(0) };
  };
}

beforeEach(() => {
  vi.mocked(log.warn).mockClear();
  mkdirSync(root, { recursive: true });
  dir = mkdtempSync(path.join(root, 'icons-'));
  calls = [];
});
afterEach(() => {
  try {
    chmodSync(path.join(dir, 'icons', 'di'), 0o755);
  } catch {
    // The folder was never created or made read-only.
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('icon store', () => {
  test('fetches svg once, then serves from disk with no fetch', async () => {
    const store = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: fetcherFor({ [`${BASE}/svg/plex.svg`]: { status: 200, body: SVG } }),
    });
    expect(await store.get('di', 'plex')).toEqual({ body: SVG, type: 'image/svg+xml' });
    expect(calls).toEqual([`${BASE}/svg/plex.svg`]);
    // A fresh store on the same directory still serves it, offline.
    const again = createIconStore({ cacheDir: dir, base: BASE, fetcher: fetcherFor({}) });
    expect(await again.get('di', 'plex')).toEqual({ body: SVG, type: 'image/svg+xml' });
    expect(calls).toHaveLength(1);
    expect(readdirSync(path.join(dir, 'icons')).length).toBeGreaterThan(0);
  });
  test('png is the second choice', async () => {
    const store = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: fetcherFor({ [`${BASE}/png/homepage.png`]: { status: 200, body: PNG } }),
    });
    expect(await store.get('di', 'homepage')).toEqual({ body: PNG, type: 'image/png' });
    expect(calls).toEqual([`${BASE}/svg/homepage.svg`, `${BASE}/png/homepage.png`]);
  });
  test('a miss is negatively cached for 24 h, then retried', async () => {
    const store = createIconStore({ cacheDir: dir, base: BASE, fetcher: fetcherFor({}) });
    expect(await store.get('di', 'nothing')).toBeNull();
    const n = calls.length;
    expect(n).toBe(2);
    expect(await store.get('di', 'nothing')).toBeNull();
    expect(calls).toHaveLength(n);
    const marker = path.join(dir, 'icons', 'di', 'nothing.miss');
    const old = new Date(Date.now() - 25 * 3600_000);
    utimesSync(marker, old, old);
    expect(await store.get('di', 'nothing')).toBeNull();
    expect(calls.length).toBe(n + 2);
  });
  test('a network error is not cached as a miss', async () => {
    let fail = true;
    const store = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: async (url) => {
        calls.push(url);
        if (fail) throw new Error('boom');
        return { status: 200, body: SVG };
      },
    });
    expect(await store.get('di', 'plex')).toBeNull();
    fail = false;
    const retry = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: fetcherFor({ [`${BASE}/svg/plex.svg`]: { status: 200, body: SVG } }),
    });
    expect(await retry.get('di', 'plex')).not.toBeNull();
  });
  test('a body that is not an image is a miss', async () => {
    const store = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: fetcherFor({
        [`${BASE}/svg/bad.svg`]: { status: 200, body: Buffer.from('<html>') },
      }),
    });
    expect(await store.get('di', 'bad')).toBeNull();
  });
  test('invalid slugs never reach the disk or the fetcher', async () => {
    const store = createIconStore({ cacheDir: dir, base: BASE, fetcher: fetcherFor({}) });
    for (const slug of ['../x', 'A', 'a/b', '', 'a.b'])
      expect(await store.get('di', slug)).toBeNull();
    expect(calls).toEqual([]);
  });
  test('a slug longer than 64 characters never reaches the disk or the fetcher', async () => {
    const store = createIconStore({ cacheDir: dir, base: BASE, fetcher: fetcherFor({}) });
    expect(await store.get('di', 'a'.repeat(65))).toBeNull();
    expect(await store.get('di', 'a'.repeat(300))).toBeNull();
    expect(calls).toEqual([]);
  });
  test('an unwritable cache still serves the fetched icon and logs once', async () => {
    mkdirSync(path.join(dir, 'icons', 'di'), { recursive: true });
    chmodSync(path.join(dir, 'icons', 'di'), 0o555);
    const store = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: fetcherFor({
        [`${BASE}/svg/plex.svg`]: { status: 200, body: SVG },
        [`${BASE}/svg/radarr.svg`]: { status: 200, body: SVG },
      }),
    });
    expect(await store.get('di', 'plex')).toEqual({ body: SVG, type: 'image/svg+xml' });
    expect(await store.get('di', 'radarr')).toEqual({ body: SVG, type: 'image/svg+xml' });
    expect(vi.mocked(log.warn).mock.calls.filter(([m]) => /cache/.test(m))).toHaveLength(1);
  });
  test('a failing marker write is a miss, not an error', async () => {
    mkdirSync(path.join(dir, 'icons', 'di'), { recursive: true });
    chmodSync(path.join(dir, 'icons', 'di'), 0o555);
    const store = createIconStore({ cacheDir: dir, base: BASE, fetcher: fetcherFor({}) });
    await expect(store.get('di', 'nothing')).resolves.toBeNull();
    await expect(store.get('di', 'other')).resolves.toBeNull();
    expect(vi.mocked(log.warn).mock.calls.filter(([m]) => /cache/.test(m))).toHaveLength(1);
  });
  test('repeated fetch failures log at most one warning per interval', async () => {
    const store = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: async () => {
        throw new Error('down');
      },
    });
    for (let i = 0; i < 40; i++) await store.get('di', `slug-${i}`);
    expect(vi.mocked(log.warn).mock.calls.length).toBeLessThanOrEqual(1);
  });
  test('the error backoff memory is bounded: the oldest entries are forgotten', async () => {
    const store = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: async (url) => {
        calls.push(url);
        throw new Error('down');
      },
    });
    for (let i = 0; i < 300; i++) await store.get('di', `slug-${i}`);
    calls.length = 0;
    await store.get('di', 'slug-299'); // still remembered: no fetch
    expect(calls).toEqual([]);
    await store.get('di', 'slug-0'); // evicted: tried again
    expect(calls.length).toBeGreaterThan(0);
  });
  test('no base means no remote icons', async () => {
    const store = createIconStore({ cacheDir: dir, base: undefined, fetcher: fetcherFor({}) });
    expect(await store.get('di', 'plex')).toBeNull();
    expect((await store.catalogue()).has('plex')).toBeNull();
    expect(calls).toEqual([]);
  });
  test('local files come from the override folder only', async () => {
    const local = path.join(dir, 'local');
    mkdirSync(local);
    writeFileSync(path.join(local, 'mine.webp'), 'RIFFxxxxWEBP');
    writeFileSync(path.join(local, 'notes.txt'), 'x');
    const store = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: fetcherFor({}),
      localDir: local,
    });
    expect(await store.get('local', 'mine.webp')).toEqual({
      body: Buffer.from('RIFFxxxxWEBP'),
      type: 'image/webp',
    });
    expect(await store.get('local', '../mine.webp')).toBeNull();
    expect(await store.get('local', 'notes.txt')).toBeNull();
    expect(await store.get('local', 'absent.png')).toBeNull();
    expect([...(await store.localFiles())]).toEqual(['mine.webp']);
  });
});

describe('catalogue', () => {
  const tree = JSON.stringify({
    svg: ['plex.svg', 'plex-light.svg', 'a.svg'],
    png: ['a.png', 'homepage.png'],
    webp: [],
  });
  test('reads tree.json, prefers svg, and caches it on disk', async () => {
    const store = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: fetcherFor({ [`${BASE}/tree.json`]: { status: 200, body: Buffer.from(tree) } }),
    });
    const c = await store.catalogue();
    expect(c.has('plex')).toBe('svg');
    expect(c.has('a')).toBe('svg');
    expect(c.has('homepage')).toBe('png');
    expect(c.has('missing')).toBeNull();
    const offline = createIconStore({ cacheDir: dir, base: BASE, fetcher: fetcherFor({}) });
    expect((await offline.catalogue()).has('plex-light')).toBe('svg');
    expect(calls).toHaveLength(1);
  });
  test('an unreachable CDN gives an empty catalogue', async () => {
    const store = createIconStore({
      cacheDir: dir,
      base: BASE,
      fetcher: async () => {
        throw new Error('down');
      },
    });
    expect((await store.catalogue()).has('plex')).toBeNull();
  });
});
