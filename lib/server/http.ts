import 'server-only';
import http from 'node:http';
import https from 'node:https';

export type HttpRequestOptions = {
  url: string;
  method?: 'GET' | 'POST';
  allowPost?: boolean;
  headers?: Record<string, string>;
  /** Overrides the Host header, e.g. to reach a Traefik router by name. */
  hostHeader?: string;
  body?: string;
  /** Total time for the whole call: every redirect hop and the full body. */
  timeoutMs: number;
  maxBytes: number;
  /** Default 0. See `followTarget` for the conditions under which a redirect is followed. */
  maxRedirects?: number;
  /**
   * Opt-in, for requests that reach an app through a proxy by Host header. When `hostHeader` is
   * set, a redirect whose Location names that same hostname (any scheme or port) is followed by
   * asking the ORIGINAL origin for the Location's path and query, with the same Host header. The
   * request never leaves the original origin. Same credential, method and budget rules as any
   * other redirect.
   */
  followVirtualHost?: boolean;
  /**
   * Default false: a body over `maxBytes` rejects with `HttpTooLargeError`. When true, the first
   * `maxBytes` of the body are returned and the rest is never read (for callers that only need
   * the status and headers).
   */
  truncate?: boolean;
};

export type HttpResult = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  /** The URL of the response that was returned (the last hop). */
  url: string;
  redirects: number;
};

export class HttpTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`request timed out after ${timeoutMs} ms`);
    this.name = 'HttpTimeoutError';
  }
}

export class HttpTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`response is larger than ${maxBytes} bytes`);
    this.name = 'HttpTooLargeError';
  }
}

const afterResponse = new WeakSet<Error>();

/**
 * True when the request failed after the server had already started answering (on any hop):
 * a body cut short, a hang-up mid-stream, a parse error. The server is reachable, so callers
 * can tell this from a failure to connect.
 */
export function failedAfterResponse(err: unknown): boolean {
  return err instanceof Error && afterResponse.has(err);
}

export class HttpMethodError extends Error {
  constructor(method: string) {
    super(`${method} is not allowed for this request`);
    this.name = 'HttpMethodError';
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** The only request headers that may travel with a followed redirect. */
const REDIRECT_SAFE_HEADERS = new Set(['accept', 'host', 'user-agent']);

function parseUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new TypeError('only http and https URLs are supported');
  if (url.username || url.password) throw new TypeError('URLs must not carry credentials');
  return url;
}

/** Lower-cased hostname without a trailing dot, or null when the text is not a host. */
function bareHostname(hostOrHostPort: string): string | null {
  try {
    return new URL(`http://${hostOrHostPort}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/**
 * The URL to request next, or null when the redirect must not be followed. A redirect is followed
 * only when it cannot move a credential or a body anywhere new: the budget is not spent, the
 * method is GET without a body, the request carries no header besides accept, host and
 * user-agent, and the target has the same scheme, host and port. The one extension is
 * `followVirtualHost`, which maps a redirect to the virtual host back onto the original origin.
 */
function followTarget(
  opts: HttpRequestOptions,
  method: string,
  redirectsDone: number,
  origin: URL,
  current: URL,
  next: URL,
): URL | null {
  if (redirectsDone >= (opts.maxRedirects ?? 0)) return null;
  if (method !== 'GET' || opts.body !== undefined) return null;
  for (const name of Object.keys(opts.headers ?? {}))
    if (!REDIRECT_SAFE_HEADERS.has(name.toLowerCase())) return null;
  // URL.host is lower-cased and carries the port only when it is not the scheme default,
  // so with an equal protocol this compares scheme, host and effective port.
  if (next.protocol === current.protocol && next.host === current.host) return next;
  if (opts.followVirtualHost && opts.hostHeader !== undefined) {
    const virtual = bareHostname(opts.hostHeader);
    if (virtual !== null && virtual === next.hostname.toLowerCase().replace(/\.$/, '')) {
      // Copy the origin and set the parts one by one: building from a string such as
      // "//other.example/x" would be read as a protocol-relative URL and leave the origin.
      const target = new URL(origin.href);
      target.pathname = next.pathname;
      target.search = next.search;
      target.hash = '';
      return target;
    }
  }
  return null;
}

function flattenHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

export function httpRequest(opts: HttpRequestOptions): Promise<HttpResult> {
  const method = opts.method ?? 'GET';
  if (method === 'POST' && !opts.allowPost) return Promise.reject(new HttpMethodError(method));
  if (!(opts.timeoutMs > 0) || !(opts.maxBytes > 0))
    return Promise.reject(new RangeError('timeoutMs and maxBytes must be positive'));

  let first: URL;
  try {
    first = parseUrl(opts.url);
  } catch (err) {
    return Promise.reject(err);
  }

  return new Promise<HttpResult>((resolve, reject) => {
    let settled = false;
    let active: http.ClientRequest | undefined;
    let responded = false;

    const timer = setTimeout(() => finish(new HttpTimeoutError(opts.timeoutMs)), opts.timeoutMs);

    function finish(outcome: Error | HttpResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (outcome instanceof Error) {
        if (responded) afterResponse.add(outcome);
        // Destroying the request also destroys its socket, so nothing keeps streaming.
        active?.destroy();
        reject(outcome);
      } else {
        resolve(outcome);
      }
    }

    function hop(url: URL, redirectsDone: number): void {
      if (settled) return;
      const headers: Record<string, string> = { ...opts.headers };
      if (opts.hostHeader !== undefined) {
        for (const name of Object.keys(headers))
          if (name.toLowerCase() === 'host') delete headers[name];
        headers.host = opts.hostHeader;
      }
      if (opts.body !== undefined) headers['content-length'] = String(Buffer.byteLength(opts.body));

      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(url, {
        method,
        headers,
        // A fresh connection per hop: no pooled socket is ever reused across Host overrides.
        agent: false,
      });
      active = req;

      req.on('error', (err) => finish(err));
      req.on('response', (res) => {
        responded = true;
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (REDIRECT_STATUSES.has(status) && location) {
          let next: URL | undefined;
          try {
            next = new URL(location, url);
          } catch {
            next = undefined;
          }
          const target =
            next && !next.username && !next.password
              ? followTarget(opts, method, redirectsDone, first, url, next)
              : null;
          if (target) {
            res.destroy();
            hop(target, redirectsDone + 1);
            return;
          }
        }

        const result = (body: Buffer): HttpResult => ({
          status,
          headers: flattenHeaders(res.headers),
          body,
          url: url.toString(),
          redirects: redirectsDone,
        });

        const declared = Number(res.headers['content-length']);
        if (!opts.truncate && Number.isFinite(declared) && declared > opts.maxBytes) {
          finish(new HttpTooLargeError(opts.maxBytes));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          if (opts.truncate) {
            chunks.push(chunk.subarray(0, opts.maxBytes - total));
            total += chunk.length;
            if (total >= opts.maxBytes) {
              // Enough: answer now and drop the connection instead of reading the rest.
              finish(result(Buffer.concat(chunks)));
              res.destroy();
            }
            return;
          }
          total += chunk.length;
          if (total > opts.maxBytes) {
            finish(new HttpTooLargeError(opts.maxBytes));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', (err) => finish(err));
        res.on('close', () => {
          if (!res.complete) finish(new Error('response closed before it was complete'));
        });
        res.on('end', () => finish(result(Buffer.concat(chunks))));
      });

      req.end(opts.body);
    }

    hop(first, 0);
  });
}
