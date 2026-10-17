import { GET, dynamic, runtime } from '@/app/api/services/route';
import { ServicesResponse } from '@/lib/shared/contract';
import { startPollers } from '@/lib/server/poller';
import type { ContainerSummary } from '@/lib/server/docker/parse';
import { config, container, env, icons, probeOk } from '../helpers/iris';

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

function run(list: () => Promise<ContainerSummary[]>) {
  stop = startPollers({
    env,
    fetchContainers: list,
    probe: async () => probeOk(),
    config,
    icons,
  }).stop;
}

describe('GET /api/services', () => {
  test('exports', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
    expect(GET.length).toBe(0);
  });

  test('before the first poll it answers with an empty, valid response and a warning', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = ServicesResponse.parse(await res.json());
    expect(body.groups).toEqual([]);
    expect(body.warnings.map((w) => w.code)).toContain('STARTING');
  });

  test('serves the discovered services and parses with the contract schema', async () => {
    run(async () => [
      container('radarr', {
        labels: { ...container('radarr').labels, 'iris.group': 'Automation' },
      }),
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    const body = ServicesResponse.parse(JSON.parse(text));
    expect(body.sources).toEqual({ docker: 'ok', manual: 'missing' });
    expect(body.groups.map((g) => g.name)).toEqual(['Automation']);
    const radarr = body.groups[0]?.services[0];
    expect(radarr).toMatchObject({
      id: 'radarr',
      url: 'https://radarr.example.invalid/',
      urlSource: 'traefik-router',
      embed: { mode: 'auto', verdict: 'allowed', reason: null },
    });
    // Server-only fields never reach the browser.
    expect(text).not.toContain('"health"');
    expect(text).not.toContain('"widget"');
    expect(text).not.toContain('containerName');
  });

  test('a container that appears is listed within 15 s (criterion 1.1)', async () => {
    let list = [container('radarr')];
    run(async () => list);
    await vi.advanceTimersByTimeAsync(1000);
    list = [container('radarr'), container('probe', { labels: { 'iris.enable': 'true' } })];
    await vi.advanceTimersByTimeAsync(14_000);
    const body = ServicesResponse.parse(await (await GET()).json());
    const all = body.groups.flatMap((g) => g.services.map((s) => [g.name, s.id]));
    expect(all).toContainEqual(['Other', 'probe']);
  });

  test('is served from the same state the poller wrote (globalThis singleton)', async () => {
    run(async () => [container('radarr')]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(globalThis.__iris?.discovery).not.toBeNull();
  });
});
