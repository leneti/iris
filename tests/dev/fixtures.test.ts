import http from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseContainers } from '@/lib/server/docker/parse';
import { LAN_APP_PORTS, startFixtures, type Fixtures } from '../../dev/fixtures/server';

let fx: Fixtures;
beforeAll(async () => {
  fx = await startFixtures({
    port: { docker: 0, traefik: 0, cron: 0, glances: 0, tautulli: 0 },
    lanApps: 'ephemeral',
  });
});
afterAll(async () => {
  await fx.close();
});

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };
function get(port: number, path: string, headers: http.OutgoingHttpHeaders = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, headers, agent: false }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      })
      .on('error', reject);
  });
}
const json = (r: Reply) => JSON.parse(r.body) as unknown;

describe('Docker fixture', () => {
  test('lists the placeholder services as parseable containers', async () => {
    const res = await get(fx.ports.docker, '/v1.52/containers/json?all=true');
    expect(res.status).toBe(200);
    const containers = parseContainers(json(res));
    const enabled = containers.filter((c) => c.labels['iris.enable'] === 'true');
    // 17 labelled containers plus Edge Tunnel, which is a services.yaml entry: handoff 12.1's 18 services.
    expect(enabled).toHaveLength(17);
    expect(containers.map((c) => c.name)).not.toContain('captcha-solver');
    expect(containers.map((c) => c.name)).toContain('edge-tunnel');
    expect(new Set(enabled.map((c) => c.labels['iris.group']))).toEqual(
      new Set(['Media', 'Automation', 'Downloads', 'Infrastructure', 'Home']),
    );
  });

  test('qBittorrent routes through a label on the VPN Gateway container', async () => {
    const containers = parseContainers(
      json(await get(fx.ports.docker, '/v1.52/containers/json?all=true')),
    );
    const vpn = containers.find((c) => c.name === 'vpn-gateway')!;
    const torrent = containers.find((c) => c.name === 'torrent-client')!;
    expect(torrent.labels['iris.router']).toBe('torrent');
    expect(vpn.labels['traefik.http.routers.torrent.rule']).toContain('torrent.example.invalid');
    expect(Object.keys(torrent.labels).some((k) => k.startsWith('traefik.'))).toBe(false);
  });

  test('one service is stopped, one starting, and every other one healthy', async () => {
    const containers = parseContainers(
      json(await get(fx.ports.docker, '/v1.52/containers/json?all=true')),
    );
    const by = (n: string) => containers.find((c) => c.name === n)!;
    expect(by('self-heal').state).toBe('exited');
    expect(by('profile-kit').health).toBe('starting');
    expect(by('moviebox').health).toBe('healthy');
  });
});

