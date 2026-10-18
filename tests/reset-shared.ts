import { beforeEach } from 'vitest';

/**
 * Server modules keep their caches on `globalThis` (`lib/server/shared.ts`) so that separate
 * bundles see one. A test that re-imports a module (`vi.resetModules()`) to get a fresh cache
 * calls this too.
 */
export function resetShared(): void {
  (globalThis as { __irisShared?: unknown }).__irisShared = undefined;
}

// Each test starts from empty.
beforeEach(resetShared);
