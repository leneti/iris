import { WidgetsResponse } from '@/lib/shared/contract';
import { defaultIrisConfig, type IrisConfig } from '@/lib/server/config/iris';
import { loadEnv } from '@/lib/server/env';
import { httpRequest } from '@/lib/server/http';
import { adapter, conditionOf } from '@/lib/server/integrations/openmeteo';
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

// Open ocean within 1° of 0,0: nobody's location, and below the privacy scan's geo threshold.
const LAT = 0.736291;
const LON = -0.582614;
const env = loadEnv({});
const T0 = new Date('2026-10-16T12:00:00.000Z').getTime();
const ROUTE = (tz = 'Europe%2FLondon', unit = 'celsius') =>
  `/v1/forecast?latitude=0.74&longitude=-0.58&current=temperature_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=${tz}&temperature_unit=${unit}&wind_speed_unit=${unit === 'celsius' ? 'ms' : 'mph'}`;

function config(weather: Record<string, unknown> | null = {}): IrisConfig {
  const base = defaultIrisConfig();
  return {
    ...base,
    weather:
      weather === null
        ? undefined
        : {
            label: 'Hometown',
            latitude: LAT,
            longitude: LON,
            timezone: 'Europe/London',
            units: 'metric',
            refreshMinutes: 10,
            ...weather,
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

const get = (cfg = config()) => reg.getWidgets(stateWith([]), cfg, env, T0);

describe('openmeteo', () => {
  test('fixed https origin and no credential', () => {
    expect(adapter.baseUrl).toBe('https://api.open-meteo.com');
    expect(adapter.credentials(env)).toEqual({});
  });

  test('the request carries the coordinates to two decimals, the timezone and the unit', async () => {
    const calls = serve({ [ROUTE()]: fixture('openmeteo/forecast.json') });
    await get();
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(url.pathname).toBe('/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('0.74');
    expect(url.searchParams.get('longitude')).toBe('-0.58');
    expect(url.searchParams.get('current')).toBe(
      'temperature_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    );
    expect(url.searchParams.get('timezone')).toBe('Europe/London');
    expect(url.searchParams.get('temperature_unit')).toBe('celsius');
    expect(url.searchParams.get('wind_speed_unit')).toBe('ms');
    expect(calls[0]!.url).not.toContain('0.736291');
    expect(calls[0]!.url).not.toContain('0.582614');
  });

  test('imperial units; a negative value that rounds to zero is "0.00"', async () => {
    const calls = serve({});
    await get(config({ units: 'imperial', latitude: -0.001, longitude: 0.004, timezone: 'auto' }));
    expect(calls[0]!.url).toContain('latitude=0.00&longitude=0.00');
    expect(calls[0]!.url).toContain(
      'timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph',
    );
  });

  test('the response holds label, temperature, condition, day flag and wind, and no coordinates (11.9)', async () => {
    serve({ [ROUTE()]: fixture('openmeteo/forecast.json') });
    const res = WidgetsResponse.parse(await get());
    expect(res.weather).toEqual({
      state: 'ok',
      fetchedAt: new Date(T0).toISOString(),
      label: 'Hometown',
      temperature: 15.2,
      unit: 'celsius',
      condition: 'cloudy',
      isDay: true,
      windSpeed: 3.4,
      windGusts: 6.1,
      windDirection: 225,
      windUnit: 'm/s',
    });
    const body = JSON.stringify(res);
    for (const n of ['0.736291', '-0.582614', '0.74', '-0.58', '0.736', '0.583'])
      expect(body).not.toContain(n);
    expect(logs.join('\n')).not.toMatch(/0\.7[34]|0\.58/);
  });

  test('fahrenheit and night', async () => {
    serve({
      [ROUTE('Europe%2FLondon', 'fahrenheit')]: JSON.stringify({
        current: {
          temperature_2m: 59.4,
          weather_code: 61,
          is_day: 0,
          wind_speed_10m: 12.3,
          wind_direction_10m: 90,
          wind_gusts_10m: 20.1,
        },
      }),
    });
    expect((await get(config({ units: 'imperial' }))).weather).toMatchObject({
      temperature: 59.4,
      unit: 'fahrenheit',
      condition: 'rain',
      isDay: false,
      windSpeed: 12.3,
      windGusts: 20.1,
      windDirection: 90,
      windUnit: 'mph',
    });
  });

  test('a reply without wind still gives the weather, with the wind null', async () => {
    serve({
      [ROUTE()]: JSON.stringify({ current: { temperature_2m: 15.2, weather_code: 3, is_day: 1 } }),
    });
    expect((await get()).weather).toMatchObject({
      temperature: 15.2,
      windSpeed: null,
      windGusts: null,
      windDirection: null,
      windUnit: 'm/s',
    });
  });

  test('weather is null when not configured, and nothing is requested', async () => {
    const calls = serve({});
    expect((await get(config(null))).weather).toBeNull();
    expect(calls).toEqual([]);
  });

  test.each([
    { status: 500 },
    { status: 429 },
    { status: 401 },
    'not json',
    '{"current":{}}',
    '[]',
  ])('a failure (%j) hides the weather', async (reply) => {
    serve({ [ROUTE()]: reply });
    expect((await get()).weather).toBeNull();
  });

  test('the reply is cached for refreshMinutes: ten readers, one call', async () => {
    const calls = serve({ [ROUTE()]: fixture('openmeteo/forecast.json') });
    await Promise.all(Array.from({ length: 10 }, () => get()));
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1000);
    await get();
    expect(calls).toHaveLength(2);
  });
});

describe('WMO weather codes', () => {
  const groups: [string, number[]][] = [
    ['clear', [0]],
    ['partly-cloudy', [1, 2]],
    ['cloudy', [3]],
    ['fog', [45, 48]],
    ['drizzle', [51, 53, 55, 56, 57]],
    ['rain', [61, 63, 65, 66, 67]],
    ['snow', [71, 73, 75, 77, 85, 86]],
    ['showers', [80, 81, 82]],
    ['thunderstorm', [95, 96, 99]],
  ];
  test.each(groups)('%s', (word, codes) => {
    for (const c of codes) expect(conditionOf(c)).toBe(word);
  });

  test('codes 0 to 99 not in the table, and non-codes, give null', () => {
    const known = new Set(groups.flatMap(([, c]) => c));
    for (let c = 0; c <= 99; c++) if (!known.has(c)) expect(conditionOf(c)).toBeNull();
    for (const c of [-1, 100, 1.5, Number.NaN]) expect(conditionOf(c)).toBeNull();
  });
});