describe('Traefik fixture', () => {
  test('Torrent Client refuses framing', async () => {
    const res = await get(fx.ports.traefik, '/', { host: 'torrent.example.invalid' });
    expect(res.status).toBe(200);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('Showtrack answers 500, an unknown host gets the Traefik 404', async () => {
    expect(
      (await get(fx.ports.traefik, '/ping', { host: 'showtrack.example.invalid' })).status,
    ).toBe(500);
    const missing = await get(fx.ports.traefik, '/', { host: 'nobody.example.invalid' });
    expect(missing.status).toBe(404);
    expect(missing.body.trim()).toBe('404 page not found');
  });

  test('every router host in the Docker list has an app behind it', async () => {
    const containers = parseContainers(
      json(await get(fx.ports.docker, '/v1.52/containers/json?all=true')),
    );
    const hosts = containers.flatMap((c) =>
      Object.entries(c.labels)
        .filter(([k]) => k.endsWith('.rule'))
        .map(([, v]) => /Host\(`([^`]+)`\)/.exec(v)![1]!),
    );
    expect(hosts.length).toBeGreaterThanOrEqual(12);
    for (const host of hosts) {
      const res = await get(fx.ports.traefik, '/', { host });
      expect(res.status, host).not.toBe(404);
    }
  });

  test('integration endpoints need their key and return the reply shapes', async () => {
    const host = 'request-desk.example.invalid';
    expect((await get(fx.ports.traefik, '/api/v1/request/count', { host })).status).toBe(401);
    const ok = await get(fx.ports.traefik, '/api/v1/request/count', {
      host,
      'x-api-key': 'fixture-key',
    });
    expect(json(ok)).toMatchObject({ pending: 3, available: 208 });
  });

  test('the outside APIs are answered on the same port', async () => {
    const tunnel = await get(fx.ports.traefik, '/client/v4/accounts/a-1/cfd_tunnel/t-1', {
      authorization: 'Bearer fixture-token',
    });
    expect(json(tunnel)).toMatchObject({ result: { status: 'healthy' } });
    const quotes = await get(
      fx.ports.traefik,
      '/v1/cryptocurrency/quotes/latest?symbol=AAA,BBB&convert=GBP',
      { 'x-cmc_pro_api_key': 'fixture-key' },
    );
    expect(Object.keys((json(quotes) as { data: object }).data)).toEqual(['AAA', 'BBB']);
    const weather = await get(fx.ports.traefik, '/v1/forecast?latitude=0.00&longitude=0.00');
    expect(json(weather)).toMatchObject({ current: { weather_code: 3 } });
  });

  test('/__counts counts requests and does not count itself', async () => {
    const before = json(await get(fx.ports.traefik, '/__counts')) as { total: number };
    await get(fx.ports.traefik, '/ping', { host: 'moviebox.example.invalid' });
    await get(fx.ports.traefik, '/ping', { host: 'moviebox.example.invalid' });
    const after = json(await get(fx.ports.traefik, '/__counts')) as {
      total: number;
      paths: Record<string, number>;
    };
    expect(after.total).toBe(before.total + 2);
    expect(after.paths['GET moviebox.example.invalid/ping']).toBeGreaterThanOrEqual(2);
  });
});

describe('cron-status, Glances and Tautulli fixtures', () => {
  test('cron-status lists the five placeholder jobs', async () => {
    const jobs = json(await get(fx.ports.cron, '/cron-status')) as {
      name: string;
      status: string;
    }[];
    expect(jobs.map((j) => [j.name, j.status])).toEqual([
      ['feed-sync', 'success'],
      ['price-watch', 'failed'],
      ['photo-index', 'success'],
      ['report-digest', 'warning'],
      ['cert-check', 'success'],
    ]);
  });

  test('Glances serves every endpoint the System panel reads', async () => {
    for (const name of ['quicklook', 'mem', 'fs', 'network', 'sensors', 'uptime', 'load', 'status'])
      expect((await get(fx.ports.glances, `/api/4/${name}`)).status, name).toBe(200);
  });

  test('Tautulli needs the key and counts a request per call', async () => {
    const path = '/api/v2?cmd=get_activity';
    expect((await get(fx.ports.tautulli, path)).status).toBe(401);
    const res = await get(fx.ports.tautulli, path, { 'x-api-key': 'fixture-key' });
    expect(json(res)).toMatchObject({ response: { result: 'success' } });
    const counts = json(await get(fx.ports.tautulli, '/__counts')) as { total: number };
    expect(counts.total).toBeGreaterThanOrEqual(2);
  });
});

describe('frame apps (Ruling R38)', () => {
  const RANGE = [47485, 47499] as const;
  const inRange = (port: number) => port >= RANGE[0] && port <= RANGE[1];

  test('every framed app answers on its own 127.0.0.1 port with a text input', async () => {
    expect(Object.keys(fx.lanPorts).sort()).toEqual(Object.keys(LAN_APP_PORTS).sort());
    for (const [host, port] of Object.entries(fx.lanPorts)) {
      if (host === 'showtrack.example.invalid') continue; // degraded on purpose: answers 500
      const res = await get(port, '/');
      expect(res.status, host).toBe(200);
      expect(res.body, host).toContain('<input');
    }
    expect((await get(fx.lanPorts['showtrack.example.invalid']!, '/')).status).toBe(500);
  });

  test('Torrent Client still refuses framing on its own port', async () => {
    const res = await get(fx.lanPorts['torrent.example.invalid']!, '/');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('the default ports stay in 47485-47499', () => {
    const ports = Object.values(LAN_APP_PORTS);
    expect(new Set(ports).size).toBe(ports.length);
    for (const port of ports) expect(inRange(port), String(port)).toBe(true);
  });

  test('no discovered service points a frame at a port outside the range', async () => {
    const containers = parseContainers(
      json(await get(fx.ports.docker, '/v1.52/containers/json?all=true')),
    );
    const enabled = containers.filter((c) => c.labels['iris.enable'] === 'true');
    const used = new Set<number>();
    for (const c of enabled) {
      const label = c.labels['iris.lan.port'];
      if (label === 'none') continue;
      const ports = label === undefined ? c.publicPorts : [Number(label)];
      for (const port of ports) {
        // Frames stay in the fixture range, never on a port a real service may use.
        expect(inRange(port), `${c.name}: ${port}`).toBe(true);
        used.add(port);
      }
    }
    expect([...used].sort((a, b) => a - b)).toEqual(
      Object.values(LAN_APP_PORTS).sort((a, b) => a - b),
    );
  });
});
