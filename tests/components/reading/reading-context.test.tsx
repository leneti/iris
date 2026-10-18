import { render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ReadingProvider, useReading } from '@/components/reading/reading-context';
import type { Reading } from '@/lib/client/reading';
import { markOk } from '@/lib/client/source-health';
import type { ServicesResponse } from '@/lib/shared/contract';
import { group, servicesResponse, svc } from '../shell/fixtures';
import { statusResponse } from '../phone/mock-api';

type Hook = { data: unknown; error?: Error };
const hooks: Record<string, Hook> = {};
vi.mock('@/lib/client/api', () => ({
  POLL_MS: {
    status: 10_000,
    cron: 60_000,
    system: 10_000,
    streams: 15_000,
    widgets: 10_000,
    services: 30_000,
  },
  useServices: () => hooks.services,
  useStatus: () => hooks.status,
  useCron: () => hooks.cron,
  useSystem: () => hooks.system,
  useWidgets: () => hooks.widgets,
}));

function readings(services?: ServicesResponse, props: { serverNow?: number } = {}) {
  const seen: Reading[] = [];
  function Probe() {
    seen.push(useReading());
    return null;
  }
  render(
    <ReadingProvider services={services} {...props}>
      <Probe />
      <Probe />
    </ReadingProvider>,
  );
  return seen;
}

beforeEach(() => {
  for (const key of ['services', 'status', 'cron', 'system', 'widgets']) {
    hooks[key] = { data: undefined };
  }
});

describe('ReadingProvider', () => {
  test('derives once and shares it', () => {
    const [a, b] = readings();
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });

  test('useReading throws outside a provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Probe() {
      useReading();
      return null;
    }
    expect(() => render(<Probe />)).toThrow('useReading needs a ReadingProvider');
    error.mockRestore();
  });

  test('marks a source unavailable when it has no data and an error', () => {
    const services = servicesResponse([group('Media', [svc('a', 'Alpha')])]);
    hooks.status = { data: undefined, error: new Error('x') };
    const [r] = readings(services);
    expect(r!.circle).toEqual({ unavailable: true });
  });

  test('keeps the last data after one failed poll', () => {
    const services = servicesResponse([group('Media', [svc('a', 'Alpha')])]);
    markOk('/api/status');
    hooks.status = { data: statusResponse({ a: 'healthy' }), error: new Error('x') };
    const [r] = readings(services);
    expect('unavailable' in r!.circle).toBe(false);
  });

  test('gives up on data that has not been ok for three polls', () => {
    const services = servicesResponse([group('Media', [svc('a', 'Alpha')])]);
    markOk('/api/status', Date.now() - 60_000);
    hooks.status = { data: statusResponse({ a: 'healthy' }), error: new Error('x') };
    const [r] = readings(services);
    expect(r!.circle).toEqual({ unavailable: true });
  });

  test("uses the shell's services prop", () => {
    hooks.services = { data: undefined };
    const services = servicesResponse([group('Media', [svc('a', 'Alpha')])]);
    hooks.status = { data: statusResponse({ a: 'healthy' }) };
    const [r] = readings(services);
    expect(JSON.stringify(r!.circle)).toContain('Alpha');
  });

  test('the server render reads at the server clock, in the server zone', () => {
    const services = servicesResponse([group('Media', [svc('a', 'Alpha')])]);
    hooks.status = { data: statusResponse({ a: 'healthy' }) };
    // 13:00 UTC is 02:00 in Auckland and 13:00 in London.
    const serverNow = Date.UTC(2026, 9, 17, 13, 0);
    function Sentence() {
      return <>{useReading().segments[0]!.text.trim()}</>;
    }
    const html = (zone: string) =>
      renderToString(
        <ReadingProvider services={services} serverNow={serverNow} serverTimeZone={zone}>
          <Sentence />
        </ReadingProvider>,
      );
    expect(['Deep space silence.', 'Quiet hours.', 'Even the cron jobs are asleep.']).toContain(
      html('Pacific/Auckland'),
    );
    expect(['Good afternoon.', 'Afternoon!', 'Mid-day quadrant reached.']).toContain(
      html('Europe/London'),
    );
  });

  test('seeded data is not pending on the first render', () => {
    const services = servicesResponse([group('Media', [svc('a', 'Alpha')])]);
    hooks.status = { data: statusResponse({ a: 'healthy' }) };
    const [r] = readings(services, { serverNow: Date.now() });
    expect(r!.pending).toBe(false);
    expect(JSON.stringify(r!.circle)).toContain('Alpha');
  });
});
