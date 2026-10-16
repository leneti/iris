// Per-device preferences in localStorage. Safari private mode and blocked storage throw on
// access, so every read and write is guarded and falls back to the default.
const PREFIX = 'iris.pref.';

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function sameKind(value: unknown, fallback: unknown): boolean {
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (fallback === null) return value === null;
  if (typeof fallback === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  return typeof value === typeof fallback;
}

const listeners = new Set<() => void>();

/** Notified after every `prefs.set` here and on `storage` events from other tabs. */
export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export const prefs = {
  /** The stored text for a key, or null. Stable between writes, so it suits useSyncExternalStore. */
  raw(key: string): string | null {
    try {
      return store()?.getItem(PREFIX + key) ?? null;
    } catch {
      return null;
    }
  },
  get<T>(key: string, fallback: T): T {
    try {
      const raw = store()?.getItem(PREFIX + key);
      if (raw == null) return fallback;
      const value: unknown = JSON.parse(raw);
      return sameKind(value, fallback) ? (value as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      store()?.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Storage unavailable or full: the preference simply is not remembered.
    }
    for (const listener of listeners) listener();
  },
};
