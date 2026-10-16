// Fixture upstreams for local development (Task 18). One Node process, placeholder data only.
// Run: node --experimental-strip-types dev/fixtures/server.ts
// Imports only node: modules and the JSON next to this file, so it needs no path aliases.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORTS = {
  docker: 47480,
  traefik: 47481,
  cron: 47482,
  glances: 47483,
  tautulli: 47484,
} as const;
export type FixtureName = keyof typeof DEFAULT_PORTS;

/** The placeholder key every fixture app accepts. `dev/.env.fixtures` uses the same words. */
const KEY = 'fixture-key';
const CLOUDFLARE_TOKEN = 'fixture-token';
const ZONE = 'example.invalid';
const DATA_DIR = join(import.meta.dirname, 'data');

const read = (name: string): string => readFileSync(join(DATA_DIR, name), 'utf8');
const readJson = (name: string): unknown => JSON.parse(read(name));

// ---- replies ----

type Reply = { status: number; body?: string; headers?: Record<string, string> };
const JSON_TYPE = { 'content-type': 'application/json' };
const ok = (data: unknown, headers: Record<string, string> = {}): Reply => ({
  status: 200,
  body: typeof data === 'string' ? data : JSON.stringify(data),
  headers: { ...JSON_TYPE, ...headers },
});
const fromFile = (name: string): Reply => ok(read(name));
const status = (code: number, body = ''): Reply => ({
  status: code,
  body,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});
const unauthorized = (): Reply => status(401, 'Unauthorized');

/** The movie list is large: 1,482 movies of which 14 are wanted (monitored, missing, released). */
function movies(): unknown[] {
  return Array.from({ length: 1482 }, (_, i) => ({
    id: i + 1,
    title: `Sample Film ${i + 1}`,
    monitored: i < 14 || i % 3 === 0,
    hasFile: i >= 14,
    isAvailable: true,
  }));
}

// ---- time: the cron-status and host status fixtures are relative to "now" ----

const MINUTE = 60_000;

