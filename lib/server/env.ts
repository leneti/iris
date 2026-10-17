import 'server-only';
import { registerSecret } from './log';

export interface ServerEnv {
  readonly dockerUrl: string | undefined;
  readonly dockerApiVersion: string;
  readonly traefikUrl: string | undefined;
  readonly cronStatusUrl: string | undefined;
  readonly zone: string | undefined;
  readonly allowedHosts: readonly string[];
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
