import 'server-only';
import type {
  ServiceWidget,
  StandaloneWidget,
  Stat,
  Weather,
  WidgetState,
  WidgetsResponse,
} from '@/lib/shared/contract';
import { createTtlCache, type TtlCache } from '../cache';
import type { IrisConfig } from '../config/iris';
import type { ResolvedService } from '../discovery/discover';
import type { ServerEnv } from '../env';
import { log } from '../log';
import type { AppState } from '../state';
import {
  IntegrationError,
  createContext,
  type Adapter,
  type AdapterContext,
  type AdapterValues,
  type StatValue,
} from './fetcher';
import { adapter as seerr } from './seerr';
import { adapter as radarr } from './radarr';
import { adapter as sonarr } from './sonarr';
import { adapter as prowlarr } from './prowlarr';
import { adapter as autobrr } from './autobrr';
import { adapter as gotify } from './gotify';
import { adapter as qbittorrent } from './qbittorrent';
import { adapter as tautulliTile } from './tautulli-tile';
import { adapter as cloudflared } from './cloudflared';
import { provider as marketsProvider } from './coinmarketcap';
import { provider as weatherProviderImpl } from './openmeteo';

export type { Adapter, AdapterContext, AdapterValues, StatValue } from './fetcher';
export { IntegrationError } from './fetcher';

// Adapter registry and the `/api/widgets` builder (handoff D1.12, §8.6). Nothing here runs
// unless a browser asks: `getWidgets` is called by the route, and every upstream read goes
// through the TTL cache, so with no browser open nothing is fetched (criterion 11.6).

const MAX_FIELDS = 4;
// Fixed words (the tunnel status, for one) are short lower-case words. Anything else that an
// adapter lets through as text is dropped: no upstream text reaches the browser (§8.6).
const FIXED_WORD = /^[a-z][a-z-]{0,19}$/;

const adapters = new Map<string, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  if (adapter.baseUrl !== undefined) {
    const url = new URL(adapter.baseUrl);
    if (url.protocol !== 'https:' || url.href !== `${url.origin}/`)
      throw new TypeError(`adapter ${adapter.type}: baseUrl must be an https origin`);
  }
  adapters.set(adapter.type, adapter);
}

export function getAdapter(type: string): Adapter | undefined {
  return adapters.get(type);
}

// ---- fields ----

export type FieldPlan = {
  keys: string[];
  /** Fields from the label that the adapter does not know (never named: they are label text). */
  unknown: number;
  /** Known fields left out because a tile shows at most four. */
  cut: string[];
};

/** Default fields in order, or the label's known fields in its order; at most four. */
export function planFields(adapter: Adapter, fields: string[] | null): FieldPlan {
  const defaults = adapter.defaultFields.slice(0, MAX_FIELDS);
  if (fields === null) return { keys: defaults, unknown: 0, cut: [] };
  const known = new Set([...adapter.defaultFields, ...adapter.extraFields]);
  const wanted: string[] = [];
  let unknown = 0;
  for (const f of fields) {
    if (!known.has(f)) unknown += 1;
    else if (!wanted.includes(f)) wanted.push(f);
  }
  if (wanted.length === 0) return { keys: defaults, unknown, cut: [] };
  return { keys: wanted.slice(0, MAX_FIELDS), unknown, cut: wanted.slice(MAX_FIELDS) };
}

function toStat(adapter: Adapter, values: AdapterValues, key: string): Stat | null {
  if (!Object.hasOwn(adapter.labels, key) || !Object.hasOwn(values, key)) return null;
  const raw: StatValue | undefined = values[key];
  let value: number | string;
  let atLeast = false;
  if (typeof raw === 'number') value = raw;
  else if (typeof raw === 'string') value = raw;
  else if (raw !== undefined && typeof raw === 'object' && raw.atLeast === true) {
    value = raw.value;
    atLeast = true;
  } else return null;
  if (typeof value === 'number' ? !Number.isFinite(value) : !FIXED_WORD.test(value)) return null;
  const unit =
    adapter.units !== undefined && Object.hasOwn(adapter.units, key)
      ? adapter.units[key]
      : undefined;
  return {
    key,
    label: adapter.labels[key] as string,
    value,
    unit: unit ?? null,
    ...(atLeast ? { atLeast: true as const } : {}),
  };
}

