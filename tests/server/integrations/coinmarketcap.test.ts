import { WidgetsResponse } from '@/lib/shared/contract';
import { defaultDashboardConfig, type DashboardConfig } from '@/lib/server/config/dashboard';
import { loadEnv } from '@/lib/server/env';
import { httpRequest } from '@/lib/server/http';
import { adapter } from '@/lib/server/integrations/coinmarketcap';
import { fixture } from '../../helpers/adapter';
import { serve } from '../../helpers/external';
import { stateWith } from '../../helpers/widgets';

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

const KEY = 'cmc-key-5d8e0a13c7';
const env = loadEnv({ DASHBOARD_COINMARKETCAP_KEY: KEY });
const T0 = new Date('2026-10-16T12:00:00.000Z').getTime();
const ROUTE = '/v1/cryptocurrency/quotes/latest?symbol=AAA,BBB,CCC&convert=GBP';

function config(over: Record<string, unknown> = {}): DashboardConfig {
  const base = defaultDashboardConfig();
  return {
    ...base,
    widgets: {
      ...base.widgets,
      standalone: [
        {
          id: 'markets',
          name: 'Markets',
          group: 'Home',
          icon: 'lucide:chart-line',
          type: 'coinmarketcap',
          currency: 'GBP',
          coins: [
            { symbol: 'AAA', name: 'Alphacoin' },
            { symbol: 'BBB', name: 'Betacoin' },
            { symbol: 'CCC', name: 'Gammacoin' },
          ],
          interval: '7d',
          ...over,
        },
      ],
    },
  };
}

type Registry = typeof import('@/lib/server/integrations/registry');
let reg: Registry;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  logs.length = 0;
  vi.mocked(httpRequest).mockReset();
  vi.resetModules();
  reg = await import('@/lib/server/integrations/registry');
});
afterEach(() => vi.useRealTimers());

const widgets = (cfg = config(), e = env, at = T0) => reg.getWidgets(stateWith([]), cfg, e, at);

describe('coinmarketcap adapter', () => {
  test('fixed https origin; key is a header credential', () => {
    expect(adapter.baseUrl).toBe('https://pro-api.coinmarketcap.com');
    expect(adapter.pathCreds).toBeUndefined();
    expect(adapter.credentials(loadEnv({}))).toBeNull();
    expect(adapter.credentials(env)).toEqual({ key: KEY });
  });
});

