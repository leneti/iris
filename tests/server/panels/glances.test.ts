import { readFileSync } from 'node:fs';
import { SystemResponse } from '@/lib/shared/contract';
import { httpRequest } from '@/lib/server/http';

vi.mock('@/lib/server/http', () => ({ httpRequest: vi.fn() }));
vi.mock('@/lib/server/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  registerSecret: vi.fn(),
}));

const BASE = 'http://glances.example.invalid:61208';
const fx = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../fixtures/glances/${name}.json`, import.meta.url), 'utf8'));

const system = {
  url: BASE,
  interface: 'auto',
  sensor: 'auto',
  disks: [
    { mount: '/example/apps', label: 'Apps disk' },
    { mount: '/example/media', label: 'Media disk' },
  ],
  thresholds: { warn: 80, bad: 90 },
};
type Cfg = typeof system;

let cfg: Cfg | undefined;
vi.mock('@/lib/server/config/services', () => ({
  getConfigWatcher: () => ({ get: () => ({ dashboard: { config: { system: cfg } } }) }),
}));

type Overrides = Record<string, unknown | Error>;
/** Answers each /api/4/<name> call from the fixture, or from an override (an Error rejects). */
function serve(over: Overrides = {}) {
  vi.mocked(httpRequest).mockImplementation(async (o) => {
    const name = o.url.split('/api/4/')[1]!;
    const v = name in over ? over[name] : fx(name);
    if (v instanceof Error) throw v;
    return {
      status: 200,
      headers: {},
      body: Buffer.from(JSON.stringify(v)),
      url: o.url,
      redirects: 0,
    };
  });
}

async function load() {
  vi.resetModules();
  return import('@/lib/server/panels/glances');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
  vi.mocked(httpRequest).mockReset();
  cfg = structuredClone(system);
});
afterEach(() => vi.useRealTimers());

describe('levelFor', () => {
  test('79 is ok, 80 warn, 90 bad (criterion 10.5)', async () => {
    const { levelFor } = await load();
    const t = { warn: 80, bad: 90 };
    expect([79, 79.9, 80, 89, 90, 100].map((p) => levelFor(p, t))).toEqual([
      'ok',
      'ok',
      'warn',
      'warn',
      'bad',
      'bad',
    ]);
    expect(levelFor(null, t)).toBe('ok');
  });
  test('honours configured thresholds', async () => {
    const { levelFor } = await load();
    expect(levelFor(60, { warn: 50, bad: 70 })).toBe('warn');
  });
});

describe('tempLevel', () => {
  test('warn at the warning level, bad at the critical level (criterion 10.7)', async () => {
    const { tempLevel } = await load();
    expect([94, 95, 104, 105].map((c) => tempLevel(c, 95, 105))).toEqual([
      'ok',
      'warn',
      'warn',
      'bad',
    ]);
  });
  test('ok when the sensor gives no levels or no value', async () => {
    const { tempLevel } = await load();
    expect(tempLevel(120, null, null)).toBe('ok');
    expect(tempLevel(null, 95, 105)).toBe('ok');
    expect(tempLevel(100, 95, null)).toBe('warn');
  });
});

describe('getSystem', () => {
  test('maps the placeholder figures (§12.1) and parses with the contract', async () => {
    serve();
    const { getSystem } = await load();
    const body = SystemResponse.parse(await getSystem(new Date()));
    expect(body.source).toEqual({ state: 'ok', fetchedAt: '2026-10-16T12:00:00.000Z' });
    expect(body.cpu).toEqual({
      percent: 23,
      name: 'Example X4',
      cores: 4,
      load: [1.8, 2.1, 2.4],
      level: 'ok',
    });
    expect(body.memory).toEqual({
      percent: 61,
      usedBytes: 20937965568,
      freeBytes: 13421772800,
      totalBytes: 34359738368,
      level: 'ok',
    });
    expect(body.disks).toEqual([
      {
        label: 'Apps disk',
        percent: 48,
        usedBytes: 479318350000,
        freeBytes: 519261546320,
        totalBytes: 998579896320,
        level: 'ok',
      },
      {
        label: 'Media disk',
        percent: 86,
        usedBytes: 17152800000000,
        freeBytes: 2858100000000,
        totalBytes: 20010900000000,
        level: 'warn',
      },
    ]);
    expect(body.network).toEqual({ rxBitsPerSec: 42100000, txBitsPerSec: 3200000 });
    expect(body.temperature).toEqual({
      label: 'CPU',
      celsius: 54,
      warnCelsius: 95,
      critCelsius: 105,
      level: 'ok',
    });
    expect(body.uptimeSeconds).toBe(1051200);
  });

  test('only configured disks, no mount, device, interface or sensor name in the output (10.6)', async () => {
    serve();
    const { getSystem } = await load();
    const text = JSON.stringify(await getSystem(new Date()));
    for (const leak of [
      '/example',
      'example-apps',
      'example-media',
      'example-root',
      'eth-example0',
      'docker0',
      'Package id',
      'Composite',
      'Core 0',
      '"/"',
    ])
      expect(text).not.toContain(leak);
    expect(text).not.toContain('Root');
  });

  test('makes one GET per Glances endpoint and shares the 10 s cache', async () => {
    serve();
    const { getSystem } = await load();
    await Promise.all([getSystem(new Date()), getSystem(new Date())]);
    await getSystem(new Date());
    const urls = vi
      .mocked(httpRequest)
      .mock.calls.map((c) => c[0].url)
      .sort();
    expect(urls).toEqual(
      ['quicklook', 'mem', 'fs', 'network', 'sensors', 'uptime', 'load']
        .sort()
        .map((n) => `${BASE}/api/4/${n}`),
    );
    for (const c of vi.mocked(httpRequest).mock.calls) {
      expect(c[0].method ?? 'GET').toBe('GET');
      expect(c[0].timeoutMs).toBeGreaterThan(0);
    }
    vi.advanceTimersByTime(10_000);
    await getSystem(new Date());
    expect(vi.mocked(httpRequest)).toHaveBeenCalledTimes(14);
  });

  test('a disk at 90 % is bad, with configured thresholds', async () => {
    serve({ fs: [{ mnt_point: '/example/apps', size: 100, used: 90, free: 10, percent: 90 }] });
    const { getSystem } = await load();
    const body = await getSystem(new Date());
    expect(body.disks[0]).toMatchObject({ label: 'Apps disk', percent: 90, level: 'bad' });
    // The second disk is configured but Glances did not list it: figures are null.
    expect(body.disks[1]).toEqual({
      label: 'Media disk',
      percent: null,
      usedBytes: null,
      freeBytes: null,
      totalBytes: null,
      level: 'ok',
    });
  });

  test('sensor auto picks the hottest CPU sensor, not a drive or a fan', async () => {
    serve({
      sensors: [
        { label: 'Core 0', value: 60, warning: 90, critical: 100, unit: 'C' },
        { label: 'Package id 0', value: 71, warning: 90, critical: 100, unit: 'C' },
        { label: 'Composite', value: 80, warning: 70, critical: 85, unit: 'C' },
        { label: 'fan1', value: 3000, unit: 'RPM' },
      ],
    });
    const { getSystem } = await load();
    expect((await getSystem(new Date())).temperature).toEqual({
      label: 'CPU',
      celsius: 71,
      warnCelsius: 90,
      critCelsius: 100,
      level: 'ok',
    });
  });

  test('a named sensor is used, and its own levels decide the level; the label stays CPU', async () => {
    cfg!.sensor = 'Core 0';
    serve({
      sensors: [
        { label: 'Core 0', value: 96, warning: 95, critical: 105, unit: 'C' },
        { label: 'Package id 0', value: 99, warning: 95, critical: 105, unit: 'C' },
      ],
    });
    const { getSystem } = await load();
    expect((await getSystem(new Date())).temperature).toEqual({
      label: 'CPU',
      celsius: 96,
      warnCelsius: 95,
      critCelsius: 105,
      level: 'warn',
    });
  });

  test('no matching sensor gives a null temperature', async () => {
    cfg!.sensor = 'Missing sensor';
    serve();
    const { getSystem } = await load();
    expect((await getSystem(new Date())).temperature).toBeNull();
  });

  test('a named interface is used; an unknown one gives null rates', async () => {
    cfg!.interface = 'docker0';
    serve();
    let { getSystem } = await load();
    expect((await getSystem(new Date())).network).toEqual({
      rxBitsPerSec: 480000000,
      txBitsPerSec: 480000000,
    });
    cfg!.interface = 'nope0';
    ({ getSystem } = await load());
    expect((await getSystem(new Date())).network).toEqual({
      rxBitsPerSec: null,
      txBitsPerSec: null,
    });
  });

  test('network rates fall back to byte counts over the elapsed time', async () => {
    serve({
      network: [
        { interface_name: 'eth9', bytes_recv: 3000, bytes_sent: 600, time_since_update: 3 },
      ],
    });
    const { getSystem } = await load();
    expect((await getSystem(new Date())).network).toEqual({
      rxBitsPerSec: 8000,
      txBitsPerSec: 1600,
    });
  });

  test('a missing figure is null, and a failed side endpoint does not fail the panel', async () => {
    serve({
      quicklook: { cpu: 'oops' },
      mem: {},
      network: new Error('404'),
      sensors: new Error('404'),
      load: new Error('404'),
      uptime: 'garbage',
    });
    const { getSystem } = await load();
    const body = SystemResponse.parse(await getSystem(new Date()));
    expect(body.source.state).toBe('ok');
    expect(body.cpu).toEqual({ percent: null, name: null, cores: null, load: null, level: 'ok' });
    expect(body.memory).toEqual({
      percent: null,
      usedBytes: null,
      freeBytes: null,
      totalBytes: null,
      level: 'ok',
    });
    expect(body.network).toEqual({ rxBitsPerSec: null, txBitsPerSec: null });
    expect(body.temperature).toBeNull();
    expect(body.uptimeSeconds).toBeNull();
  });

  test('cpu.name is cut to 40 characters', async () => {
    serve({ quicklook: { cpu: 5, cpu_name: 'X'.repeat(80) } });
    const { getSystem } = await load();
    expect((await getSystem(new Date())).cpu.name).toBe('X'.repeat(40));
  });

  test('uptime parses days and plain clock forms', async () => {
    serve({ uptime: '3:25:07' });
    const { getSystem } = await load();
    expect((await getSystem(new Date())).uptimeSeconds).toBe(3 * 3600 + 25 * 60 + 7);
  });

  test('no system block, or an empty url: not-configured, nothing fetched', async () => {
    serve();
    cfg = undefined;
    const { getSystem } = await load();
    const body = SystemResponse.parse(await getSystem(new Date()));
    expect(body.source).toEqual({ state: 'not-configured', fetchedAt: null });
    expect(body.disks).toEqual([]);
    expect(body.temperature).toBeNull();
    cfg = { ...structuredClone(system), url: '' };
    expect((await getSystem(new Date())).source.state).toBe('not-configured');
    expect(httpRequest).not.toHaveBeenCalled();
  });

  test('Glances down: unreachable, nothing else known, no leak of the error', async () => {
    serve(
      Object.fromEntries(
        ['quicklook', 'mem', 'fs', 'network', 'sensors', 'uptime', 'load'].map((n) => [
          n,
          new Error('connect ECONNREFUSED 192.0.2.99'),
        ]),
      ),
    );
    const { getSystem } = await load();
    const body = SystemResponse.parse(await getSystem(new Date()));
    expect(body.source).toEqual({ state: 'unreachable', fetchedAt: null });
    expect(body.cpu.percent).toBeNull();
    expect(JSON.stringify(body)).not.toContain('192.0.2.99');
  });

  test('last values are kept for 60 s after Glances goes down, then dropped (D1.11)', async () => {
    serve();
    const { getSystem } = await load();
    await getSystem(new Date());
    const down = Object.fromEntries(
      ['quicklook', 'mem', 'fs', 'network', 'sensors', 'uptime', 'load'].map((n) => [
        n,
        new Error('down'),
      ]),
    );
    serve(down);
    vi.advanceTimersByTime(30_000);
    let body = await getSystem(new Date());
    expect(body.source).toEqual({ state: 'unreachable', fetchedAt: '2026-10-16T12:00:00.000Z' });
    expect(body.cpu.percent).toBe(23);
    expect(body.disks).toHaveLength(2);
    vi.advanceTimersByTime(30_000); // exactly 60 s old: still kept
    body = await getSystem(new Date());
    expect(body.source.state).toBe('unreachable');
    expect(body.cpu.percent).toBe(23);
    vi.advanceTimersByTime(1_000);
    body = await getSystem(new Date());
    expect(body.source.state).toBe('unreachable');
    expect(body.cpu.percent).toBeNull();
    expect(body.memory.percent).toBeNull();
    expect(body.temperature).toBeNull();
    expect(body.disks.map((d) => d.percent)).toEqual([null, null]);
  });

  test('a recovered Glances is ok again', async () => {
    serve(
      Object.fromEntries(
        ['quicklook', 'mem', 'fs', 'network', 'sensors', 'uptime', 'load'].map((n) => [
          n,
          new Error('down'),
        ]),
      ),
    );
    const { getSystem } = await load();
    await getSystem(new Date());
    serve();
    vi.advanceTimersByTime(30_000);
    expect((await getSystem(new Date())).source.state).toBe('ok');
  });
});
