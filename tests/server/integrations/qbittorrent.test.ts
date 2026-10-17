import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadEnv } from '@/lib/server/env';
import { createContext } from '@/lib/server/integrations/fetcher';
import { adapter } from '@/lib/server/integrations/qbittorrent';
import { codeOf, fixture } from '../../helpers/adapter';

const USER = 'iris-user';
const PASS = 'p4ss-w0rd-7c1e9b';
const SID = 'sid-5e2a77b1c093d4f8';

type Req = { method: string; url: string; cookie?: string; body: string };
type Upstream = {
  /** true: every call needs the cookie. false: open, as the user's qBittorrent answers today. */
  auth: boolean;
  /** The sign-in answer. */
  login?: (body: string) => { status: number; headers?: Record<string, string>; body?: string };
  /** The SID currently valid; changing it simulates an expired session. */
  validSid: string;
};

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start(up: Upstream, creds: Record<string, string>) {
  const seen: Req[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url ?? '';
      seen.push({ method: req.method ?? '', url, cookie: req.headers.cookie, body });
      if (url === '/api/v2/auth/login') {
        const r = up.login?.(body) ?? {
          status: 200,
          headers: { 'set-cookie': `SID=${up.validSid}; HttpOnly; SameSite=Strict; path=/` },
          body: 'Ok.',
        };
        return void res.writeHead(r.status, r.headers).end(r.body ?? '');
      }
      if (up.auth && req.headers.cookie !== `SID=${up.validSid}`)
        return void res.writeHead(403).end('Forbidden');
      const route: Record<string, string> = {
        '/api/v2/torrents/info': fixture('qbittorrent/torrents-info.json'),
        '/api/v2/transfer/info': fixture('qbittorrent/transfer-info.json'),
      };
      const out = route[url];
      if (out === undefined) return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'application/json' }).end(out);
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ctx = createContext({
    adapter,
    widget: { type: 'qbittorrent', url: origin, host: null, fields: null },
    creds,
    traefikUrl: undefined,
    cached: (_k, _t, load) => load(),
  });
  return { ctx, seen, logins: () => seen.filter((s) => s.url === '/api/v2/auth/login') };
}

const both = { username: USER, password: PASS };

