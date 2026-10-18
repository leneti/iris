import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { describe, expect, test, vi } from 'vitest';
import { useCron, useServices, useStatus, useSystem, useWidgets } from '@/lib/client/api';
import { ENDPOINTS } from '@/lib/shared/endpoints';
import { getSeed } from '@/lib/server/seed';

// The upstream-backed sources answer at once; the bodies only need to be present.
vi.mock('@/lib/server/cron/response', () => ({ getCronResponse: async () => ({ cron: true }) }));
vi.mock('@/lib/server/panels/glances', () => ({ getSystem: async () => ({ system: true }) }));
vi.mock('@/lib/server/integrations/registry', () => ({
  getWidgets: async () => ({ widgets: true }),
}));
vi.mock('@/lib/server/config/services', () => ({
  getConfigWatcher: () => ({ get: () => ({ iris: { config: {} } }) }),
}));
vi.mock('@/lib/server/env', () => ({ loadEnv: () => ({}) }));
vi.mock('@/lib/server/state', () => ({
  getState: () => ({}),
  buildServicesResponse: () => ({ services: true }),
  buildStatusResponse: () => ({ status: true }),
}));

describe('the seed and the polls use the same keys', () => {
  test('every seed key is an endpoint the browser polls', async () => {
    const seed = await getSeed(1);
    expect(Object.keys(seed.data).sort()).toEqual(
      [
        ENDPOINTS.services,
        ENDPOINTS.status,
        ENDPOINTS.cron,
        ENDPOINTS.system,
        ENDPOINTS.widgets,
      ].sort(),
    );
  });

  test('each hook finds its seeded body as the SWR fallback', async () => {
    const seed = await getSeed(1);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ fallback: seed.data, provider: () => new Map() }}>{children}</SWRConfig>
    );
    const hooks = {
      [ENDPOINTS.services]: useServices,
      [ENDPOINTS.status]: useStatus,
      [ENDPOINTS.cron]: useCron,
      [ENDPOINTS.system]: useSystem,
      [ENDPOINTS.widgets]: useWidgets,
    };
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    for (const [url, hook] of Object.entries(hooks)) {
      const { result, unmount } = renderHook(() => hook(), { wrapper });
      expect(result.current.data, url).toBe(seed.data[url]);
      unmount();
    }
    vi.unstubAllGlobals();
  });
});
