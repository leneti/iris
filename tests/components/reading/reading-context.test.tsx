import { render } from '@testing-library/react';
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

function readings(services?: ServicesResponse) {
  const seen: Reading[] = [];
  function Probe() {
    seen.push(useReading());
    return null;
  }
  render(
    <ReadingProvider services={services}>
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
});