describe('qbittorrent adapter', () => {
  test('reads counts and rates without signing in when the service is open', async () => {
    const h = await start({ auth: false, validSid: SID }, {});
    expect(await adapter.fetch(h.ctx)).toEqual({
      leech: 2,
      seed: 148,
      download: 12_400_000,
      upload: 1_100_000,
    });
    expect(h.logins()).toHaveLength(0);
    expect(h.seen.every((s) => s.method === 'GET' && s.cookie === undefined)).toBe(true);
  });

  test('fields, labels and units', () => {
    expect(adapter.type).toBe('qbittorrent');
    expect(adapter.defaultFields).toEqual(['leech', 'download', 'seed', 'upload']);
    expect(adapter.labels).toEqual({
      leech: 'Leeching',
      seed: 'Seeding',
      download: 'Down',
      upload: 'Up',
    });
    expect(adapter.units).toEqual({ download: 'bytes-per-second', upload: 'bytes-per-second' });
  });

  test('credentials are optional: never null, and carry the pair only when both are set', () => {
    expect(adapter.credentials(loadEnv({}))).toEqual({});
    expect(adapter.credentials(loadEnv({ IRIS_QBITTORRENT_USERNAME: USER }))).toEqual({});
    expect(adapter.credentials(loadEnv({ IRIS_QBITTORRENT_PASSWORD: PASS }))).toEqual({});
    expect(
      adapter.credentials(
        loadEnv({ IRIS_QBITTORRENT_USERNAME: USER, IRIS_QBITTORRENT_PASSWORD: PASS }),
      ),
    ).toEqual(both);
  });

  test('signs in only after a 403, with a form body, then retries with the cookie', async () => {
    const h = await start({ auth: true, validSid: SID }, both);
    expect(await adapter.fetch(h.ctx)).toMatchObject({ leech: 2, seed: 148 });
    expect(h.seen[0]).toMatchObject({ url: '/api/v2/torrents/info', cookie: undefined });
    expect(h.seen[1]).toMatchObject({
      method: 'POST',
      url: '/api/v2/auth/login',
      body: `username=${USER}&password=${PASS}`,
    });
    expect(h.seen[2]).toMatchObject({ url: '/api/v2/torrents/info', cookie: `SID=${SID}` });
    expect(h.seen[3]).toMatchObject({ url: '/api/v2/transfer/info', cookie: `SID=${SID}` });
    expect(h.logins()).toHaveLength(1);
  });

  test('keeps the cookie between reads', async () => {
    const h = await start({ auth: true, validSid: SID }, both);
    await adapter.fetch(h.ctx);
    await adapter.fetch(h.ctx);
    expect(h.logins()).toHaveLength(1);
  });

  test('an expired cookie is dropped and the sign-in happens once more', async () => {
    const up: Upstream = { auth: true, validSid: SID };
    const h = await start(up, both);
    await adapter.fetch(h.ctx);
    up.validSid = 'sid-second-0a1b2c3d4e5f';
    expect(await adapter.fetch(h.ctx)).toMatchObject({ leech: 2 });
    expect(h.logins()).toHaveLength(2);
  });

  test('a 403 that persists after signing in is unauthorized, with no further sign-in', async () => {
    const h = await start(
      {
        auth: true,
        validSid: SID,
        login: () => ({ status: 200, headers: { 'set-cookie': 'SID=wrong; path=/' }, body: 'Ok.' }),
      },
      both,
    );
    expect(await codeOf(adapter.fetch(h.ctx))).toBe('unauthorized');
    expect(h.logins()).toHaveLength(1);
  });

  test('a 403 without both variables is unauthorized and nothing is posted', async () => {
    for (const creds of [{}, { username: USER }, { password: PASS }] as Record<string, string>[]) {
      const h = await start({ auth: true, validSid: SID }, creds);
      expect(await codeOf(adapter.fetch(h.ctx))).toBe('unauthorized');
      expect(h.logins()).toHaveLength(0);
    }
  });

  test('a refused sign-in ("Fails." with no cookie) is unauthorized', async () => {
    const h = await start(
      { auth: true, validSid: SID, login: () => ({ status: 200, body: 'Fails.' }) },
      both,
    );
    expect(await codeOf(adapter.fetch(h.ctx))).toBe('unauthorized');
  });

  test('finds SID in a joined set-cookie string', async () => {
    const h = await start(
      {
        auth: true,
        validSid: SID,
        login: () => ({
          status: 200,
          headers: { 'set-cookie': `other=1; path=/, SID=${SID}; HttpOnly; path=/` },
        }),
      },
      both,
    );
    expect(await adapter.fetch(h.ctx)).toMatchObject({ seed: 148 });
  });

  test('bad credentials over 10 minutes make at most 2 sign-in posts (cool-down)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const h = await start(
        { auth: true, validSid: SID, login: () => ({ status: 200, body: 'Fails.' }) },
        both,
      );
      for (let t = 0; t < 600_000; t += 10_000) {
        expect(await codeOf(adapter.fetch(h.ctx))).toBe('unauthorized');
        vi.advanceTimersByTime(10_000);
      }
      expect(h.logins().length).toBeLessThanOrEqual(2);
      expect(h.logins().length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a sign-in that works but reads that stay 403 gives no new sign-in until the cool-down ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const h = await start(
        {
          auth: true,
          validSid: SID,
          login: () => ({ status: 200, headers: { 'set-cookie': 'SID=wrong; path=/' } }),
        },
        both,
      );
      for (let i = 0; i < 5; i++) {
        expect(await codeOf(adapter.fetch(h.ctx))).toBe('unauthorized');
        vi.advanceTimersByTime(10_000);
      }
      expect(h.logins()).toHaveLength(1);
      vi.advanceTimersByTime(5 * 60_000);
      expect(await codeOf(adapter.fetch(h.ctx))).toBe('unauthorized');
      expect(h.logins()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a password that appears in a read path ("info") does not break reads', async () => {
    const h = await start({ auth: true, validSid: SID }, { username: USER, password: 'info' });
    expect(await adapter.fetch(h.ctx)).toMatchObject({ leech: 2, seed: 148 });
  });

  test('neither the password nor the cookie is in the output, an error or a log', async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => (out.push(String(s)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => (out.push(String(s)), true));
    const ok = await start({ auth: true, validSid: SID }, both);
    const values = await adapter.fetch(ok.ctx);
    const bad = await start(
      { auth: true, validSid: SID, login: () => ({ status: 200, body: 'Fails.' }) },
      both,
    );
    let message = '';
    try {
      await adapter.fetch(bad.ctx);
    } catch (e) {
      message = String(e) + JSON.stringify(e);
    }
    const all = JSON.stringify(values) + message + out.join('');
    expect(all).not.toContain(PASS);
    expect(all).not.toContain(SID);
    vi.restoreAllMocks();
  });
});
