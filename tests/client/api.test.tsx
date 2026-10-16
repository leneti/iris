import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fetchValidated,
  POLL_MS,
  pollOptions,
  useCron,
  useServices,
  useStatus,
  useStreams,
  useSystem,
  useWidgets,
} from '@/lib/client/api';
import { StatusResponse } from '@/lib/shared/contract';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const goodStatus = {
  generatedAt: '2026-10-16T10:00:00Z',
  docker: 'ok',
  services: {},
  summary: { healthy: 0, starting: 0, degraded: 0, unhealthy: 0, stopped: 0, unknown: 0 },
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(node: ReactElement) {
  await act(async () => {
    root.render(
      createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, node),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function Probe(props: { use: () => { data?: unknown; error?: unknown } }) {
  const { data, error } = props.use();
  return createElement('span', { 'data-state': error ? 'error' : data ? 'data' : 'loading' });
}
const state = () => host.querySelector('span')?.getAttribute('data-state');

describe('polling configuration', () => {
  test('browser intervals match Global Constraints', () => {
    expect(POLL_MS).toEqual({
      status: 10_000,
      cron: 60_000,
      system: 10_000,
      streams: 15_000,
      widgets: 10_000,
      services: 30_000,
    });
  });
  test('polling pauses while the tab is hidden', () => {
    expect(pollOptions(10_000)).toMatchObject({
      refreshInterval: 10_000,
      refreshWhenHidden: false,
    });
  });
});

describe('fetchValidated', () => {
  test('returns parsed data for a valid body and requests the right URL', async () => {
    const f = vi.fn(async () => reply(goodStatus));
    vi.stubGlobal('fetch', f);
    await expect(fetchValidated(StatusResponse, '/api/status')).resolves.toEqual(goodStatus);
    expect(f).toHaveBeenCalledWith('/api/status', expect.objectContaining({ cache: 'no-store' }));
  });
  test('rejects a body that fails the contract schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ ...goodStatus, docker: 'maybe' })),
    );
    await expect(fetchValidated(StatusResponse, '/api/status')).rejects.toThrow();
  });
  test('drops unknown fields instead of rejecting them (R49)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply({ ...goodStatus, extra: 1, summary: { ...goodStatus.summary, x: 2 } }),
      ),
    );
    await expect(fetchValidated(StatusResponse, '/api/status')).resolves.toEqual(goodStatus);
  });
  test('rejects non-2xx and non-JSON replies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(goodStatus, 503)),
    );
    await expect(fetchValidated(StatusResponse, '/api/status')).rejects.toThrow(/503/);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 })),
    );
    await expect(fetchValidated(StatusResponse, '/api/status')).rejects.toThrow();
  });
});

describe('hooks', () => {
  test('useStatus yields data for a valid reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(goodStatus)),
    );
    await render(createElement(Probe, { use: useStatus }));
    expect(state()).toBe('data');
  });
  test('a reply with an added field is still data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ ...goodStatus, addedLater: true })),
    );
    await render(createElement(Probe, { use: useStatus }));
    expect(state()).toBe('data');
  });
  test('an invalid reply surfaces as an error, never as data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ nonsense: true })),
    );
    await render(createElement(Probe, { use: useStatus }));
    expect(state()).toBe('error');
  });
  test.each([
    ['useServices', useServices, '/api/services'],
    ['useStatus', useStatus, '/api/status'],
    ['useCron', useCron, '/api/cron'],
    ['useSystem', useSystem, '/api/system'],
    ['useStreams', useStreams, '/api/streams'],
    ['useWidgets', useWidgets, '/api/widgets'],
  ] as const)('%s fetches %s and validates it', async (_n, hook, url) => {
    const f = vi.fn(async () => reply({ nonsense: true }));
    vi.stubGlobal('fetch', f);
    await render(createElement(Probe, { use: hook }));
    expect(f).toHaveBeenCalledWith(url, expect.anything());
    expect(state()).toBe('error');
  });
});