/** The stats a tile shows: labels from the adapter's own table, never from an upstream. */
export function selectStats(
  adapter: Adapter,
  values: AdapterValues,
  fields: string[] | null,
): Stat[] {
  return planFields(adapter, fields)
    .keys.map((k) => toStat(adapter, values, k))
    .filter((s): s is Stat => s !== null);
}

// ---- standalone and weather providers (Task 16) ----

export type WidgetDeps = {
  config: IrisConfig;
  env: ServerEnv;
  now: number;
  /** The shared TTL cache: a provider uses its own keys, e.g. `coinmarketcap:<id>`. */
  cache: TtlCache;
  /** A context for an adapter that has no per-service integration (it must set `baseUrl`). */
  context(adapter: Adapter, creds: Record<string, string>): AdapterContext;
  /** Refresh time in ms for an integration type, from `widgets.refreshSeconds`. */
  refreshMs(type: string): number;
  /** Logs a warning the first time `key` is seen (a config problem repeats on every poll). */
  warnOnce(key: string, message: string, fields?: Record<string, unknown>): void;
};

export type StandaloneProvider = (deps: WidgetDeps) => Promise<StandaloneWidget[]>;
export type WeatherProvider = (deps: WidgetDeps) => Promise<Weather | null>;

let standaloneProvider: StandaloneProvider | null = null;
let weatherProvider: WeatherProvider | null = null;

export function registerStandaloneProvider(provider: StandaloneProvider): void {
  standaloneProvider = provider;
}
export function registerWeatherProvider(provider: WeatherProvider): void {
  weatherProvider = provider;
}

/** The widget state for a failed read. Anything that is not an `IntegrationError` is unreachable. */
export function stateOf(error: unknown): Exclude<WidgetState, 'ok' | 'not-configured'> {
  return error instanceof IntegrationError ? error.code : 'unreachable';
}

// ---- getWidgets ----

const cache = createTtlCache();
const lastState = new Map<string, WidgetState>();
const warned = new Set<string>();

function refreshMsOf(config: IrisConfig, type: string): number {
  const table = config.widgets.refreshSeconds as Record<string, number>;
  const seconds = Object.hasOwn(table, type) ? table[type] : undefined;
  return (seconds ?? config.widgets.refreshSeconds.default) * 1000;
}

function warnOnce(key: string, message: string, fields?: Record<string, unknown>): void {
  if (warned.has(key)) return;
  warned.add(key);
  log.warn(message, fields);
}

function noteState(id: string, type: string, state: WidgetState): void {
  const before = lastState.get(id);
  if (before === state) return;
  lastState.set(id, state);
  if (state === 'ok') {
    if (before !== undefined && before !== 'not-configured')
      log.info('integration recovered', { type });
  } else if (state !== 'not-configured') {
    log.warn(`integration ${state}`, { type });
  }
}

