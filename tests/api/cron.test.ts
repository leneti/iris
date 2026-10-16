import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CronResponse } from '@/lib/shared/contract';
import { fetchCronStatus, type CronStatusJob } from '@/lib/server/cron/cron-status';

vi.mock('@/lib/server/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  registerSecret: vi.fn(),
}));
vi.mock('@/lib/server/cron/cron-status', () => ({ fetchCronStatus: vi.fn() }));

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/cron/${name}.json`, import.meta.url), 'utf8');

const jobs: CronStatusJob[] = JSON.parse(fixture('cron-status')).map((j: any) => ({
  name: j.name,
  status: j.status,
  lastRun: new Date(j.lastRun),
  message: j.message ?? null,
  url: j.url ?? null,
}));

const dir = mkdtempSync(join(tmpdir(), 'iris-api-cron-'));
const hostFile = join(dir, 'status.json');

type Route = typeof import('@/app/api/cron/route');

/** A fresh route module (and so a fresh cache and config watcher) for each test. */
async function load(env: Record<string, string | undefined> = {}): Promise<Route> {
  vi.resetModules();
  globalThis.__irisConfig = undefined;
  vi.stubEnv('DASHBOARD_CONFIG_DIR', dir);
  vi.stubEnv('DASHBOARD_CRON_STATUS_URL', 'http://cron-status.example.invalid:9876/cron-status');
  vi.stubEnv('DASHBOARD_HOST_STATUS_FILE', hostFile);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  const mod = await import('@/lib/server/cron/cron-status');
  vi.mocked(mod.fetchCronStatus).mockResolvedValue(jobs);
  return import('@/app/api/cron/route');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
  writeFileSync(hostFile, fixture('host-status'));
});

afterEach(() => {
  rmSync(join(dir, 'dashboard.yaml'), { force: true });
  globalThis.__irisConfig = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.mocked(fetchCronStatus).mockReset();
});

describe('GET /api/cron', () => {
  test('exports: nodejs, dynamic, GET only, no request input', async () => {
    const route = await load();
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.GET.length).toBe(0);
    expect(Object.keys(route).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });

  test('serves a response that parses with the contract schema, uncached', async () => {
    const { GET } = await load();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = CronResponse.parse(await res.json());
    expect(body.sources.map((s) => [s.id, s.state])).toEqual([
      ['cron-status', 'ok'],
      ['host-status', 'ok'],
    ]);
    expect(body.jobs).toHaveLength(7);
    expect(body.summary).toEqual({ ok: 4, warning: 1, overdue: 1, failed: 1, unknown: 0 });
  });

  test('cron-status is fetched once per minute however often the route is called', async () => {
    const { GET } = await load();
    await Promise.all([GET(), GET(), GET()]);
    await GET();
    const { fetchCronStatus: fetch } = await import('@/lib/server/cron/cron-status');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('http://cron-status.example.invalid:9876/cron-status');
    vi.advanceTimersByTime(60_000);
    await GET();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('cron-status down: source unreachable, maintenance rows still there (5.5)', async () => {
    const { GET } = await load();
    const { fetchCronStatus: fetch } = await import('@/lib/server/cron/cron-status');
    vi.mocked(fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));
    const body = CronResponse.parse(await (await GET()).json());
    expect(body.sources[0]).toEqual({ id: 'cron-status', state: 'unreachable', fetchedAt: null });
    expect(body.jobs.map((j) => j.kind)).toEqual(['maintenance', 'maintenance']);
  });

  test('cron-status goes down after a good fetch: the last list stays, with its age', async () => {
    const { GET } = await load();
    const { fetchCronStatus: fetch } = await import('@/lib/server/cron/cron-status');
    await GET();
    vi.mocked(fetch).mockRejectedValue(new Error('down'));
    vi.advanceTimersByTime(60_000);
    const body = CronResponse.parse(await (await GET()).json());
    expect(body.sources[0]).toEqual({
      id: 'cron-status',
      state: 'unreachable',
      fetchedAt: '2026-10-16T12:00:00.000Z',
    });
    expect(body.jobs.filter((j) => j.kind === 'user')).toHaveLength(5);
  });

  test('no cron-status address: not-configured and nothing is fetched', async () => {
    const { GET } = await load({ DASHBOARD_CRON_STATUS_URL: '' });
    const { fetchCronStatus: fetch } = await import('@/lib/server/cron/cron-status');
    const body = CronResponse.parse(await (await GET()).json());
    expect(body.sources[0]).toEqual({
      id: 'cron-status',
      state: 'not-configured',
      fetchedAt: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a stale host status file: stale source, schedules fall back, maintenance not monitored (5.8)', async () => {
    const { GET } = await load();
    vi.setSystemTime(new Date('2026-10-16T12:30:00.000Z'));
    const body = CronResponse.parse(await (await GET()).json());
    expect(body.sources[1]).toEqual({ id: 'host-status', state: 'stale', fetchedAt: null });
    expect(body.jobs.find((j) => j.id === 'feed-sync')?.schedule.configured).toBe(false);
    expect(body.jobs.find((j) => j.id === 'backup')?.summary).toBe('Not monitored');
  });

  test('dashboard.yaml overrides are read through the config watcher and reloaded on change', async () => {
    const { GET } = await load();
    const read = async () => CronResponse.parse(await (await GET()).json());
    expect((await read()).jobs.find((j) => j.id === 'feed-sync')?.schedule.source).toBe(
      'host-status',
    );
    const yaml = join(dir, 'dashboard.yaml');
    writeFileSync(
      yaml,
      'cron:\n  jobs:\n    - match: feed-sync\n      schedule: "0 * * * *"\n      label: Hourly\n',
    );
    const { utimesSync } = await import('node:fs');
    utimesSync(yaml, 5000, 5000);
    const job = (await read()).jobs.find((j) => j.id === 'feed-sync');
    expect(job?.schedule).toMatchObject({ source: 'config', label: 'Hourly' });
  });

  test('the response carries no address, path or token', async () => {
    const { GET } = await load();
    const text = await (await GET()).text();
    expect(text).not.toContain('cron-status.example.invalid');
    expect(text).not.toContain(dir);
  });
});
