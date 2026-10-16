import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { loadEnv } from '@/lib/server/env';
import { probe, type ProbeDeps } from '@/lib/server/health/probe';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
const servers: http.Server[] = [];

async function serve(handler: Handler): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
          s.closeAllConnections();
        }),
    ),
  );
});

const envFor = (traefikUrl: string | undefined) => loadEnv({ DASHBOARD_TRAEFIK_URL: traefikUrl });

function clock(...times: number[]): ProbeDeps {
  let i = 0;
  return { now: () => times[Math.min(i++, times.length - 1)] ?? 0 };
}

const traefikTarget = { kind: 'traefik', host: 'radarr.example.invalid', path: '/' } as const;

describe('probe targets', () => {
  test('none gives null', async () => {
    expect(await probe({ kind: 'none' }, envFor(undefined))).toBeNull();
  });

  test('traefik target without DASHBOARD_TRAEFIK_URL gives null (not configured)', async () => {
    expect(await probe(traefikTarget, envFor(undefined))).toBeNull();
  });

  test('traefik target sends the router host and path to the Traefik URL', async () => {
    const seen: { host?: string; url?: string; ua?: string }[] = [];
    const origin = await serve((req, res) => {
      seen.push({ host: req.headers.host, url: req.url, ua: req.headers['user-agent'] });
      res.end('ok');
    });
    const r = await probe(
      { kind: 'traefik', host: 'radarr.example.invalid', path: '/ping?x=1' },
      envFor(`${origin}/`),
    );
    expect(r?.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.host).toBe('radarr.example.invalid');
    expect(seen[0]?.url).toBe('/ping?x=1');
    expect(seen[0]?.ua).toBeTruthy();
  });

  test('a path without a leading slash is still an absolute path', async () => {
    let url = '';
    const origin = await serve((req, res) => {
      url = req.url ?? '';
      res.end('ok');
    });
    await probe({ kind: 'traefik', host: 'a.example.invalid', path: 'health' }, envFor(origin));
    expect(url).toBe('/health');
  });

  test('url target is requested directly with no Host override', async () => {
    let host: string | undefined;
    const origin = await serve((req, res) => {
      host = req.headers.host;
      res.end('ok');
    });
    const r = await probe({ kind: 'url', url: `${origin}/status` }, envFor(undefined));
    expect(r?.ok).toBe(true);
    expect(host).toBe(origin.replace('http://', ''));
  });
});

