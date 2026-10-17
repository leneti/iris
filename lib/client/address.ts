import type { EmbedInfo, ServiceEntry } from '@/lib/shared/contract';

export type AddressMode = 'lan' | 'zone' | 'public';

function normaliseHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    h = end === -1 ? h : h.slice(0, end + 1);
  } else if (h.indexOf(':') === h.lastIndexOf(':')) {
    // A single colon is host:port; more than one is a bare IPv6 literal.
    h = h.replace(/:\d*$/, '');
  }
  return h.replace(/\.$/, '');
}

/**
 * Which address a service opens at (handoff 7.3). 'zone' when the host is the zone or one of
 * its subdomains; everything else, including a missing host or zone, is the LAN stage.
 */
export function addressMode(
  host: string | null,
  zone: string | undefined,
  addresses: 'auto' | 'public' = 'auto',
): AddressMode {
  const outside = addresses === 'public' ? 'public' : 'lan';
  const z = zone?.trim().toLowerCase().replace(/\.$/, '');
  if (!host || !z) return outside;
  const h = normaliseHost(host);
  return h === z || h.endsWith(`.${z}`) ? 'zone' : outside;
}

function bracketed(hostname: string): string {
  return hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
}

/**
 * The address a tab's iframe loads, or null when there is none to load. Null in zone mode means
 * a service with only a LAN port; the UI labels that "Home network only". Public mode (iris.yaml
 * `addresses: public`) takes the public address first and the LAN port only without one.
 */
export function frameUrl(s: ServiceEntry, mode: AddressMode, hostname: string): string | null {
  if (mode === 'public' && s.url !== null) return s.url;
  if ((mode === 'lan' || mode === 'public') && s.lan) {
    const path = s.lan.path.startsWith('/') ? s.lan.path : `/${s.lan.path}`;
    return `http://${bracketed(hostname)}:${s.lan.port}${path}`;
  }
  return s.url;
}

/** Public addresses are always https (7.3); LAN addresses are plain http. */
export function isPublicAddress(url: string): boolean {
  return url.toLowerCase().startsWith('https://');
}

/** The server's verdict, plus mixed content: an https page may not frame plain http. */
export function effectiveEmbed(
  s: ServiceEntry,
  pageProtocol: string,
  url: string | null,
): EmbedInfo {
  if (s.embed.verdict === 'blocked') return s.embed;
  if (url !== null && pageProtocol === 'https:' && url.toLowerCase().startsWith('http:')) {
    return { ...s.embed, verdict: 'blocked', reason: 'mixed-content' };
  }
  return s.embed;
}
