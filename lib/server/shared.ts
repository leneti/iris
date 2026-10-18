import 'server-only';

declare global {
  // oxlint-disable-next-line no-var -- `var` is the only way to declare a global property.
  var __irisShared: Map<string, unknown> | undefined;
}

/**
 * Module-level state that every bundle must see as one. In production Next compiles a module
 * into each chunk that imports it (the page's server render and each route handler), so a plain
 * `const cache = createTtlCache()` becomes one cache per chunk. This keeps the value on
 * `globalThis` under `key` and builds it with `init` the first time any bundle asks.
 */
export function shared<T>(key: string, init: () => T): T {
  const store = (globalThis.__irisShared ??= new Map<string, unknown>());
  if (!store.has(key)) store.set(key, init());
  return store.get(key) as T;
}
