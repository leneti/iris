import 'server-only';
import { z } from 'zod';
import type { Weather } from '@/lib/shared/contract';
import { IntegrationError, type Adapter, type AdapterContext } from './fetcher';
import { parseReply } from './reply';
import type { WidgetDeps } from './registry';

// Weather (D1.12) from Open-Meteo, which needs no key. The coordinates leave this server rounded
// to two decimals (about 1 km) and never reach the browser or a log line; the answer's own
// latitude and longitude are not read.
const schema = z.object({
  current: z.object({
    temperature_2m: z.number().finite(),
    weather_code: z.number(),
    is_day: z.union([z.literal(0), z.literal(1)]),
  }),
});

type Condition = NonNullable<Weather['condition']>;
const WMO: [Condition, number[]][] = [
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
const CONDITIONS = new Map<number, Condition>(
  WMO.flatMap(([word, codes]) => codes.map((c) => [c, word])),
);

/** Iris's own word for a WMO weather code; null for a code the table does not know. */
export function conditionOf(code: number): Condition | null {
  return CONDITIONS.get(code) ?? null;
}

/** Two decimals; `+ 0` turns a rounded -0 into 0 so the request never says "-0.00". */
const round2 = (n: number): string => (Math.round(n * 100) / 100 + 0).toFixed(2);

export const adapter: Adapter = {
  type: 'openmeteo',
  defaultFields: [],
  extraFields: [],
  labels: {},
  baseUrl: 'https://api.open-meteo.com',
  credentials: () => ({}),
  // Not a per-service integration: the provider below calls `readWeather` with the config.
  fetch: () => Promise.reject(new IntegrationError('unreachable')),
};

export type WeatherSpec = {
  latitude: number;
  longitude: number;
  timezone: string;
  units: 'metric' | 'imperial';
};
export type Reading = Pick<Weather, 'temperature' | 'unit' | 'condition' | 'isDay'>;

/** The request builder: the only place coordinates become text. */
export function forecastPath(spec: WeatherSpec): string {
  const unit = spec.units === 'imperial' ? 'fahrenheit' : 'celsius';
  return (
    `/v1/forecast?latitude=${round2(spec.latitude)}&longitude=${round2(spec.longitude)}` +
    `&current=temperature_2m,weather_code,is_day&timezone=${encodeURIComponent(spec.timezone)}` +
    `&temperature_unit=${unit}`
  );
}

export async function readWeather(ctx: AdapterContext, spec: WeatherSpec): Promise<Reading> {
  const { current } = parseReply(await ctx.get(forecastPath(spec)), schema);
  return {
    temperature: current.temperature_2m,
    unit: spec.units === 'imperial' ? 'fahrenheit' : 'celsius',
    condition: conditionOf(current.weather_code),
    isDay: current.is_day === 1,
  };
}

export async function provider(deps: WidgetDeps): Promise<Weather | null> {
  const w = deps.config.weather;
  if (w === undefined) return null;
  // The key stays in memory; it is never logged or sent anywhere.
  const key = `weather:openmeteo|${round2(w.latitude)}|${round2(w.longitude)}|${w.timezone}|${w.units}`;
  const result = await deps.cache.get(key, w.refreshMinutes * 60_000, () =>
    readWeather(deps.context(adapter, {}), w),
  );
  if (result.error !== null || result.value === null || result.fetchedAt === null) return null;
  return {
    state: 'ok',
    fetchedAt: new Date(result.fetchedAt).toISOString(),
    label: w.label,
    ...result.value,
  };
}