/** London's offset from UTC (ms) at an instant. */
function londonOffset(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of London wall time `hour:minute` on the London calendar day `dayShift` from today. */
function londonDaily(now: number, hour: number, minute: number, dayShift: number): number {
  const probe = new Date(now + londonOffset(now));
  const wall = Date.UTC(
    probe.getUTCFullYear(),
    probe.getUTCMonth(),
    probe.getUTCDate() + dayShift,
    hour,
    minute,
  );
  return wall - londonOffset(wall - londonOffset(wall));
}

/** The latest daily occurrence at or before `now`, and the next one after it. */
function dailyAround(now: number, hour: number, minute: number): { last: number; next: number } {
  let shift = 0;
  while (londonDaily(now, hour, minute, shift) > now) shift -= 1;
  return {
    last: londonDaily(now, hour, minute, shift),
    next: londonDaily(now, hour, minute, shift + 1),
  };
}

const floorTo = (now: number, minutes: number): number =>
  Math.floor(now / (minutes * MINUTE)) * (minutes * MINUTE);
const iso = (ms: number): string => new Date(ms).toISOString();

type CronJob = { name: string; status: string; lastRun: string; message: string; url?: string };

/** handoff §12.1: feed-sync ok, price-watch failed, photo-index overdue, report-digest warning, cert-check ok. */
export function cronStatus(now: number): CronJob[] {
  return [
    {
      name: 'feed-sync',
      status: 'success',
      lastRun: iso(floorTo(now, 15) + 3000),
      message: 'Nothing to do.',
      url: `https://feed-sync.${ZONE}/`,
    },
    {
      name: 'price-watch',
      status: 'failed',
      lastRun: iso(floorTo(now, 30) + 1000),
      message: 'Upstream answered 503 three times.',
    },
    {
      // Scheduled daily at 07:00 and last run two days ago: always overdue.
      name: 'photo-index',
      status: 'success',
      lastRun: iso(londonDaily(now, 7, 0, -2) + 2000),
      message: 'Indexed 12 files.',
    },
    {
      name: 'report-digest',
      status: 'warning',
      lastRun: iso(floorTo(now, 60) + 4000),
      message: 'One section was empty.',
    },
    {
      name: 'cert-check',
      status: 'success',
      lastRun: iso(floorTo(now, 20)),
      message: 'All certificates are valid.',
    },
  ];
}

/** The host status file (§8.3), generated now so that it is never stale. */
export function hostStatus(now: number): Record<string, unknown> {
  const backup = dailyAround(now, 2, 30);
  return {
    version: 1,
    generatedAt: iso(now),
    timezone: 'Europe/London',
    userJobs: [
      { folder: 'feed-sync', name: 'feed-sync', schedule: '*/15 * * * *' },
      { folder: 'price-watch', name: 'price-watch', schedule: '*/30 * * * *' },
      { folder: 'photo-index', name: 'photo-index', schedule: '0 7 * * *' },
      { folder: 'report-digest', name: 'report-digest', schedule: '0 * * * *' },
      { folder: 'cert-check', name: 'cert-check', schedule: '*/20 * * * *' },
    ],
    unmatchedCrontabLines: 0,
    backup: {
      schedule: '30 2 * * *',
      lastStart: iso(backup.last),
      lastEnd: iso(backup.last + 15 * MINUTE),
      result: 'success',
      nextRun: iso(backup.next),
    },
    // Nothing is known about the updater here, which the panel shows as not monitored.
    updater: {
      schedule: '19 4 * * *',
      lastRun: null,
      result: 'unknown',
      paused: false,
      nextRun: null,
    },
  };
}

// ---- the per-service apps behind "Traefik" ----

type Req = {
  method: string;
  host: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
};
type App = (req: Req) => Reply;

// A page with a text input, so a browser check can type into a frame, switch tabs and see that
// the text is still there.
const html = (title: string): Reply => ({
  status: 200,
  body: `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px system-ui,sans-serif;margin:32px;color:#0f172a;background:#fff}input{font:inherit;padding:6px 8px;width:260px}</style>
<h1>${title}</h1><p>Placeholder app.</p>
<label>Notes <input name="notes" placeholder="Type here"></label>`,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});
const hasKey = (req: Req, header: string): boolean => req.headers[header] === KEY;

/** An app that answers every path with a page, plus the JSON endpoints an integration reads. */
function app(title: string, endpoints: Record<string, (req: Req) => Reply> = {}): App {
  return (req) => endpoints[req.path]?.(req) ?? html(title);
}

function quotes(query: URLSearchParams): Reply {
  const wanted = (query.get('symbol') ?? '').split(',').filter(Boolean);
  const all = readJson('coinmarketcap-quotes.json') as {
    status: unknown;
    data: Record<string, unknown>;
  };
  const data = Object.fromEntries(
    Object.entries(all.data).filter(([symbol]) => wanted.includes(symbol)),
  );
  return ok({ status: all.status, data });
}

const APPS: Record<string, App> = {
  [`streamhouse.${ZONE}`]: app('Streamhouse'),
  [`request-desk.${ZONE}`]: app('Request Desk', {
    '/api/v1/request/count': (r) =>
      hasKey(r, 'x-api-key') ? fromFile('seerr-request-count.json') : unauthorized(),
  }),
  [`moviebox.${ZONE}`]: app('Moviebox', {
    '/ping': () => ok({ status: 'OK' }),
    '/api/v3/movie': (r) => (hasKey(r, 'x-api-key') ? ok(movies()) : unauthorized()),
  }),
  // Degraded on purpose: the app and its integration answer 500.
  [`showtrack.${ZONE}`]: () => status(500, 'Internal Server Error'),
  [`indexer-hub.${ZONE}`]: app('Indexer Hub', {
    '/ping': () => ok({ status: 'OK' }),
    '/api/v1/indexerstats': (r) =>
      hasKey(r, 'x-api-key') ? fromFile('prowlarr-indexerstats.json') : unauthorized(),
  }),
  [`subtitle-sync.${ZONE}`]: app('Subtitle Sync'),
  [`profile-kit.${ZONE}`]: app('Profile Kit'),
  [`library-keeper.${ZONE}`]: app('Library Keeper'),
  [`release-grabber.${ZONE}`]: app('Release Grabber', {
    '/api/release/stats': (r) =>
      hasKey(r, 'x-api-token') ? fromFile('autobrr-release-stats.json') : unauthorized(),
  }),
  [`sweeper.${ZONE}`]: app('Sweeper', { '/health': () => ok({ status: 'ok' }) }),
  [`notify.${ZONE}`]: app('Notify', {
    '/application': (r) =>
      hasKey(r, 'x-gotify-key') ? fromFile('gotify-application.json') : unauthorized(),
    '/client': (r) => (hasKey(r, 'x-gotify-key') ? fromFile('gotify-client.json') : unauthorized()),
    '/message': (r) =>
      hasKey(r, 'x-gotify-key') ? fromFile('gotify-message-page.json') : unauthorized(),
  }),
  [`recipe-book.${ZONE}`]: app('Recipe Book', { '/api/app/about': () => ok({ version: '1.0.0' }) }),
  // qBittorrent answers without a sign-in and refuses to be framed.
  [`torrent.${ZONE}`]: (req) => {
    const endpoints: Record<string, () => Reply> = {
      '/api/v2/app/version': () => ok('"v5.0.0"'),
      '/api/v2/torrents/info': () => fromFile('qbittorrent-torrents-info.json'),
      '/api/v2/transfer/info': () => fromFile('qbittorrent-transfer-info.json'),
    };
    const reply = endpoints[req.path]?.() ?? html('Torrent Client');
    return { ...reply, headers: { ...reply.headers, 'x-frame-options': 'SAMEORIGIN' } };
  },
};

/**
 * A browser frame cannot send a Host header, so each app that Iris frames also answers on its own
 * 127.0.0.1 port (Ruling R38). The ports match `dashboard.lan.port` and the published ports in
 * data/containers.json. They stay in 47485-47499, a range that is not a well-known service port,
 * so no fixture ever points at a real local service.
 */
export const LAN_APP_PORTS: Readonly<Record<string, number>> = {
  [`streamhouse.${ZONE}`]: 47485,
  [`request-desk.${ZONE}`]: 47486,
  [`moviebox.${ZONE}`]: 47487,
  [`showtrack.${ZONE}`]: 47488,
  [`indexer-hub.${ZONE}`]: 47489,
  [`subtitle-sync.${ZONE}`]: 47490,
  [`profile-kit.${ZONE}`]: 47491,
  [`library-keeper.${ZONE}`]: 47492,
  [`torrent.${ZONE}`]: 47493,
  [`release-grabber.${ZONE}`]: 47494,
  [`sweeper.${ZONE}`]: 47495,
  [`notify.${ZONE}`]: 47496,
  [`recipe-book.${ZONE}`]: 47497,
};

/** The outside APIs, answered on the Traefik port when the Host is not one of the apps. */
function external(req: Req): Reply | null {
  const tunnel = /^\/client\/v4\/accounts\/[A-Za-z0-9-]+\/cfd_tunnel\/[A-Za-z0-9-]+$/;
  if (tunnel.test(req.path))
    return req.headers.authorization === `Bearer ${CLOUDFLARE_TOKEN}`
      ? fromFile('cloudflare-tunnel.json')
      : unauthorized();
  if (req.path === '/v1/cryptocurrency/quotes/latest')
    return hasKey(req, 'x-cmc_pro_api_key') ? quotes(req.query) : unauthorized();
  if (req.path === '/v1/forecast') return fromFile('openmeteo-forecast.json');
  return null;
}

function traefik(req: Req): Reply {
  const host = req.host;
  const target = APPS[host];
  if (target) return target(req);
  if (!host.endsWith(`.${ZONE}`)) {
    const reply = external(req);
    if (reply) return reply;
  }
  // Traefik's own answer for a Host without a router.
  return status(404, '404 page not found');
}

// ---- the other upstreams ----

const GLANCES = ['quicklook', 'mem', 'fs', 'network', 'sensors', 'uptime', 'load'];
function glances(req: Req): Reply {
  const name = /^\/api\/4\/([a-z]+)$/.exec(req.path)?.[1];
  if (name === 'status') return status(200, 'OK');
  if (name && GLANCES.includes(name)) return fromFile(`glances-${name}.json`);
  return status(404, 'Not Found');
}

function tautulli(req: Req): Reply {
  if (req.path === '/status') return status(200, 'OK');
  if (req.path === '/api/v2' && req.query.get('cmd') === 'get_activity')
    return hasKey(req, 'x-api-key') ? fromFile('tautulli-activity.json') : unauthorized();
  return status(404, 'Not Found');
}

const dockerList = /^\/v\d{1,3}\.\d{1,3}\/containers\/json$/;
function docker(req: Req): Reply {
  return dockerList.test(req.path) ? fromFile('containers.json') : status(404, 'page not found');
}

// ---- servers ----

export type Fixtures = {
  ports: Record<FixtureName, number>;
  /** The per-app listeners, by app host name; empty unless `lanApps` was asked for. */
  lanPorts: Record<string, number>;
  /** Writes the host status file now (it is also rewritten every minute). */
  writeHostStatus(): void;
  close(): Promise<void>;
};

export type FixtureOptions = {
  /** Per-server port override; 0 picks a free one. */
  port?: Partial<Record<FixtureName, number>>;
  host?: string;
  /**
   * Per-app listeners for browser frames: 'default' uses LAN_APP_PORTS, 'ephemeral' picks free
   * ports (tests), 'none' starts none.
   */
  lanApps?: 'default' | 'ephemeral' | 'none';
  /** Where the host status file is written at start and then every minute. */
  hostStatusFile?: string;
  log?: (line: string) => void;
};

function listen(
  handler: (req: Req) => Reply,
  host: string,
  port: number,
  counts: { total: number; paths: Record<string, number> },
): Promise<http.Server> {
  const server = http.createServer((incoming, res) => {
    const url = new URL(incoming.url ?? '/', 'http://fixture.invalid');
    const hostHeader = (incoming.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (url.pathname === '/__counts') {
      res.writeHead(200, JSON_TYPE).end(JSON.stringify(counts));
      return;
    }
    counts.total += 1;
    const key = `${incoming.method ?? 'GET'} ${hostHeader}${url.pathname}`;
    counts.paths[key] = (counts.paths[key] ?? 0) + 1;
    const reply = handler({
      method: incoming.method ?? 'GET',
      host: hostHeader,
      path: url.pathname,
      query: url.searchParams,
      headers: incoming.headers,
    });
    res.writeHead(reply.status, reply.headers ?? {}).end(reply.body ?? '');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

export async function startFixtures(options: FixtureOptions = {}): Promise<Fixtures> {
  const host = options.host ?? '127.0.0.1';
  const handlers: Record<FixtureName, (req: Req) => Reply> = {
    docker,
    traefik,
    cron: (req) =>
      req.path === '/cron-status' ? ok(cronStatus(Date.now())) : status(404, 'Not Found'),
    glances,
    tautulli,
  };
  const servers = {} as Record<FixtureName, http.Server>;
  const ports = {} as Record<FixtureName, number>;
  const lanServers: http.Server[] = [];
  const lanPorts: Record<string, number> = {};
  try {
    for (const name of Object.keys(DEFAULT_PORTS) as FixtureName[]) {
      const counts = { total: 0, paths: {} };
      servers[name] = await listen(
        handlers[name],
        host,
        options.port?.[name] ?? DEFAULT_PORTS[name],
        counts,
      );
      ports[name] = (servers[name].address() as AddressInfo).port;
    }
    if (options.lanApps === 'default' || options.lanApps === 'ephemeral') {
      for (const [appHost, port] of Object.entries(LAN_APP_PORTS)) {
        const app = APPS[appHost]!;
        const server = await listen(
          (req) => app({ ...req, host: appHost }),
          host,
          options.lanApps === 'default' ? port : 0,
          { total: 0, paths: {} },
        );
        lanServers.push(server);
        lanPorts[appHost] = (server.address() as AddressInfo).port;
      }
    }
  } catch (error) {
    await Promise.all(
      [...Object.values(servers), ...lanServers].map((s) => new Promise((r) => s.close(r))),
    );
    throw error;
  }

  const writeHostStatus = (): void => {
    if (!options.hostStatusFile) return;
    mkdirSync(dirname(options.hostStatusFile), { recursive: true });
    writeFileSync(options.hostStatusFile, `${JSON.stringify(hostStatus(Date.now()), null, 2)}\n`);
  };
  writeHostStatus();
  // The file is ignored once it is 15 minutes old, so keep it fresh while the fixtures run.
  const refresh = setInterval(writeHostStatus, MINUTE);
  refresh.unref();

  options.log?.(
    `fixtures listening on ${host}: ${(Object.keys(ports) as FixtureName[]).map((n) => `${n} ${ports[n]}`).join(', ')}` +
      (lanServers.length > 0 ? `; ${lanServers.length} app frames on 47485-47497` : ''),
  );
  return {
    ports,
    lanPorts,
    writeHostStatus,
    async close() {
      clearInterval(refresh);
      await Promise.all(
        [...Object.values(servers), ...lanServers].map(
          (s) =>
            new Promise<void>((resolve) => {
              s.closeAllConnections();
              s.close(() => resolve());
            }),
        ),
      );
    },
  };
}

// Started directly: `node --experimental-strip-types dev/fixtures/server.ts`.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const statusFile = process.env.DASHBOARD_HOST_STATUS_FILE;
  const fixtures = await startFixtures({
    lanApps: 'default',
    ...(statusFile ? { hostStatusFile: statusFile } : {}),
    log: (line) => console.log(line),
  });
  const stop = (): void => {
    void fixtures.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
