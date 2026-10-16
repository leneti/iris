import { vi } from 'vitest';
import type {
  CronResponse,
  ServiceStatus,
  ServicesResponse,
  StatusResponse,
  StreamsResponse,
  SystemResponse,
  WidgetsResponse,
} from '@/lib/shared/contract';

/** What the mocked /api hooks return. Tests assign to these before mounting. */
export const data: {
  services: ServicesResponse | undefined;
  status: StatusResponse | undefined;
  cron: CronResponse | undefined;
  widgets: WidgetsResponse | undefined;
  system: SystemResponse | undefined;
  streams: StreamsResponse | undefined;
} = {
  services: undefined,
  status: undefined,
  cron: undefined,
  widgets: undefined,
  system: undefined,
  streams: undefined,
};

export const mutate = vi.fn();

/** The module replacement for `@/lib/client/api`. */
export const apiMock = {
  useServices: () => ({ data: data.services, mutate }),
  useStatus: () => ({ data: data.status }),
  useCron: () => ({ data: data.cron }),
  useWidgets: () => ({ data: data.widgets }),
  useSystem: () => ({ data: data.system }),
  useStreams: () => ({ data: data.streams }),
};

export function statusResponse(byId: Record<string, ServiceStatus>): StatusResponse {
  const summary = { healthy: 0, starting: 0, degraded: 0, unhealthy: 0, stopped: 0, unknown: 0 };
  const services: StatusResponse['services'] = {};
  for (const [id, status] of Object.entries(byId)) {
    summary[status] += 1;
    services[id] = { status, docker: null, http: null, changedAt: null };
  }
  return { generatedAt: '2026-10-16T10:26:00.000Z', docker: 'ok', services, summary };
}

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** jsdom has no layout: the observers and scrolling that cmdk and Radix use are stubbed. */
export function stubBrowser(): void {
  globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
}

/** Below 640 px: only the phone query matches. */
export function usePhoneViewport(): void {
  window.matchMedia = ((query: string) => ({
    matches: query === '(max-width: 639px)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}
