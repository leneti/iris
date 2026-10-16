import 'server-only';
import type { HealthTarget } from '../discovery/discover';
import type { ServerEnv } from '../env';
import { HttpTimeoutError, failedAfterResponse, httpRequest } from '../http';

// Handoff D1.4 and §7.3, §7.4.

export type ProbeResult = {
  ok: boolean;
  code: number | null;
  latencyMs: number | null;
  reason: 'timeout' | 'upstream-error' | 'route-missing' | null;
  /** The final page's frame headers; null unless the probe passed on a page it reached. */
  frame: { xfo: string | null; csp: string | null } | null;
  checkedAt: string;
};

export type ProbeDeps = {
  /** Epoch milliseconds. Injected so tests are deterministic. */
  now?: () => number;
  timeoutMs?: number;
};

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
// The probe needs the status, the headers and, for a 404, the first words of the body.
const MAX_BODY_BYTES = 64 * 1024;
// Errors that mean nothing answered at all. After a response has started, any error is the
// app's failure instead.
const NO_ANSWER_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ECONNRESET',
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TRAEFIK_404_BODY = '404 page not found';

function passes(code: number): boolean {
  return (code >= 200 && code <= 399) || code === 401 || code === 403;
}

function traefikRequestUrl(base: string, path: string): string {
  // Plain concatenation keeps a path such as "//x" a path instead of a new authority.
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`);
}

function nothingAnswered(err: unknown): boolean {
  if (failedAfterResponse(err)) return false;
  const codes = [err, ...(err instanceof AggregateError ? err.errors : [])].map(
    (e) => (e as { code?: unknown } | null)?.code,
  );
  return codes.some((c) => typeof c === 'string' && NO_ANSWER_CODES.has(c));
}

/**
 * One HTTP probe. `null` means there is nothing to judge: no target, no `DASHBOARD_TRAEFIK_URL`
 * for a Traefik target, or Traefik did not answer at connection level (refused, unresolved,
 * unreachable, reset before any response; §7.4 calls that `unknown`, which the caller reads from
 * a null result for a configured probe). A timeout, any error after a response started, and any
 * error from a `url` target are failed probes.
 */
export async function probe(
  target: HealthTarget,
  env: Pick<ServerEnv, 'traefikUrl'>,
  deps: ProbeDeps = {},
): Promise<ProbeResult | null> {
  if (target.kind === 'none') return null;
  if (target.kind === 'traefik' && env.traefikUrl === undefined) return null;

  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const url =
    target.kind === 'url' ? target.url : traefikRequestUrl(env.traefikUrl ?? '', target.path);
  const failure = (
    reason: NonNullable<ProbeResult['reason']>,
    code: number | null,
    end: number,
  ): ProbeResult => ({
    ok: false,
    code,
    latencyMs: null,
    reason,
    frame: null,
    checkedAt: new Date(end).toISOString(),
  });

  const start = now();
  let res;
  try {
    res = await httpRequest({
      url,
      hostHeader: target.kind === 'traefik' ? target.host : undefined,
      headers: { accept: '*/*', 'user-agent': 'iris-health' },
      timeoutMs,
      maxBytes: MAX_BODY_BYTES,
      truncate: true,
      maxRedirects: MAX_REDIRECTS,
      followVirtualHost: true,
    });
  } catch (err) {
    const end = now();
    if (err instanceof HttpTimeoutError) return failure('timeout', null, end);
    if (target.kind === 'traefik' && nothingAnswered(err)) return null;
    return failure('upstream-error', null, end);
  }
  const end = now();

  if (!passes(res.status)) {
    const contentType = res.headers['content-type'] ?? '';
    const traefikNotFound =
      target.kind === 'traefik' &&
      res.status === 404 &&
      /^text\/plain\b/i.test(contentType) &&
      res.body.toString('utf8').trim() === TRAEFIK_404_BODY;
    return failure(traefikNotFound ? 'route-missing' : 'upstream-error', res.status, end);
  }

  // A redirect that was not followed (another host, or the hop cap) leaves the page unseen, and
  // frame headers must come from the final page.
  const unfollowed = REDIRECT_STATUSES.has(res.status) && res.headers.location !== undefined;
  return {
    ok: true,
    code: res.status,
    latencyMs: Math.max(0, end - start),
    reason: null,
    frame: unfollowed
      ? null
      : {
          xfo: res.headers['x-frame-options'] ?? null,
          csp: res.headers['content-security-policy'] ?? null,
        },
    checkedAt: new Date(end).toISOString(),
  };
}
