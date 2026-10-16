import 'server-only';

// A small TTL cache for upstream calls (handoff D1.5, D1.11, D1.12). It loads only when someone
// asks, so with no browser open nothing calls an upstream (criterion 11.6). Concurrent callers
// for one key share one load. A failed load keeps the last good value and its time, and the
// failed attempt itself is not repeated for `errorTtlMs` (default: the TTL, at most 30 s), so a
// dead upstream costs one timeout per that time and not one per request, and a recovered one
// is noticed within 30 s even when the success TTL is long.

export type CacheResult<T> = {
  value: T | null;
  /** Epoch ms of the last successful load, or null if there has been none. */
  fetchedAt: number | null;
  /** The error of the latest attempt, or null when it succeeded. */
  error: unknown | null;
};

type Entry = {
  value: unknown;
  fetchedAt: number | null;
  error: unknown | null;
  /** Epoch ms of the latest attempt, successful or not. */
  attemptedAt: number;
  /** How long this entry is served before the next `get` loads again. */
  freshForMs: number;
};

export type CacheOptions = {
  /** How long a failed attempt is kept before the next `get` retries. Default: `min(ttlMs, 30_000)`. */
  errorTtlMs?: number;
};

/** A failure is retried after at most this long, whatever the success TTL (ruling R22). */
export const DEFAULT_ERROR_TTL_MS = 30_000;

export type TtlCache = {
  get<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
    opts?: CacheOptions,
  ): Promise<CacheResult<T>>;
};

export function createTtlCache(): TtlCache {
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<CacheResult<unknown>>>();

  const result = <T>(entry: Entry): CacheResult<T> => ({
    value: entry.fetchedAt === null ? null : (entry.value as T),
    fetchedAt: entry.fetchedAt,
    error: entry.error,
  });

  async function refresh<T>(
    key: string,
    ttlMs: number,
    errorTtlMs: number,
    load: () => Promise<T>,
  ): Promise<CacheResult<T>> {
    const previous = entries.get(key);
    let entry: Entry;
    try {
      const value = await load();
      const at = Date.now();
      entry = { value, fetchedAt: at, error: null, attemptedAt: at, freshForMs: ttlMs };
    } catch (error) {
      entry = {
        value: previous?.value ?? null,
        fetchedAt: previous?.fetchedAt ?? null,
        error,
        attemptedAt: Date.now(),
        freshForMs: errorTtlMs,
      };
    }
    entries.set(key, entry);
    return result<T>(entry);
  }

  return {
    get<T>(
      key: string,
      ttlMs: number,
      load: () => Promise<T>,
      opts?: CacheOptions,
    ): Promise<CacheResult<T>> {
      const entry = entries.get(key);
      if (entry !== undefined && Date.now() - entry.attemptedAt < entry.freshForMs)
        return Promise.resolve(result<T>(entry));
      const running = inFlight.get(key);
      if (running !== undefined) return running as Promise<CacheResult<T>>;
      const started = refresh(
        key,
        ttlMs,
        opts?.errorTtlMs ?? Math.min(ttlMs, DEFAULT_ERROR_TTL_MS),
        load,
      ).finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    },
  };
}
