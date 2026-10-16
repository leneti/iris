import { GET, dynamic, runtime } from '@/app/api/status/route';
import { StatusResponse } from '@/lib/shared/contract';
import { startPollers } from '@/lib/server/poller';
import type { ContainerSummary } from '@/lib/server/docker/parse';
import { config, container, env, icons, probeFailed, probeOk } from '../helpers/iris';

vi.mock('@/lib/server/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  registerSecret: vi.fn(),
}));

let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
  globalThis.__iris = undefined;
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
  globalThis.__iris = undefined;
});

function run(list: () => Promise<ContainerSummary[]>, failing: string[] = []) {
  stop = startPollers({
    env,
    fetchContainers: list,
    probe: async (target) =>
      target.kind === 'traefik' && failing.includes(target.host.split('.')[0] ?? '')
        ? probeFailed()
        : probeOk(),
    config,
    icons,
  }).stop;
}

describe('GET /api/status', () => {
  test('exports', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
    expect(GET.length).toBe(0);
  });

  test('before the first poll nothing is listed and Docker is unreachable', async () => {
    const body = StatusResponse.parse(await (await GET()).json());
    expect(body.docker).toBe('unreachable');
    expect(body.services).toEqual({});
  });

  test('reports status, docker and http detail per service and a summary', async () => {
    run(
      async () => [
        container('radarr', { statusText: 'Up 3 days' }),
        container('sonarr', { state: 'exited', statusText: 'Exited (0) 1 hour ago' }),
        container('prowlarr'),
      ],
      ['prowlarr'],
    );
    await vi.advanceTimersByTimeAsync(1000);
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = StatusResponse.parse(await res.json());
    expect(body.docker).toBe('ok');
    expect(body.services.radarr).toMatchObject({
      status: 'healthy',
      docker: { state: 'running', health: 'none', failingStreak: 0, statusText: 'Up 3 days' },
      http: { ok: true, code: 200, reason: null },
    });
    expect(body.services.sonarr?.status).toBe('stopped');
    expect(body.services.prowlarr).toMatchObject({
      status: 'degraded',
      http: { ok: false, code: 500, reason: 'upstream-error' },
    });
    expect(body.summary).toEqual({
      healthy: 1,
      starting: 0,
      degraded: 1,
      unhealthy: 0,
      stopped: 1,
      unknown: 0,
    });
  });

  test('stopping a container changes its status within 15 s (criterion 3.1)', async () => {
    let list = [container('probe')];
    run(async () => list);
    await vi.advanceTimersByTimeAsync(1000);
    expect(StatusResponse.parse(await (await GET()).json()).services.probe?.status).toBe('healthy');
    list = [container('probe', { state: 'exited' })];
    await vi.advanceTimersByTimeAsync(14_000);
    expect(StatusResponse.parse(await (await GET()).json()).services.probe?.status).toBe('stopped');
  });

  test('30 s without a Docker answer makes every status unknown and keeps the list', async () => {
    let fail = false;
    run(async () => {
      if (fail) throw new Error('down');
      return [container('radarr'), container('sonarr')];
    });
    await vi.advanceTimersByTimeAsync(1000);
    fail = true;
    await vi.advanceTimersByTimeAsync(31_000);
    const body = StatusResponse.parse(await (await GET()).json());
    expect(body.docker).toBe('unreachable');
    expect(Object.keys(body.services).sort()).toEqual(['radarr', 'sonarr']);
    expect(Object.values(body.services).every((s) => s.status === 'unknown')).toBe(true);
    expect(body.summary.unknown).toBe(2);
  });

  test('changedAt is the same across responses while the status is unchanged', async () => {
    run(async () => [container('radarr')]);
    await vi.advanceTimersByTimeAsync(1000);
    const a = StatusResponse.parse(await (await GET()).json()).services.radarr?.changedAt;
    await vi.advanceTimersByTimeAsync(5000);
    const b = StatusResponse.parse(await (await GET()).json()).services.radarr?.changedAt;
    expect(a).toEqual(expect.any(String));
    expect(b).toBe(a);
  });
});
