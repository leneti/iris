import 'server-only';
import { isIpHostname } from './labels';

const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
// `!Host(...)` is captured by the first group so it can be skipped.
const HOST_MATCHER = /(!\s*)?(?<![A-Za-z0-9_])Host\(\s*([`"])([^`"]*)\2/g;
const ROUTER_RULE_LABEL = /^traefik\.http\.routers\.([A-Za-z0-9][A-Za-z0-9_-]*)\.rule$/;

/**
 * The first plain host of a Traefik rule, lower-cased. `HostRegexp`, `HostSNI`, a negated `Host`,
 * templates and IP addresses give null.
 */
export function parseHostRule(rule: string): string | null {
  for (const match of rule.matchAll(HOST_MATCHER)) {
    if (match[1] !== undefined) continue;
    const host = (match[3] ?? '').trim().toLowerCase().replace(/\.$/, '');
    if (host.length > 0 && host.length <= 253 && HOSTNAME.test(host) && !isIpHostname(host))
      return host;
  }
  return null;
}

export function buildRouterMap(
  entries: { container: string; labels: Record<string, string> }[],
): Map<string, { host: string; container: string }> {
  const map = new Map<string, { host: string; container: string }>();
  for (const { container, labels } of entries) {
    for (const [key, rule] of Object.entries(labels)) {
      const name = ROUTER_RULE_LABEL.exec(key)?.[1];
      if (name === undefined || map.has(name)) continue;
      const host = parseHostRule(rule);
      if (host !== null) map.set(name, { host, container });
    }
  }
  return map;
}