describe('Markets tile', () => {
  test('one call with the symbols, currency and key header; configured order, names, units', async () => {
    const calls = serve({ [ROUTE]: fixture('coinmarketcap/quotes.json') });
    const res = WidgetsResponse.parse(await widgets());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://pro-api.coinmarketcap.com${ROUTE}`);
    expect(calls[0]!.headers['x-cmc_pro_api_key']).toBe(KEY);
    expect(calls[0]!.url).not.toContain(KEY);
    expect(res.standalone).toHaveLength(1);
    const w = res.standalone[0]!;
    expect(w).toMatchObject({
      id: 'markets',
      name: 'Markets',
      group: 'Home',
      icon: { kind: 'lucide', name: 'chart-line' },
      type: 'coinmarketcap',
      state: 'ok',
      interval: '7d',
      fetchedAt: new Date(T0).toISOString(),
    });
    // The fixture lists CCC before BBB and gives them upstream names: neither may leak.
    expect(w.stats.map((s) => [s.key, s.label, s.unit])).toEqual([
      ['AAA', 'Alphacoin', 'GBP'],
      ['BBB', 'Betacoin', 'GBP'],
      ['CCC', 'Gammacoin', 'GBP'],
    ]);
    expect(w.stats[0]).toMatchObject({
      value: 61240.5,
      changePercent: { '1h': 0.1, '24h': 1.2, '7d': -3.4, '30d': 8 },
    });
    expect(JSON.stringify(res)).not.toContain('Upstream');
  });

  test('a missing interval is null for that coin only', async () => {
    serve({ [ROUTE]: fixture('coinmarketcap/quotes.json') });
    const w = (await widgets()).standalone[0]!;
    expect(w.stats[1]!.changePercent).toEqual({ '1h': 0.3, '24h': 2.5, '7d': 1.1, '30d': null });
    expect(w.stats[2]!.changePercent).toEqual({ '1h': -0.2, '24h': null, '7d': 4.5, '30d': 12.1 });
  });

  test('three concurrent readers make one upstream call, then none for 1800 s (criterion 11.6)', async () => {
    const calls = serve({ [ROUTE]: fixture('coinmarketcap/quotes.json') });
    await Promise.all([widgets(), widgets(), widgets()]);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1799_000);
    await widgets(config(), env, T0 + 1799_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await widgets(config(), env, T0 + 1801_000);
    expect(calls).toHaveLength(2);
  });

  test('no call with no browser: nothing is fetched by merely waiting', async () => {
    const calls = serve({ [ROUTE]: fixture('coinmarketcap/quotes.json') });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toEqual([]);
  });

  test('no key: not-configured, no call', async () => {
    const calls = serve({});
    const w = (await widgets(config(), loadEnv({}))).standalone[0]!;
    expect(w).toMatchObject({ state: 'not-configured', fetchedAt: null, stats: [] });
    expect(calls).toEqual([]);
  });

  test.each([
    ['unauthorized', { status: 401 }],
    ['rate-limited', { status: 429 }],
    ['unreachable', { status: 500, body: 'upstream text' }],
    ['unreachable', 'not json'],
  ])('failure gives %s with no stats', async (state, reply) => {
    serve({ [ROUTE]: reply });
    const w = (await widgets()).standalone[0]!;
    expect(w).toMatchObject({ state, stats: [] });
    expect(JSON.stringify(w)).not.toContain('upstream text');
  });

  test('invalid symbols and currency never reach a request', async () => {
    const calls = serve({});
    const bad = config({
      coins: [
        { symbol: 'aaa', name: 'Lower' },
        { symbol: 'A&B', name: 'Amp' },
        { symbol: 'TOOLONGSYMBOL', name: 'Long' },
        { symbol: '', name: 'Empty' },
      ],
    });
    expect((await widgets(bad)).standalone[0]).toMatchObject({
      state: 'not-configured',
      stats: [],
    });
    const cur = config({ currency: 'GB P&x=1' });
    expect((await widgets(cur)).standalone[0]).toMatchObject({
      state: 'not-configured',
      stats: [],
    });
    expect(calls).toEqual([]);
  });

  test('valid symbols are kept when others are dropped', async () => {
    const calls = serve({
      '/v1/cryptocurrency/quotes/latest?symbol=AAA&convert=GBP': fixture(
        'coinmarketcap/quotes.json',
      ),
    });
    const w = (
      await widgets(
        config({
          coins: [
            { symbol: 'AAA', name: 'Alphacoin' },
            { symbol: 'no way', name: 'Bad' },
          ],
        }),
      )
    ).standalone[0]!;
    expect(calls).toHaveLength(1);
    expect(w.stats.map((s) => s.key)).toEqual(['AAA']);
  });

  test('config warnings are logged once, not on every poll', async () => {
    const calls = serve({
      '/v1/cryptocurrency/quotes/latest?symbol=AAA&convert=GBP': fixture(
        'coinmarketcap/quotes.json',
      ),
    });
    const dropped = config({
      coins: [
        { symbol: 'AAA', name: 'Alphacoin' },
        { symbol: 'no way', name: 'Bad' },
      ],
    });
    for (let i = 0; i < 3; i++) await widgets(dropped, env, T0 + i * 10_000);
    expect(logs.filter((l) => l.includes('symbol'))).toHaveLength(1);
    expect(calls.length).toBeGreaterThan(0);
    const badCurrency = config({ currency: 'GB P&x=1' });
    for (let i = 0; i < 3; i++) await widgets(badCurrency, env, T0 + i * 10_000);
    expect(logs.filter((l) => l.includes('currency'))).toHaveLength(1);
  });

  test('a coin missing from the reply is left out; the others keep their order', async () => {
    serve({
      [ROUTE]: JSON.stringify({
        data: { CCC: { quote: { GBP: { price: 1 } } }, AAA: { quote: { GBP: { price: 2 } } } },
      }),
    });
    const w = (await widgets()).standalone[0]!;
    expect(w.stats.map((s) => s.key)).toEqual(['AAA', 'CCC']);
    expect(w.stats[0]!.changePercent).toEqual({ '1h': null, '24h': null, '7d': null, '30d': null });
  });
});
