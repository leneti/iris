import 'server-only';
import type { WidgetSpec } from '../discovery/discover';
import type { WidgetType } from '../discovery/labels';
import type { ServerEnv } from '../env';
import { HttpMethodError, httpRequest, type HttpResult } from '../http';

// The framework every integration adapter plugs into (handoff D1.12, §8.6). An adapter never
// sees a URL, a socket or the environment: it gets `ctx.get(path)` and its own credentials, and
// the fetcher decides where the request goes. The rules, each with a test:
//   - a credential travels only in a header the adapter passes (criterion 11.3);
//   - every call is a GET, except the qBittorrent sign-in (criterion 11.4);
//   - the browser's input never reaches a request (criterion 11.8): a path is a constant from
//     adapter code, and the origin is the adapter's `baseUrl`, the service's `widget.url`, or
//     Traefik with the service's Host header;
//   - a redirect is never followed once a credential header is present (httpRequest's rule).

export type IntegrationErrorCode = 'unauthorized' | 'rate-limited' | 'unreachable';

/** The only error an adapter's reply can turn into. The message never holds upstream text. */
export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  constructor(code: IntegrationErrorCode) {
    super(`integration ${code}`);
    this.name = 'IntegrationError';
    this.code = code;
  }
}

export type AdapterType = WidgetType | 'cloudflared' | 'coinmarketcap' | 'openmeteo';

/** One figure as an adapter returns it: a number, a fixed word, or a number with a lower bound. */
export type StatValue = number | string | { value: number; atLeast: true };
export type AdapterValues = Record<string, StatValue>;

export type AdapterContext = {
  /** GET `path` (a constant starting with a single `/`). Rejects with `IntegrationError`. */
  get(
    path: string,
    opts?: { headers?: Record<string, string>; maxBytes?: number },
  ): Promise<HttpResult>;
  /** Only on qBittorrent, and only for `/api/v2/auth/login`; any other path throws. */
  post?: (
    path: string,
    body: string,
    opts?: { headers?: Record<string, string> },
  ) => Promise<HttpResult>;
  /**
   * Runs `load` at most once per `ttlMs` for this service and `subKey`, on the registry's TTL
   * cache (key `<service cache key>:<subKey>`), for a figure that needs a longer refresh than
   * the adapter's own (Sonarr's series list). A failed load rejects, as the adapter's failure.
   */
  cached<T>(subKey: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
  creds: Record<string, string>;
  /** The service's integration; null for a standalone or weather adapter. */
  widget: WidgetSpec | null;
};

export type Adapter = {
  type: AdapterType;
  defaultFields: string[];
  /** Fields that come free in the same reply; allowed in `dashboard.widget.fields`. */
  extraFields: string[];
  /** The dashboard's own field names. A label never comes from an upstream. */
  labels: Record<string, string>;
  /** `bytes-per-second`, `percent` or a currency code, per field; the rest have no unit. */
  units?: Record<string, string>;
  /**
   * Names of `creds` entries that are identifiers and not secrets, and so may appear in a URL
   * path (Cloudflare's account and tunnel ids). Every other credential is refused in a URL.
   */
  pathCreds?: string[];
  /**
   * The fixed https origin of an external API (Cloudflare, CoinMarketCap, Open-Meteo). When set,
   * `ctx.get` uses it in place of `widget.url` or Traefik. Read only by `externalBase` below.
   */
  baseUrl?: string;
  /** `null` when the integration is not configured. */
  credentials(env: ServerEnv): Record<string, string> | null;
  fetch(ctx: AdapterContext): Promise<AdapterValues>;
};

export const LOGIN_PATH = '/api/v2/auth/login';
export const DEFAULT_TIMEOUT_MS = 5000;
/** Default body cap (Review Focus 3); Radarr's and Sonarr's lists pass a larger one. */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

// One slash, no authority-looking start ("//x"), no backslash, no whitespace, no fragment.
const SAFE_PATH = /^\/(?!\/)[^\s\\#]*$/;

/** Development only: stands in for every adapter's external API origin (see `externalBase`). */
export const DEV_EXTERNAL_BASE_VAR = 'DASHBOARD_DEV_EXTERNAL_BASE';

/**
 * A bare origin: https on any host, or http on 127.0.0.1 or localhost only. Anything else
 * (a path, a query, credentials, another scheme or host) is refused, never repaired.
 */
function devOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  return url.origin;
}

/**
 * The single place that reads `Adapter.baseUrl`. Outside production, `DASHBOARD_DEV_EXTERNAL_BASE`
 * replaces it, so the fixture server can stand in for Cloudflare, CoinMarketCap and Open-Meteo.
 * The variable is never read in production, and an invalid value is ignored.
 */
export function externalBase(adapter: Adapter): string | null {
  if (adapter.baseUrl === undefined) return null;
  if (process.env.NODE_ENV !== 'production') {
    const override = devOrigin(process.env[DEV_EXTERNAL_BASE_VAR]?.trim());
    if (override !== null) return override;
  }
  return adapter.baseUrl;
}

export type ContextInput = {
  adapter: Adapter;
  widget: WidgetSpec | null;
  creds: Record<string, string>;
  traefikUrl: string | undefined;
  /** The registry's cache for this context, keyed by `subKey` (see `AdapterContext.cached`). */
  cached: <T>(subKey: string, ttlMs: number, load: () => Promise<T>) => Promise<T>;
};

type Target = { url: string; hostHeader?: string };

function join(base: string, path: string): string {
  if (!SAFE_PATH.test(path)) throw new IntegrationError('unreachable');
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    throw new IntegrationError('unreachable');
  }
  // Keep a path prefix of the base (an app served under /radarr); the origin must not change.
  const prefix = origin.pathname.replace(/\/+$/, '');
  const url = new URL(prefix + path, origin);
  if (url.origin !== origin.origin) throw new IntegrationError('unreachable');
  return url.href;
}

