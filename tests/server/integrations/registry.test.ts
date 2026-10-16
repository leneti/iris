import { WidgetsResponse, type StandaloneWidget } from '@/lib/shared/contract';
import { defaultDashboardConfig, type DashboardConfig } from '@/lib/server/config/dashboard';
import { loadEnv } from '@/lib/server/env';
import type { Adapter, AdapterContext, AdapterValues } from '@/lib/server/integrations/fetcher';
import { buildStatusResponse } from '@/lib/server/state';
import { dashboard, stateWith } from '../../helpers/widgets';

// Raw log calls, before any scrubbing: a leak must not be hidden by the redactor.
const logs = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/server/log', () => {
  const record = (message: string, fields?: unknown) =>
    logs.push(message + (fields === undefined ? '' : JSON.stringify(fields)));
  return { log: { info: record, warn: record, error: record }, registerSecret: vi.fn() };
});

vi.mock('@/lib/server/http', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/server/http')>();
  return { ...actual, httpRequest: vi.fn() };
});

const T0 = new Date('2026-10-16T12:00:00.000Z').getTime();
type Registry = typeof import('@/lib/server/integrations/registry');
let reg: Registry;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  logs.length = 0;
  vi.resetModules();
  reg = await import('@/lib/server/integrations/registry');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Loads = { count: number };
function fake(over: Partial<Adapter> = {}, values: AdapterValues = { wanted: 3, movies: 10 }) {
  const loads: Loads = { count: 0 };
  const adapter: Adapter = {
    type: 'radarr',
    defaultFields: ['wanted', 'movies'],
    extraFields: ['missing'],
    labels: { wanted: 'Wanted', movies: 'Movies', missing: 'Missing' },
    credentials: (e) => (e.radarrKey === undefined ? null : { key: e.radarrKey }),
    fetch: async () => {
      loads.count += 1;
      return values;
    },
    ...over,
  };
  return { adapter, loads };
}
const withKey = loadEnv({
  DASHBOARD_RADARR_KEY: 'radarr-key-77d1',
  DASHBOARD_TRAEFIK_URL: 'http://t.example.invalid',
});

