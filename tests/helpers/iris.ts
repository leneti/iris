import type { ConfigWatcher } from '@/lib/server/config/services';
import { defaultIrisConfig } from '@/lib/server/config/iris';
import type { ContainerSummary } from '@/lib/server/docker/parse';
import { loadEnv } from '@/lib/server/env';
import type { ProbeResult } from '@/lib/server/health/probe';
import type { IconStore } from '@/lib/server/icons/store';

export const env = loadEnv({
  IRIS_TRAEFIK_URL: 'http://traefik.example.invalid',
  IRIS_ZONE: 'example.invalid',
});

/** A labelled, running container with a router rule, so it gets a Traefik health target. */
export function container(name: string, over: Partial<ContainerSummary> = {}): ContainerSummary {
  return {
    name,
    service: name,
    labels: {
      'iris.enable': 'true',
      [`traefik.http.routers.${name}.rule`]: `Host(\`${name}.example.invalid\`)`,
    },
    state: 'running',
    statusText: 'Up 3 days',
    health: 'none',
    failingStreak: 0,
    publicPorts: [],
    ...over,
  };
}

export function probeOk(frame: ProbeResult['frame'] = { xfo: null, csp: null }): ProbeResult {
  return {
    ok: true,
    code: 200,
    latencyMs: 12,
    reason: null,
    frame,
    checkedAt: new Date().toISOString(),
  };
}

export function probeFailed(): ProbeResult {
  return {
    ok: false,
    code: 500,
    latencyMs: null,
    reason: 'upstream-error',
    frame: null,
    checkedAt: new Date().toISOString(),
  };
}

export const config: ConfigWatcher = {
  get: () => ({
    iris: { config: defaultIrisConfig(), warnings: [] },
    manual: { services: [], warnings: [], state: 'missing' },
  }),
};

export const icons: IconStore = {
  get: async () => null,
  catalogue: async () => ({ has: () => null }),
  localFiles: async () => new Set<string>(),
};