function resolveTarget(input: ContextInput, path: string): Target {
  const external = externalBase(input.adapter);
  if (external !== null) return { url: join(external, path) };
  const widget = input.widget;
  if (widget?.url) return { url: join(widget.url, path) };
  if (widget?.host && input.traefikUrl !== undefined)
    return { url: join(input.traefikUrl, path), hostHeader: widget.host };
  throw new IntegrationError('unreachable');
}

function lowerHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase();
    // The Host header is the fetcher's to set, never the adapter's.
    if (key !== 'host') out[key] = value;
  }
  return out;
}

/** Timeouts, oversized bodies, refused connections: all "unreachable". Nothing else leaks out. */
function toIntegrationError(err: unknown): IntegrationError {
  return err instanceof IntegrationError ? err : new IntegrationError('unreachable');
}

function checked(res: HttpResult): HttpResult {
  if (res.status >= 200 && res.status < 300) return res;
  if (res.status === 401 || res.status === 403) throw new IntegrationError('unauthorized');
  if (res.status === 429) throw new IntegrationError('rate-limited');
  throw new IntegrationError('unreachable');
}

/**
 * A credential must travel in a header (or the sign-in body), never in a URL, where proxies log
 * it. Adapter code builds the path, so a bug could put a key there: refuse, send nothing.
 */
function refuseCredentialInUrl(input: ContextInput, url: string): void {
  const exempt = new Set(input.adapter.pathCreds ?? []);
  for (const [name, value] of Object.entries(input.creds)) {
    if (value === '' || exempt.has(name)) continue;
    if (url.includes(value) || url.includes(encodeURIComponent(value)))
      throw new IntegrationError('unreachable');
  }
}

export function createContext(input: ContextInput): AdapterContext {
  async function send(
    method: 'GET' | 'POST',
    path: string,
    headers: Record<string, string>,
    maxBytes: number,
    body?: string,
  ): Promise<HttpResult> {
    try {
      const target = resolveTarget(input, path);
      refuseCredentialInUrl(input, target.url);
      const res = await httpRequest({
        url: target.url,
        method,
        allowPost: method === 'POST',
        headers: { accept: 'application/json', 'user-agent': 'iris', ...headers },
        hostHeader: target.hostHeader,
        body,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxBytes,
        // httpRequest follows a redirect only without a credential header, a body, or a change of host.
        maxRedirects: 2,
        followVirtualHost: target.hostHeader !== undefined,
      });
      return checked(res);
    } catch (err) {
      throw toIntegrationError(err);
    }
  }

  const context: AdapterContext = {
    get: (path, opts) =>
      send('GET', path, lowerHeaders(opts?.headers), opts?.maxBytes ?? DEFAULT_MAX_BYTES),
    cached: input.cached,
    creds: input.creds,
    widget: input.widget,
  };

  if (input.adapter.type === 'qbittorrent') {
    context.post = async (path, body, opts) => {
      if (path !== LOGIN_PATH) throw new HttpMethodError('POST');
      return send(
        'POST',
        path,
        { 'content-type': 'application/x-www-form-urlencoded', ...lowerHeaders(opts?.headers) },
        DEFAULT_MAX_BYTES,
        body,
      );
    };
  }
  return context;
}
