import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';
import type {
  CronJob,
  CronResponse,
  StreamsResponse,
  SystemResponse,
  WidgetsResponse,
} from '@/lib/shared/contract';

const NOW = '2026-10-16T10:26:00.000Z';

export function system(over: Partial<SystemResponse> = {}): SystemResponse {
  return {
    generatedAt: NOW,
    source: { state: 'ok', fetchedAt: NOW },
    cpu: { percent: 23, name: 'Example X4', cores: 4, load: [1.8, 2.1, 2.4], level: 'ok' },
    memory: {
      percent: 85,
      usedBytes: 29e9,
      freeBytes: 5e9,
      totalBytes: 34e9,
      level: 'warn',
    },
    disks: [
      {
        label: 'Media disk',
        percent: 93,
        usedBytes: 18e12,
        freeBytes: 2e12,
        totalBytes: 20e12,
        level: 'bad',
      },
    ],
    network: { rxBitsPerSec: 42e6, txBitsPerSec: 3e6 },
    temperature: { label: 'CPU', celsius: 54, warnCelsius: 95, critCelsius: 105, level: 'ok' },
    uptimeSeconds: 1051200,
    ...over,
  };
}

export function streams(over: Partial<StreamsResponse> = {}): StreamsResponse {
  return {
    generatedAt: NOW,
    source: { state: 'ok', fetchedAt: NOW },
    streamCount: 0,
    transcodeCount: 0,
    totalBitsPerSec: 0,
    sessions: [],
    ...over,
  };
}

export function widgets(over: Partial<WidgetsResponse> = {}): WidgetsResponse {
  return { generatedAt: NOW, services: {}, standalone: [], weather: null, ...over };
}

export function job(over: Partial<CronJob> & Pick<CronJob, 'id' | 'name'>): CronJob {
  return {
    kind: 'user',
    schedule: {
      expr: '*/15 * * * *',
      label: 'Every 15 minutes',
      configured: true,
      source: 'config',
    },
    lastRun: '2026-10-16T10:15:00.000Z',
    result: 'success',
    summary: 'Nothing to do.',
    link: null,
    previousDue: '2026-10-16T10:15:00.000Z',
    nextDue: '2026-10-16T10:30:00.000Z',
    flag: 'ok',
    ...over,
  };
}

export function cron(jobs: CronJob[], sources: CronResponse['sources'] = []): CronResponse {
  const summary = { ok: 0, warning: 0, overdue: 0, failed: 0, unknown: 0 };
  for (const j of jobs) summary[j.flag] += 1;
  return { generatedAt: NOW, timezone: 'Europe/London', sources, jobs, summary };
}

type Bodies = Record<string, unknown>;

/** Replaces `fetch` with a router on the URL path; returns the spy so tests can count calls. */
export function mockApi(bodies: Bodies) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (!(path in bodies)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(bodies[path]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Fresh SWR cache per render, so tests never share fetched data. */
export function renderFresh(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}