/** A sub-entry of the TTL cache for an adapter (`AdapterContext.cached`). A failure rejects. */
function cachedUnder(prefix: string) {
  return async <T>(subKey: string, ttlMs: number, load: () => Promise<T>): Promise<T> => {
    const r = await cache.get(`${prefix}:${subKey}`, ttlMs, load);
    if (r.error !== null || r.value === null) throw r.error ?? new Error('no value');
    return r.value;
  };
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

async function serviceWidget(
  service: ResolvedService,
  config: IrisConfig,
  env: ServerEnv,
): Promise<ServiceWidget> {
  const spec = service.widget;
  if (spec === null) throw new TypeError('service has no widget');
  const notConfigured: ServiceWidget = {
    type: spec.type,
    state: 'not-configured',
    fetchedAt: null,
    stats: [],
  };
  const adapter = adapters.get(spec.type);
  if (adapter === undefined) {
    warnOnce(`adapter:${spec.type}`, 'no integration is available for a widget type', {
      type: spec.type,
    });
    return notConfigured;
  }
  let creds: Record<string, string> | null;
  try {
    creds = adapter.credentials(env);
  } catch {
    creds = null;
  }
  if (creds === null) {
    noteState(service.id, spec.type, 'not-configured');
    return notConfigured;
  }

  // The target is part of the key: a changed widget.url must not be served the old reply.
  const key = `service:${service.id}|${spec.type}|${spec.url ?? ''}|${spec.host ?? ''}`;
  const result = await cache.get(key, refreshMsOf(config, spec.type), () =>
    adapter.fetch(
      createContext({
        adapter,
        widget: spec,
        creds,
        traefikUrl: env.traefikUrl,
        cached: cachedUnder(key),
      }),
    ),
  );

  if (result.error !== null || result.value === null) {
    const state = stateOf(result.error);
    noteState(service.id, spec.type, state);
    if (!(result.error instanceof IntegrationError))
      warnOnce(`malformed:${service.id}`, 'integration reply could not be read', {
        type: spec.type,
        error: result.error instanceof Error ? result.error.name : 'unknown',
      });
    return { type: spec.type, state, fetchedAt: iso(result.fetchedAt), stats: [] };
  }

  noteState(service.id, spec.type, 'ok');
  const plan = planFields(adapter, spec.fields);
  if (plan.unknown > 0 || plan.cut.length > 0)
    warnOnce(
      `fields:${service.id}|${(spec.fields ?? []).join(',')}`,
      `iris.widget.fields: ${plan.unknown} unknown field(s) ignored` +
        (plan.cut.length > 0
          ? `; a tile shows at most ${MAX_FIELDS} (left out: ${plan.cut.join(', ')})`
          : ''),
      { type: spec.type },
    );
  return {
    type: spec.type,
    state: 'ok',
    fetchedAt: iso(result.fetchedAt),
    stats: selectStats(adapter, result.value, spec.fields),
  };
}

export async function getWidgets(
  state: AppState,
  config: IrisConfig,
  env: ServerEnv,
  now: number,
): Promise<WidgetsResponse> {
  const withWidget = (state.discovery?.groups ?? [])
    .flatMap((g) => g.services)
    .filter((s) => s.widget !== null);

  const deps: WidgetDeps = {
    config,
    env,
    now,
    cache,
    context: (adapter, creds) =>
      createContext({
        adapter,
        widget: null,
        creds,
        traefikUrl: env.traefikUrl,
        cached: cachedUnder(`adapter:${adapter.type}`),
      }),
    refreshMs: (type) => refreshMsOf(config, type),
    warnOnce,
  };

  const [entries, standalone, weather] = await Promise.all([
    Promise.all(withWidget.map(async (s) => [s.id, await serviceWidget(s, config, env)] as const)),
    standaloneProvider === null
      ? Promise.resolve<StandaloneWidget[]>([])
      : standaloneProvider(deps).catch((): StandaloneWidget[] => {
          warnOnce('standalone-provider', 'standalone widgets could not be built');
          return [];
        }),
    weatherProvider === null
      ? Promise.resolve<Weather | null>(null)
      : weatherProvider(deps).catch((): null => {
          warnOnce('weather-provider', 'weather could not be built');
          return null;
        }),
  ]);

  return {
    generatedAt: new Date(now).toISOString(),
    services: Object.fromEntries(entries),
    standalone,
    weather,
  };
}

// ---- built-in adapters ----
// Registered last: `adapters` must exist first. Each adapter imports only the fetcher, never this file.
for (const adapter of [
  seerr,
  radarr,
  sonarr,
  prowlarr,
  autobrr,
  gotify,
  qbittorrent,
  tautulliTile,
  cloudflared,
])
  registerAdapter(adapter);
registerStandaloneProvider(marketsProvider);
registerWeatherProvider(weatherProviderImpl);
