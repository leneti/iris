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
    dockerUrl: opt('DASHBOARD_DOCKER_URL'),
    dockerApiVersion: opt('DASHBOARD_DOCKER_API_VERSION') ?? '1.52',
    traefikUrl: opt('DASHBOARD_TRAEFIK_URL'),
    cronStatusUrl: opt('DASHBOARD_CRON_STATUS_URL'),
    zone: opt('DASHBOARD_ZONE'),
    allowedHosts: Object.freeze(
      (source.DASHBOARD_ALLOWED_HOSTS ?? '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),
    hostStatusFile: opt('DASHBOARD_HOST_STATUS_FILE'),
    iconsBase: opt('DASHBOARD_ICONS_BASE'),
    configDir: opt('DASHBOARD_CONFIG_DIR') ?? '/config',
    cacheDir: opt('DASHBOARD_CACHE_DIR') ?? '/cache',
    seerrKey: secret('DASHBOARD_SEERR_KEY'),
    tautulliKey: secret('DASHBOARD_TAUTULLI_KEY'),
    radarrKey: secret('DASHBOARD_RADARR_KEY'),
    sonarrKey: secret('DASHBOARD_SONARR_KEY'),
    prowlarrKey: secret('DASHBOARD_PROWLARR_KEY'),
    autobrrKey: secret('DASHBOARD_AUTOBRR_KEY'),
    qbittorrentUsername: secret('DASHBOARD_QBITTORRENT_USERNAME'),
    qbittorrentPassword: secret('DASHBOARD_QBITTORRENT_PASSWORD'),
    cloudflareAccountId: secret('DASHBOARD_CLOUDFLARE_ACCOUNT_ID'),
    cloudflareTunnelId: secret('DASHBOARD_CLOUDFLARE_TUNNEL_ID'),
    cloudflareToken: secret('DASHBOARD_CLOUDFLARE_TOKEN'),
    coinmarketcapKey: secret('DASHBOARD_COINMARKETCAP_KEY'),
    gotifyToken: secret('DASHBOARD_GOTIFY_TOKEN'),
  };
  return Object.freeze(env);
}
