import 'server-only';
import type { ServerEnv } from './env';

const HOST_PARTS = /^(\[[^\]]*\]|[^:]*)(:.*)?$/;
const SAFE_NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const SAFE_IPV6 = /^\[[0-9a-f:.]+\]$/;

/**
 * Lower-case the Host header, drop one trailing dot from the host name (before any port),
 * keep IPv6 brackets and the port as written. A missing or empty value gives null.
 */
export function normalizeHost(raw: string | null): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  const match = HOST_PARTS.exec(value);
  if (!match) return null;
  const name = (match[1] ?? '').replace(/\.$/, '');
  if (!name) return null;
  return `${name}${match[2] ?? ''}`;
}

/** Exact `host[:port]` match. `host` must already be normalised; list entries are lower case. */
export function isAllowedHost(host: string | null, allowed: readonly string[]): boolean {
  return host !== null && allowed.includes(host);
}

function hostname(host: string): string {
  return HOST_PARTS.exec(host)?.[1] ?? '';
}

function frameSources(host: string, env: ServerEnv): string[] {
  const zone = env.zone?.toLowerCase();
  const safeZone = zone && SAFE_NAME.test(zone) ? zone : undefined;
  const sources: string[] = [];
  if (safeZone) sources.push(`https://*.${safeZone}`);

  const name = hostname(host);
  const underZone = safeZone !== undefined && (name === safeZone || name.endsWith(`.${safeZone}`));
  const safeName = SAFE_NAME.test(name) || SAFE_IPV6.test(name);
  if (env.allowedHosts.includes(host) && !underZone && safeName) sources.push(`http://${name}:*`);
  sources.push(...env.frameSources);
  return sources;
}

/** Headers for a request whose normalised Host is `host` (§7.3). */
export function securityHeaders(host: string, env: ServerEnv): Record<string, string> {
  const frames = frameSources(host, env);
  const csp = [
    "default-src 'self'",
    // React's development build needs eval for call stacks; production never has it.
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `frame-src ${frames.length > 0 ? frames.join(' ') : "'none'"}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}
