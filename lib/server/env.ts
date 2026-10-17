import 'server-only';
import { registerSecret } from './log';

export interface ServerEnv {
  readonly dockerUrl: string | undefined;
  readonly dockerApiVersion: string;
  readonly traefikUrl: string | undefined;
  readonly cronStatusUrl: string | undefined;
  readonly zone: string | undefined;
  readonly allowedHosts: readonly string[];
  /** Extra https origins the page may frame, from `IRIS_FRAME_SOURCES`. */
  readonly frameSources: readonly string[];
  readonly hostStatusFile: string | undefined;
  readonly iconsBase: string | undefined;
  readonly configDir: string;
  readonly cacheDir: string;
  readonly seerrKey: string | undefined;
  readonly tautulliKey: string | undefined;
  readonly radarrKey: string | undefined;
  readonly sonarrKey: string | undefined;
  readonly prowlarrKey: string | undefined;
  readonly autobrrKey: string | undefined;
  readonly qbittorrentUsername: string | undefined;
  readonly qbittorrentPassword: string | undefined;
  readonly cloudflareAccountId: string | undefined;
  readonly cloudflareTunnelId: string | undefined;
  readonly cloudflareToken: string | undefined;
  readonly coinmarketcapKey: string | undefined;
  readonly gotifyToken: string | undefined;
}

const SAFE_NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const IP_LIKE = /^[0-9.]+$/;

/**
 * `IRIS_FRAME_SOURCES`: comma-separated https URLs whose origins the page may frame besides the
 * zone's. Anything that is not https with a host name (no IP literal, no credentials) is dropped,
 * so a bad entry can never widen the policy beyond one named origin.
 */
function parseFrameSources(raw: string | undefined): readonly string[] {
  const origins = new Set<string>();
  for (const part of (raw ?? '').split(',')) {
    const value = part.trim();
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    if (!SAFE_NAME.test(url.hostname) || IP_LIKE.test(url.hostname)) continue;
    origins.add(url.origin);
  }
  return Object.freeze([...origins]);
}

export function loadEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ServerEnv {
  const opt = (name: string): string | undefined => {
    const v = source[name]?.trim();
    return v ? v : undefined;
  };
  const secret = (name: string): string | undefined => {
    const v = opt(name);
    if (v) registerSecret(v);
    return v;
  };
  const env: ServerEnv = {
    dockerUrl: opt('IRIS_DOCKER_URL'),
    dockerApiVersion: opt('IRIS_DOCKER_API_VERSION') ?? '1.52',
    traefikUrl: opt('IRIS_TRAEFIK_URL'),
    cronStatusUrl: opt('IRIS_CRON_STATUS_URL'),
    zone: opt('IRIS_ZONE'),
    allowedHosts: Object.freeze(
      (source.IRIS_ALLOWED_HOSTS ?? '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),
    frameSources: parseFrameSources(source.IRIS_FRAME_SOURCES),
    hostStatusFile: opt('IRIS_HOST_STATUS_FILE'),
    iconsBase: opt('IRIS_ICONS_BASE'),
    configDir: opt('IRIS_CONFIG_DIR') ?? '/config',
    cacheDir: opt('IRIS_CACHE_DIR') ?? '/cache',
    seerrKey: secret('IRIS_SEERR_KEY'),
    tautulliKey: secret('IRIS_TAUTULLI_KEY'),
    radarrKey: secret('IRIS_RADARR_KEY'),
    sonarrKey: secret('IRIS_SONARR_KEY'),
    prowlarrKey: secret('IRIS_PROWLARR_KEY'),
    autobrrKey: secret('IRIS_AUTOBRR_KEY'),
    qbittorrentUsername: secret('IRIS_QBITTORRENT_USERNAME'),
    qbittorrentPassword: secret('IRIS_QBITTORRENT_PASSWORD'),
    cloudflareAccountId: secret('IRIS_CLOUDFLARE_ACCOUNT_ID'),
    cloudflareTunnelId: secret('IRIS_CLOUDFLARE_TUNNEL_ID'),
    cloudflareToken: secret('IRIS_CLOUDFLARE_TOKEN'),
    coinmarketcapKey: secret('IRIS_COINMARKETCAP_KEY'),
    gotifyToken: secret('IRIS_GOTIFY_TOKEN'),
  };
  return Object.freeze(env);
}