describe('probe pass and fail codes', () => {
  test.each([200, 204, 301, 399, 401, 403])('status %i passes', async (code) => {
    // 301 and 399 carry no Location, so they are returned as they are.
    const origin = await serve((_req, res) => res.writeHead(code).end());
    const r = await probe(traefikTarget, envFor(origin), clock(1000, 1042));
    expect(r).toMatchObject({ ok: true, code, reason: null, latencyMs: 42 });
  });

  test('500 fails with upstream-error', async () => {
    const origin = await serve((_req, res) => res.writeHead(500).end('boom'));
    const r = await probe(traefikTarget, envFor(origin));
    expect(r).toMatchObject({ ok: false, code: 500, reason: 'upstream-error', frame: null });
  });

  test.each([400, 404, 405, 429, 502, 503])('status %i fails with upstream-error', async (code) => {
    const origin = await serve((_req, res) =>
      res.writeHead(code, { 'content-type': 'text/html' }).end('<h1>nope</h1>'),
    );
    const r = await probe(traefikTarget, envFor(origin));
    expect(r).toMatchObject({ ok: false, code, reason: 'upstream-error' });
  });

  test("Traefik's own 404 is route-missing", async () => {
    const origin = await serve((_req, res) =>
      res
        .writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        .end('404 page not found\n'),
    );
    const r = await probe(traefikTarget, envFor(origin));
    expect(r).toMatchObject({ ok: false, code: 404, reason: 'route-missing' });
  });

  test('another text/plain 404 is upstream-error', async () => {
    const origin = await serve((_req, res) =>
      res.writeHead(404, { 'content-type': 'text/plain' }).end('no such movie'),
    );
    const r = await probe(traefikTarget, envFor(origin));
    expect(r).toMatchObject({ code: 404, reason: 'upstream-error' });
  });

  test('the Traefik 404 body with another content type is upstream-error', async () => {
    const origin = await serve((_req, res) =>
      res.writeHead(404, { 'content-type': 'text/html' }).end('404 page not found'),
    );
    const r = await probe(traefikTarget, envFor(origin));
    expect(r?.reason).toBe('upstream-error');
  });

  test('a url target never reports route-missing', async () => {
    const origin = await serve((_req, res) =>
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404 page not found\n'),
    );
    const r = await probe({ kind: 'url', url: origin }, envFor(undefined));
    expect(r?.reason).toBe('upstream-error');
  });

  test('a slow upstream times out', async () => {
    const origin = await serve(() => {});
    const r = await probe(traefikTarget, envFor(origin), { timeoutMs: 60 });
    expect(r).toMatchObject({ ok: false, code: null, latencyMs: null, reason: 'timeout' });
  });

  test('a refused connection to a url target is upstream-error', async () => {
    const origin = await serve((_req, res) => res.end());
    await new Promise<void>((resolve) => {
      for (const s of servers.splice(0)) s.close(() => resolve());
    });
    const r = await probe({ kind: 'url', url: origin }, envFor(undefined));
    expect(r).toMatchObject({ ok: false, code: null, reason: 'upstream-error' });
  });

  test('Traefik itself unreachable gives null: no data, not a verdict on the app', async () => {
    const origin = await serve((_req, res) => res.end());
    await new Promise<void>((resolve) => {
      for (const s of servers.splice(0)) s.close(() => resolve());
    });
    expect(await probe(traefikTarget, envFor(origin))).toBeNull();
  });

  test('a socket destroyed mid-body after the response started is a failed probe', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': '100000' });
      res.write('abc');
      setTimeout(() => res.destroy(), 20);
    });
    const r = await probe(traefikTarget, envFor(origin));
    expect(r).toMatchObject({ ok: false, code: null, reason: 'upstream-error', frame: null });
  });

  test('a socket destroyed before any response is no answer from Traefik: null', async () => {
    const origin = await serve((req) => req.socket.destroy());
    expect(await probe(traefikTarget, envFor(origin))).toBeNull();
  });

  test('an unresolvable Traefik host gives null', async () => {
    expect(await probe(traefikTarget, envFor('http://traefik.example.invalid:80'))).toBeNull();
  });

  test('a garbled response is a failed probe, not no answer', async () => {
    const net = await import('node:net');
    const server = net.createServer((sock) => {
      sock.on('data', () => sock.end('NOT HTTP\r\n\r\n'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const r = await probe(traefikTarget, envFor(`http://127.0.0.1:${port}`));
      expect(r).toMatchObject({ ok: false, reason: 'upstream-error' });
    } finally {
      server.close();
    }
  });

  test('checkedAt comes from the injected clock', async () => {
    const origin = await serve((_req, res) => res.end('ok'));
    const t = Date.parse('2026-10-10T00:14:50.000Z');
    const r = await probe(traefikTarget, envFor(origin), clock(t, t + 5));
    expect(r?.checkedAt).toBe('2026-10-10T00:14:50.005Z');
  });
});

describe('probe redirects and frame headers', () => {
  test('records X-Frame-Options and CSP of a passing response', async () => {
    const origin = await serve((_req, res) =>
      res
        .writeHead(200, {
          'x-frame-options': 'SAMEORIGIN',
          'content-security-policy': "frame-ancestors 'self'",
          'content-security-policy-report-only': 'frame-ancestors *',
        })
        .end('ok'),
    );
    const r = await probe(traefikTarget, envFor(origin));
    expect(r?.frame).toEqual({ xfo: 'SAMEORIGIN', csp: "frame-ancestors 'self'" });
  });

  test('absent headers give nulls, not an absent frame', async () => {
    const origin = await serve((_req, res) => res.end('ok'));
    expect((await probe(traefikTarget, envFor(origin)))?.frame).toEqual({ xfo: null, csp: null });
  });

  test('frame headers come from the final page after a redirect to the virtual host', async () => {
    const seen: { host?: string; url?: string }[] = [];
    const origin = await serve((req, res) => {
      seen.push({ host: req.headers.host, url: req.url });
      if (req.url === '/')
        res
          .writeHead(302, {
            location: 'https://radarr.example.invalid/login',
            'x-frame-options': 'ALLOW-FROM https://elsewhere.example.invalid',
          })
          .end();
      else res.writeHead(200, { 'x-frame-options': 'DENY' }).end('login');
    });
    const r = await probe(traefikTarget, envFor(origin));
    expect(r).toMatchObject({ ok: true, code: 200, frame: { xfo: 'DENY', csp: null } });
    expect(seen).toEqual([
      { host: 'radarr.example.invalid', url: '/' },
      { host: 'radarr.example.invalid', url: '/login' },
    ]);
  });

  test('follows at most 3 redirects, then judges the last 3xx', async () => {
    let hits = 0;
    const origin = await serve((_req, res) => {
      hits += 1;
      res.writeHead(302, { location: '/again' }).end();
    });
    const r = await probe(traefikTarget, envFor(origin));
    expect(hits).toBe(4);
    expect(r).toMatchObject({ ok: true, code: 302, frame: null });
  });

  test('a redirect to another host is not followed and passes as a 3xx', async () => {
    let other = 0;
    const b = await serve((_req, res) => {
      other += 1;
      res.end();
    });
    const origin = await serve((_req, res) => res.writeHead(302, { location: `${b}/x` }).end());
    const r = await probe({ kind: 'url', url: origin }, envFor(undefined));
    expect(r).toMatchObject({ ok: true, code: 302, frame: null });
    expect(other).toBe(0);
  });

  test('a body over the cap does not turn a passing status into a failure', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(200, { 'x-frame-options': 'DENY', 'content-length': String(5 * 1024 * 1024) });
      res.write(Buffer.alloc(200 * 1024));
    });
    const r = await probe(traefikTarget, envFor(origin));
    expect(r).toMatchObject({ ok: true, code: 200, frame: { xfo: 'DENY' } });
  });

  test('a large 404 is still classified by status', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(Buffer.alloc(200 * 1024, 97));
    });
    const r = await probe(traefikTarget, envFor(origin));
    expect(r).toMatchObject({ ok: false, code: 404, reason: 'upstream-error' });
  });
});