describe('getWidgets', () => {
  test('no browser request: zero loads over 10 minutes of fake time (criterion 11.6)', async () => {
    const { adapter, loads } = fake();
    reg.registerAdapter(adapter);
    stateWith([{ id: 'radarr', type: 'radarr' }]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(loads.count).toBe(0);
  });

  test('two concurrent requests share one load', async () => {
    const { adapter, loads } = fake();
    reg.registerAdapter(adapter);
    const state = stateWith([{ id: 'radarr', type: 'radarr' }]);
    const [a, b] = await Promise.all([
      reg.getWidgets(state, dashboard, withKey, T0),
      reg.getWidgets(state, dashboard, withKey, T0),
    ]);
    expect(loads.count).toBe(1);
    expect(a.services.radarr).toEqual(b.services.radarr);
  });

  test('the refresh time comes from widgets.refreshSeconds, per type then default', async () => {
    const radarr = fake();
    const seerr = fake({
      type: 'seerr',
      credentials: (e) => (e.seerrKey ? { key: e.seerrKey } : null),
    });
    reg.registerAdapter(radarr.adapter);
    reg.registerAdapter(seerr.adapter);
    const state = stateWith([
      { id: 'radarr', type: 'radarr' },
      { id: 'seerr', type: 'seerr' },
    ]);
    const e = loadEnv({ DASHBOARD_RADARR_KEY: 'r1', DASHBOARD_SEERR_KEY: 's1' });
    const ask = () => reg.getWidgets(state, dashboard, e, Date.now());
    await ask();
    await vi.advanceTimersByTimeAsync(59_000); // default 60 s, radarr 300 s
    await ask();
    expect([radarr.loads.count, seerr.loads.count]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(2_000);
    await ask();
    expect([radarr.loads.count, seerr.loads.count]).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(240_000);
    await ask();
    expect([radarr.loads.count, seerr.loads.count]).toEqual([2, 3]);
  });

  test('response is contract-valid, with fixed fields and ISO times', async () => {
    const { adapter } = fake();
    reg.registerAdapter(adapter);
    const res = await reg.getWidgets(
      stateWith([{ id: 'radarr', type: 'radarr' }]),
      dashboard,
      withKey,
      T0,
    );
    const body = WidgetsResponse.parse(res);
    expect(body.generatedAt).toBe(new Date(T0).toISOString());
    expect(body.services.radarr).toEqual({
      type: 'radarr',
      state: 'ok',
      fetchedAt: new Date(T0).toISOString(),
      stats: [
        { key: 'wanted', label: 'Wanted', value: 3, unit: null },
        { key: 'movies', label: 'Movies', value: 10, unit: null },
      ],
    });
    expect(body.standalone).toEqual([]);
    expect(body.weather).toBeNull();
  });

  test('services without a widget are not listed', async () => {
    const res = await reg.getWidgets(stateWith([]), dashboard, withKey, T0);
    expect(res.services).toEqual({});
  });

  test('not configured: no figures, no load (criterion 11.5)', async () => {
    const { adapter, loads } = fake();
    reg.registerAdapter(adapter);
    const res = await reg.getWidgets(
      stateWith([{ id: 'radarr', type: 'radarr' }]),
      dashboard,
      loadEnv({}),
      T0,
    );
    expect(res.services.radarr).toEqual({
      type: 'radarr',
      state: 'not-configured',
      fetchedAt: null,
      stats: [],
    });
    expect(loads.count).toBe(0);
  });

  test('a type with no registered adapter reads as not-configured', async () => {
    const res = await reg.getWidgets(
      stateWith([{ id: 'gotify', type: 'gotify' }]),
      dashboard,
      withKey,
      T0,
    );
    expect(res.services.gotify!.state).toBe('not-configured');
  });

  describe('failures (criterion 11.5)', () => {
    test.each([
      ['unauthorized', 'unauthorized'],
      ['rate-limited', 'rate-limited'],
      ['unreachable', 'unreachable'],
    ] as const)(
      'IntegrationError %s gives state %s, no stats, health untouched',
      async (code, state) => {
        const { IntegrationError } = await import('@/lib/server/integrations/fetcher');
        const { adapter } = fake({
          fetch: async () => {
            throw new IntegrationError(code);
          },
        });
        reg.registerAdapter(adapter);
        const app = stateWith([{ id: 'radarr', type: 'radarr' }]);
        const before = JSON.stringify(buildStatusResponse(app, T0));
        const res = await reg.getWidgets(app, dashboard, withKey, T0);
        expect(res.services.radarr).toEqual({ type: 'radarr', state, fetchedAt: null, stats: [] });
        expect(JSON.stringify(buildStatusResponse(app, T0))).toBe(before);
      },
    );

    test('a malformed reply (parse error) is unreachable', async () => {
      const { adapter } = fake({ fetch: async () => JSON.parse('<html>') as AdapterValues });
      reg.registerAdapter(adapter);
      const res = await reg.getWidgets(
        stateWith([{ id: 'radarr', type: 'radarr' }]),
        dashboard,
        withKey,
        T0,
      );
      expect(res.services.radarr).toMatchObject({ state: 'unreachable', stats: [] });
    });

    test('a failure after a good read keeps the time of the good read and shows no stats', async () => {
      let fail = false;
      const { adapter } = fake({
        fetch: async () => {
          if (fail) throw new Error('boom');
          return { wanted: 1, movies: 2 };
        },
      });
      reg.registerAdapter(adapter);
      const app = stateWith([{ id: 'radarr', type: 'radarr' }]);
      await reg.getWidgets(app, dashboard, withKey, T0);
      fail = true;
      await vi.advanceTimersByTimeAsync(301_000);
      const res = await reg.getWidgets(app, dashboard, withKey, Date.now());
      expect(res.services.radarr).toEqual({
        type: 'radarr',
        state: 'unreachable',
        fetchedAt: new Date(T0).toISOString(),
        stats: [],
      });
    });

    test('a failed read is retried within 30 s, not after the full refresh time', async () => {
      let calls = 0;
      const { adapter } = fake({
        fetch: async () => {
          calls += 1;
          if (calls === 1) throw new Error('boom');
          return { wanted: 1, movies: 2 };
        },
      });
      reg.registerAdapter(adapter);
      const app = stateWith([{ id: 'radarr', type: 'radarr' }]);
      expect((await reg.getWidgets(app, dashboard, withKey, T0)).services.radarr!.state).toBe(
        'unreachable',
      );
      await vi.advanceTimersByTimeAsync(31_000);
      expect(
        (await reg.getWidgets(app, dashboard, withKey, Date.now())).services.radarr!.state,
      ).toBe('ok');
    });

    test('one failing adapter does not affect another', async () => {
      const bad = fake({ fetch: async () => Promise.reject(new Error('x')) });
      const good = fake({ type: 'seerr', credentials: () => ({ key: 'k' }) });
      reg.registerAdapter(bad.adapter);
      reg.registerAdapter(good.adapter);
      const res = await reg.getWidgets(
        stateWith([
          { id: 'radarr', type: 'radarr' },
          { id: 'seerr', type: 'seerr' },
        ]),
        dashboard,
        withKey,
        T0,
      );
      expect([res.services.radarr!.state, res.services.seerr!.state]).toEqual([
        'unreachable',
        'ok',
      ]);
    });
  });

  describe('fields', () => {
    const run = async (fields: string | undefined) => {
      const { adapter } = fake({}, { wanted: 1, movies: 2, missing: 3 });
      reg.registerAdapter(adapter);
      return reg.getWidgets(
        stateWith([{ id: 'radarr', type: 'radarr', fields }]),
        dashboard,
        withKey,
        T0,
      );
    };

    test('narrow, reorder and add a free field', async () => {
      const res = await run('missing,wanted');
      expect(res.services.radarr!.stats.map((s) => s.key)).toEqual(['missing', 'wanted']);
    });

    test('unknown fields are dropped with a warning that does not echo them', async () => {
      const res = await run('wanted,Secret_Label_Text,movies');
      expect(res.services.radarr!.stats.map((s) => s.key)).toEqual(['wanted', 'movies']);
      const out = logs.join('');
      expect(out).toMatch(/1 unknown field/);
      expect(out).not.toContain('Secret_Label_Text');
      expect(JSON.stringify(res)).not.toContain('Secret_Label_Text');
    });

    test('the warning is logged once, not on every refresh', async () => {
      const { adapter } = fake({}, { wanted: 1, movies: 2 });
      reg.registerAdapter(adapter);
      const app = stateWith([{ id: 'radarr', type: 'radarr', fields: 'nope' }]);
      for (let i = 0; i < 3; i++) {
        await reg.getWidgets(app, dashboard, withKey, Date.now());
        await vi.advanceTimersByTimeAsync(400_000);
      }
      expect(logs.filter((l) => /unknown field/.test(l))).toHaveLength(1);
    });

    test('only unknown fields: the default fields are shown', async () => {
      const res = await run('nope,nada');
      expect(res.services.radarr!.stats.map((s) => s.key)).toEqual(['wanted', 'movies']);
    });
  });

  describe('standalone and weather hooks (Task 16)', () => {
    test('providers get a cache, the config and a context for a baseUrl adapter', async () => {
      const widget: StandaloneWidget = {
        id: 'markets',
        name: 'Markets',
        group: 'Home',
        icon: { kind: 'lucide', name: 'chart-line' },
        type: 'coinmarketcap',
        state: 'ok',
        fetchedAt: null,
        interval: '24h',
        stats: [],
      };
      let loads = 0;
      let seen: AdapterContext | undefined;
      const { adapter } = fake({
        type: 'coinmarketcap',
        baseUrl: 'https://pro-api.example.invalid',
      });
      reg.registerStandaloneProvider(async (deps) => {
        await deps.cache.get('coinmarketcap:markets', deps.refreshMs('coinmarketcap'), async () => {
          loads += 1;
          return 1;
        });
        seen = deps.context(adapter, {});
        return [widget];
      });
      reg.registerWeatherProvider(async (deps) => {
        expect(deps.refreshMs('radarr')).toBe(300_000);
        return {
          state: 'ok',
          fetchedAt: null,
          label: 'Hometown',
          temperature: 15.2,
          unit: 'celsius',
          condition: 'cloudy',
          isDay: true,
        };
      });
      const app = stateWith([]);
      const first = WidgetsResponse.parse(await reg.getWidgets(app, dashboard, withKey, T0));
      await reg.getWidgets(app, dashboard, withKey, T0);
      expect(first.standalone).toEqual([widget]);
      expect(first.weather?.label).toBe('Hometown');
      expect(loads).toBe(1);
      expect(seen?.widget).toBeNull();
    });

    test('a provider that throws leaves [] and null, and does not break the services', async () => {
      const { adapter } = fake();
      reg.registerAdapter(adapter);
      reg.registerStandaloneProvider(async () => {
        throw new Error('x');
      });
      reg.registerWeatherProvider(async () => {
        throw new Error('x');
      });
      const res = await reg.getWidgets(
        stateWith([{ id: 'radarr', type: 'radarr' }]),
        dashboard,
        withKey,
        T0,
      );
      expect(res.standalone).toEqual([]);
      expect(res.weather).toBeNull();
      expect(res.services.radarr!.state).toBe('ok');
    });
  });

  test('a changed widget.url is not served the old reply', async () => {
    let n = 0;
    const { adapter } = fake({
      fetch: async (ctx) => {
        n += 1;
        return { wanted: n, movies: ctx.widget?.url === 'http://b.example.invalid' ? 99 : 1 };
      },
    });
    reg.registerAdapter(adapter);
    await reg.getWidgets(
      stateWith([{ id: 'radarr', type: 'radarr', url: 'http://a.example.invalid' }]),
      dashboard,
      withKey,
      T0,
    );
    const res = await reg.getWidgets(
      stateWith([{ id: 'radarr', type: 'radarr', url: 'http://b.example.invalid' }]),
      dashboard,
      withKey,
      T0,
    );
    expect(res.services.radarr!.stats[1]!.value).toBe(99);
  });
});

describe('ctx.cached (ruling R26)', () => {
  const sonarr = (loads: { series: number }): Adapter => ({
    ...fake({ type: 'sonarr', credentials: () => ({ key: 'k' }) }).adapter,
    fetch: async (ctx) => {
      const series = await ctx.cached('series', 300_000, async () => {
        loads.series += 1;
        return 7;
      });
      return { wanted: 1, movies: series };
    },
  });

  test('a 300 s entry inside a 60 s adapter: one load across several refreshes', async () => {
    const loads = { series: 0 };
    reg.registerAdapter(sonarr(loads));
    const app = stateWith([{ id: 'sonarr', type: 'sonarr' }]);
    const ask = () => reg.getWidgets(app, dashboard, withKey, Date.now());
    const first = await ask();
    expect(first.services.sonarr!.state).toBe('ok');
    await vi.advanceTimersByTimeAsync(61_000);
    await ask();
    await vi.advanceTimersByTimeAsync(61_000);
    await ask();
    expect(loads.series).toBe(1);
    await vi.advanceTimersByTimeAsync(200_000);
    await ask();
    expect(loads.series).toBe(2);
  });

  test('two calls inside the TTL share one load, in flight too', async () => {
    const ctx = await captureContext();
    let n = 0;
    const load = async () => ++n;
    const [a, b] = await Promise.all([
      ctx.cached('k', 60_000, load),
      ctx.cached('k', 60_000, load),
    ]);
    expect([a, b, n]).toEqual([1, 1, 1]);
    expect(await ctx.cached('k', 60_000, load)).toBe(1);
    expect(await ctx.cached('other', 60_000, load)).toBe(2);
  });

  test('separate services have separate entries', async () => {
    const loads: number[] = [];
    const adapter: Adapter = {
      ...fake().adapter,
      fetch: async (ctx) => {
        const v = await ctx.cached('series', 300_000, async () => {
          loads.push(1);
          return 5;
        });
        return { wanted: v, movies: v };
      },
    };
    reg.registerAdapter(adapter);
    const app = stateWith([
      { id: 'radarr', type: 'radarr' },
      { id: 'radarr2', type: 'radarr' },
    ]);
    await reg.getWidgets(app, dashboard, withKey, T0);
    expect(loads).toHaveLength(2);
  });

  test('a load error is the adapter failure; it is retried after the error TTL', async () => {
    let fail = true;
    const adapter: Adapter = {
      ...fake().adapter,
      fetch: async (ctx) => {
        const v = await ctx.cached('series', 300_000, async () => {
          if (fail) throw new Error('boom');
          return 5;
        });
        return { wanted: v, movies: v };
      },
    };
    reg.registerAdapter(adapter);
    const app = stateWith([{ id: 'radarr', type: 'radarr' }]);
    expect((await reg.getWidgets(app, dashboard, withKey, T0)).services.radarr).toMatchObject({
      state: 'unreachable',
      stats: [],
    });
    fail = false;
    await vi.advanceTimersByTimeAsync(31_000);
    expect((await reg.getWidgets(app, dashboard, withKey, Date.now())).services.radarr!.state).toBe(
      'ok',
    );
  });

  async function captureContext(): Promise<AdapterContext> {
    let captured: AdapterContext | undefined;
    reg.registerAdapter({
      ...fake().adapter,
      fetch: async (ctx) => {
        captured = ctx;
        return { wanted: 1, movies: 1 };
      },
    });
    await reg.getWidgets(stateWith([{ id: 'radarr', type: 'radarr' }]), dashboard, withKey, T0);
    return captured!;
  }
});

describe('selectStats', () => {
  const { adapter } = fake({
    defaultFields: ['a', 'b', 'c', 'd', 'e'],
    extraFields: ['x'],
    labels: { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', x: 'X', rate: 'Rate' },
    units: { a: 'bytes-per-second' },
  });
  const values: AdapterValues = { a: 1, b: 2, c: 3, d: 4, e: 5, x: 6 };

  test('default fields in order, at most four, labels from the adapter table', () => {
    const stats = reg.selectStats(adapter, values, null);
    expect(stats.map((s) => [s.key, s.label])).toEqual([
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'C'],
      ['d', 'D'],
    ]);
    expect(stats[0]!.unit).toBe('bytes-per-second');
    expect(stats[1]!.unit).toBeNull();
  });

  test('a field list is capped at four and de-duplicated', () => {
    expect(
      reg.selectStats(adapter, values, ['x', 'x', 'e', 'd', 'c', 'b']).map((s) => s.key),
    ).toEqual(['x', 'e', 'd', 'c']);
    expect(reg.planFields(adapter, ['x', 'e', 'd', 'c', 'b'])).toMatchObject({
      cut: ['b'],
      unknown: 0,
    });
  });

  test('inherited object keys are not fields', () => {
    expect(reg.planFields(adapter, ['constructor', '__proto__', 'toString'])).toMatchObject({
      keys: ['a', 'b', 'c', 'd'],
      unknown: 3,
    });
  });

  test('a missing value is skipped; atLeast is kept; odd values are dropped', () => {
    const odd: AdapterValues = {
      a: { value: 100, atLeast: true },
      b: 'healthy',
      c: 'Free text from an upstream',
      d: Number.NaN,
      e: 'a'.repeat(40),
    };
    const stats = reg.selectStats(adapter, odd, ['a', 'b', 'c', 'd', 'e', 'x']);
    expect(stats).toEqual([
      { key: 'a', label: 'A', value: 100, unit: 'bytes-per-second', atLeast: true },
      { key: 'b', label: 'B', value: 'healthy', unit: null },
    ]);
  });
});

describe('registerAdapter', () => {
  test('baseUrl must be an https origin', () => {
    const base = fake().adapter;
    for (const baseUrl of ['http://api.example.invalid', 'https://api.example.invalid/v4', 'nope'])
      expect(() => reg.registerAdapter({ ...base, baseUrl })).toThrow();
    expect(() =>
      reg.registerAdapter({ ...base, baseUrl: 'https://api.example.invalid' }),
    ).not.toThrow();
  });
});

describe('credentials never leave the server (criterion 11.3)', () => {
  const TYPES = [
    'seerr',
    'tautulli',
    'radarr',
    'sonarr',
    'prowlarr',
    'autobrr',
    'gotify',
    'qbittorrent',
  ] as const;
  const secrets = Object.fromEntries(TYPES.map((t, i) => [t, `cred-${t}-9a8b7c6d5e4f30${i}1`]));
  const cloud = 'cred-cloudflare-example';
  const leakEnv = loadEnv({
    DASHBOARD_SEERR_KEY: secrets.seerr,
    DASHBOARD_TAUTULLI_KEY: secrets.tautulli,
    DASHBOARD_RADARR_KEY: secrets.radarr,
    DASHBOARD_SONARR_KEY: secrets.sonarr,
    DASHBOARD_PROWLARR_KEY: secrets.prowlarr,
    DASHBOARD_AUTOBRR_KEY: secrets.autobrr,
    DASHBOARD_GOTIFY_TOKEN: secrets.gotify,
    DASHBOARD_QBITTORRENT_USERNAME: 'cred-user-5544',
    DASHBOARD_QBITTORRENT_PASSWORD: secrets.qbittorrent,
    DASHBOARD_CLOUDFLARE_TOKEN: cloud,
    DASHBOARD_TRAEFIK_URL: 'http://t.example.invalid',
  });

  test('not in the output or any log line, for ok, thrown and malformed replies', async () => {
    const { httpRequest } = await import('@/lib/server/http');
    // Every upstream answers 500 and echoes what it was sent, as a hostile or buggy one might.
    vi.mocked(httpRequest).mockImplementation(async (o) => ({
      status: 500,
      headers: {},
      body: Buffer.from(JSON.stringify(o.headers)),
      url: o.url,
      redirects: 0,
    }));
    const keys: Record<string, string> = {
      seerr: leakEnv.seerrKey!,
      tautulli: leakEnv.tautulliKey!,
      radarr: leakEnv.radarrKey!,
      sonarr: leakEnv.sonarrKey!,
      prowlarr: leakEnv.prowlarrKey!,
      autobrr: leakEnv.autobrrKey!,
      gotify: leakEnv.gotifyToken!,
      qbittorrent: leakEnv.qbittorrentPassword!,
    };
    const modes = ['ok', 'http', 'throw-with-secret'] as const;
    TYPES.forEach((type, i) => {
      const mode = modes[i % modes.length]!;
      reg.registerAdapter({
        type,
        defaultFields: ['n'],
        extraFields: [],
        labels: { n: 'N' },
        credentials: () => ({ key: keys[type]! }),
        fetch: async (ctx) => {
          if (mode === 'ok') return { n: 1 };
          if (mode === 'throw-with-secret') throw new Error(`failed with ${ctx.creds.key!}`);
          await ctx.get('/x', { headers: { 'x-api-key': ctx.creds.key! } });
          return { n: 1 };
        },
      });
    });
    reg.registerAdapter({
      type: 'cloudflared',
      baseUrl: 'https://api.example.invalid',
      defaultFields: ['status'],
      extraFields: [],
      labels: { status: 'Tunnel status' },
      credentials: () => ({ token: leakEnv.cloudflareToken! }),
      fetch: async (ctx) => {
        await ctx.get('/t', { headers: { authorization: `Bearer ${ctx.creds.token}` } });
        return { status: 'healthy' };
      },
    });
    const app = stateWith([
      ...TYPES.map((t) => ({ id: t, type: t })),
      { id: 'cloudflared', type: 'cloudflared' },
    ]);
    const res = await reg.getWidgets(app, defaultDashboardConfig(), leakEnv, T0);
    expect(Object.values(res.services).map((s) => s.state)).toContain('unreachable');
    const everything = JSON.stringify(res) + logs.join('');
    for (const secret of [...Object.values(secrets), cloud, 'cred-user-5544'])
      expect(everything).not.toContain(secret);
    expect(logs.length).toBeGreaterThan(0);
  });
});

test('config type is the dashboard config', () => {
  const c: DashboardConfig = dashboard;
  expect(c.widgets.refreshSeconds.default).toBe(60);
});
