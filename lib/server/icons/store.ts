import 'server-only';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../env';
import { httpRequest } from '../http';
import { log } from '../log';
import { LOCAL_FILE, SLUG, type IconCatalogue } from './resolve';

export type IconFetcher = (
  url: string,
  limits: { timeoutMs: number; maxBytes: number },
) => Promise<{ status: number; body: Buffer }>;

export type IconBody = { body: Buffer; type: string };

export type IconStore = {
  get(kind: 'di' | 'local', name: string): Promise<IconBody | null>;
  catalogue(): Promise<IconCatalogue>;
  localFiles(): Promise<Set<string>>;
};

const ICON_TIMEOUT_MS = 5_000;
const ICON_MAX_BYTES = 1024 * 1024;
const TREE_MAX_BYTES = 4 * 1024 * 1024;
const DAY_MS = 24 * 3600_000;
const ERROR_BACKOFF_MS = 60_000;
const BACKOFF_MAX_ENTRIES = 256;
const WARN_INTERVAL_MS = 60_000;

const TYPES = { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp' } as const;
type Ext = keyof typeof TYPES;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
function looksLike(ext: Ext, body: Buffer): boolean {
  if (ext === 'svg') return body.subarray(0, 2048).toString('utf8').includes('<svg');
  if (ext === 'png') return body.subarray(0, 4).equals(PNG_MAGIC);
  return body.subarray(0, 4).toString('latin1') === 'RIFF';
}

export const defaultFetcher: IconFetcher = async (url, limits) => {
  const res = await httpRequest({ url, method: 'GET', ...limits });
  return { status: res.status, body: res.body };
};

async function ageMs(file: string): Promise<number | null> {
  try {
    return Date.now() - (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

async function readIfExists(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export function createIconStore(opts: {
  cacheDir: string;
  base: string | undefined;
  fetcher?: IconFetcher;
  /** The override folder (`<configDir>/icons`). */
  localDir?: string;
}): IconStore {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.base?.replace(/\/+$/, '');
  const root = path.join(opts.cacheDir, 'icons');
  const inflight = new Map<string, Promise<IconBody | null>>();
  // Insertion-ordered, so the first key is the oldest. Bounded by BACKOFF_MAX_ENTRIES.
  const backoff = new Map<string, number>();
  const lastWarn = new Map<string, number>();

  /** Warns at most once per interval per kind of problem (a fixed, small set of keys). */
  function warnLimited(key: string, message: string, fields: Record<string, unknown>): void {
    const now = Date.now();
    const last = lastWarn.get(key);
    if (last !== undefined && now - last < WARN_INTERVAL_MS) return;
    lastWarn.set(key, now);
    log.warn(message, fields);
  }

  function remember(slug: string): void {
    backoff.delete(slug);
    backoff.set(slug, Date.now() + ERROR_BACKOFF_MS);
    if (backoff.size > BACKOFF_MAX_ENTRIES) {
      const oldest = backoff.keys().next().value;
      if (oldest !== undefined) backoff.delete(oldest);
    }
  }

  async function cached(slug: string): Promise<IconBody | null> {
    for (const ext of ['svg', 'png'] as const) {
      const body = await readIfExists(path.join(root, 'di', `${slug}.${ext}`));
      if (body) return { body, type: TYPES[ext] };
    }
    return null;
  }

  async function download(slug: string): Promise<IconBody | null> {
    const marker = path.join(root, 'di', `${slug}.miss`);
    const missAge = await ageMs(marker);
    if (missAge !== null && missAge < DAY_MS) return null;
    if ((backoff.get(slug) ?? 0) > Date.now()) return null;
    if (!base) return null;

    let definitive = true;
    for (const ext of ['svg', 'png'] as const) {
      try {
        const res = await fetcher(`${base}/${ext}/${slug}.${ext}`, {
          timeoutMs: ICON_TIMEOUT_MS,
          maxBytes: ICON_MAX_BYTES,
        });
        if (res.status === 200 && looksLike(ext, res.body)) {
          // The cache is only an optimisation: serve the icon even when it cannot be kept.
          await writeAtomic(path.join(root, 'di', `${slug}.${ext}`), res.body).catch((err) =>
            warnLimited('cache-write', 'icon cache is not writable', { error: err }),
          );
          return { body: res.body, type: TYPES[ext] };
        }
        if (res.status !== 200 && res.status !== 404) definitive = false;
      } catch (err) {
        definitive = false;
        warnLimited('fetch', 'icon fetch failed', { slug, error: err });
      }
    }
    if (definitive) {
      await writeAtomic(marker, '').catch(() => {
        // No marker: remember the miss in memory for a minute instead.
        remember(slug);
        warnLimited('cache-write', 'icon cache is not writable', {});
      });
    } else {
      remember(slug);
    }
    return null;
  }

  async function getDi(slug: string): Promise<IconBody | null> {
    const hit = await cached(slug);
    if (hit) return hit;
    const running = inflight.get(slug);
    if (running) return running;
    const p = download(slug).finally(() => inflight.delete(slug));
    inflight.set(slug, p);
    return p;
  }

  async function getLocal(file: string): Promise<IconBody | null> {
    if (!opts.localDir || !LOCAL_FILE.test(file)) return null;
    const ext = file.slice(file.lastIndexOf('.') + 1) as Ext;
    const body = await readIfExists(path.join(opts.localDir, file));
    return body ? { body, type: TYPES[ext] } : null;
  }

  const emptyCatalogue: IconCatalogue = { has: () => null };

  function parseTree(raw: Buffer): IconCatalogue | null {
    try {
      const tree = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      const names = (key: string): Set<string> =>
        new Set(
          (Array.isArray(tree[key]) ? (tree[key] as unknown[]) : [])
            .filter((n): n is string => typeof n === 'string')
            .map((n) => n.slice(0, n.lastIndexOf('.'))),
        );
      const svg = names('svg');
      const png = names('png');
      return { has: (slug) => (svg.has(slug) ? 'svg' : png.has(slug) ? 'png' : null) };
    } catch {
      return null;
    }
  }

  let treeMemo: { at: number; value: IconCatalogue } | null = null;
  let treeInflight: Promise<IconCatalogue> | null = null;

  async function loadCatalogue(): Promise<IconCatalogue> {
    const file = path.join(root, 'tree.json');
    const onDisk = await readIfExists(file);
    const age = await ageMs(file);
    const disk = onDisk ? parseTree(onDisk) : null;
    if (disk && age !== null && age < DAY_MS) return disk;
    if (base) {
      try {
        const res = await fetcher(`${base}/tree.json`, {
          timeoutMs: ICON_TIMEOUT_MS,
          maxBytes: TREE_MAX_BYTES,
        });
        const fresh = res.status === 200 ? parseTree(res.body) : null;
        if (fresh) {
          await writeAtomic(file, res.body).catch((err) =>
            warnLimited('cache-write', 'icon cache is not writable', { error: err }),
          );
          return fresh;
        }
      } catch (err) {
        warnLimited('fetch', 'icon catalogue fetch failed', { error: err });
      }
    }
    return disk ?? emptyCatalogue;
  }

  return {
    async get(kind, name) {
      if (kind === 'local') return getLocal(name);
      return SLUG.test(name) ? getDi(name) : null;
    },
    async catalogue() {
      if (treeMemo && Date.now() - treeMemo.at < 5 * 60_000) return treeMemo.value;
      treeInflight ??= loadCatalogue()
        .then((value) => {
          treeMemo = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          treeInflight = null;
        });
      return treeInflight;
    },
    async localFiles() {
      if (!opts.localDir) return new Set();
      try {
        return new Set((await readdir(opts.localDir)).filter((f) => LOCAL_FILE.test(f)));
      } catch {
        return new Set();
      }
    },
  };
}

let shared: IconStore | undefined;

/** The process-wide store, built from the environment on first use. */
export function getIconStore(): IconStore {
  if (!shared) {
    const env = loadEnv();
    shared = createIconStore({
      cacheDir: env.cacheDir,
      base: env.iconsBase,
      localDir: path.join(env.configDir, 'icons'),
    });
  }
  return shared;
}
