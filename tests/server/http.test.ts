import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import {
  HttpMethodError,
  HttpTimeoutError,
  HttpTooLargeError,
  httpRequest,
} from '@/lib/server/http';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const servers: http.Server[] = [];

async function serve(handler: Handler): Promise<{ origin: string; server: http.Server }> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, server };
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

const redirectChain: Handler = (req, res) => {
  const path = req.url ?? '/';
  if (path === '/hop1') res.writeHead(302, { location: '/hop2' }).end();
  else if (path === '/hop2') res.writeHead(301, { location: '/final' }).end('moved');
  else res.writeHead(200, { 'content-type': 'text/plain' }).end('done');
};

describe('httpRequest basics', () => {
  test('returns status, lower-cased headers, body and url', async () => {
    const { origin } = await serve((_req, res) =>
      res.writeHead(200, { 'X-Thing': 'a' }).end('hello'),
    );
    const r = await httpRequest({ url: `${origin}/x?y=1`, timeoutMs: 500, maxBytes: 1000 });
    expect(r.status).toBe(200);
    expect(r.headers['x-thing']).toBe('a');
    expect(r.body.toString()).toBe('hello');
    expect(r.url).toBe(`${origin}/x?y=1`);
    expect(r.redirects).toBe(0);
  });

  test('sends custom headers', async () => {
    let seen: string | undefined;
    const { origin } = await serve((req, res) => {
      seen = req.headers['x-api-key'] as string;
      res.end('ok');
    });
    await httpRequest({
      url: origin,
      headers: { 'X-Api-Key': 'k' },
      timeoutMs: 500,
      maxBytes: 1000,
    });
    expect(seen).toBe('k');
  });

  test('host header override reaches the server', async () => {
    let echoed: string | undefined;
    const { origin } = await serve((req, res) => {
      echoed = req.headers.host;
      res.end('ok');
    });
    await httpRequest({
      url: origin,
      hostHeader: 'radarr.example.invalid',
      timeoutMs: 500,
      maxBytes: 1000,
    });
    expect(echoed).toBe('radarr.example.invalid');
  });

  test('connection refused rejects with the underlying error', async () => {
    const { origin, server } = await serve((_req, res) => res.end());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(httpRequest({ url: origin, timeoutMs: 500, maxBytes: 1000 })).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  test('rejects unsupported schemes and embedded credentials', async () => {
    await expect(
      httpRequest({ url: 'file:///etc/passwd', timeoutMs: 100, maxBytes: 10 }),
    ).rejects.toThrow(/http/);
    await expect(
      httpRequest({ url: 'http://user:pw@127.0.0.1:1/', timeoutMs: 100, maxBytes: 10 }),
    ).rejects.toThrow(/credentials/);
  });
});

describe('httpRequest limits', () => {
  test('times out when the server never answers', async () => {
    const { origin } = await serve(() => {});
    await expect(httpRequest({ url: origin, timeoutMs: 50, maxBytes: 1e6 })).rejects.toBeInstanceOf(
      HttpTimeoutError,
    );
  });

  test('timeout is total, not idle: a slow trickle still times out', async () => {
    const { origin } = await serve((_req, res) => {
      res.writeHead(200);
      const t = setInterval(() => res.write('x'), 10);
      res.on('close', () => clearInterval(t));
    });
    const started = Date.now();
    await expect(
      httpRequest({ url: origin, timeoutMs: 120, maxBytes: 1e6 }),
    ).rejects.toBeInstanceOf(HttpTimeoutError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('timeout covers the whole redirect chain', async () => {
    const { origin } = await serve((req, res) => {
      if (req.url === '/a') setTimeout(() => res.writeHead(302, { location: '/b' }).end(), 60);
      // /b never answers
    });
    await expect(
      httpRequest({ url: `${origin}/a`, maxRedirects: 3, timeoutMs: 120, maxBytes: 1e6 }),
    ).rejects.toBeInstanceOf(HttpTimeoutError);
  });

  test('timeout closes the upstream connection', async () => {
    let closed!: () => void;
    const closedP = new Promise<void>((r) => (closed = r));
    const { origin } = await serve((_req, res) => {
      res.writeHead(200);
      res.write('x');
      res.on('close', closed);
    });
    await expect(httpRequest({ url: origin, timeoutMs: 50, maxBytes: 1e6 })).rejects.toBeInstanceOf(
      HttpTimeoutError,
    );
    await closedP;
  });

  test('caps the body while streaming (no content-length)', async () => {
    const { origin } = await serve((_req, res) => {
      res.writeHead(200);
      res.write(Buffer.alloc(600));
      res.write(Buffer.alloc(600));
      res.end(Buffer.alloc(600));
    });
    await expect(
      httpRequest({ url: origin, timeoutMs: 1000, maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(HttpTooLargeError);
  });

  test('rejects on content-length before reading the body', async () => {
    let wrote = false;
    const { origin } = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': '5000' });
      res.flushHeaders();
      setTimeout(() => {
        wrote = true;
        res.end(Buffer.alloc(5000));
      }, 300);
    });
    const started = Date.now();
    await expect(
      httpRequest({ url: origin, timeoutMs: 2000, maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(HttpTooLargeError);
    expect(Date.now() - started).toBeLessThan(250);
    expect(wrote).toBe(false);
  });

  test('a body exactly at the cap is accepted', async () => {
    const { origin } = await serve((_req, res) => res.end(Buffer.alloc(1024)));
    const r = await httpRequest({ url: origin, timeoutMs: 1000, maxBytes: 1024 });
    expect(r.body.length).toBe(1024);
  });

  test('rejects non-positive limits', async () => {
    await expect(
      httpRequest({ url: 'http://127.0.0.1:1', timeoutMs: 0, maxBytes: 10 }),
    ).rejects.toThrow(RangeError);
    await expect(
      httpRequest({ url: 'http://127.0.0.1:1', timeoutMs: 10, maxBytes: 0 }),
    ).rejects.toThrow(RangeError);
  });
});

describe('httpRequest methods', () => {
  test('rejects POST without allowPost', async () => {
    const { origin } = await serve((_req, res) => res.end());
    await expect(
      httpRequest({ url: origin, method: 'POST', timeoutMs: 100, maxBytes: 10 }),
    ).rejects.toBeInstanceOf(HttpMethodError);
  });

  test('sends a POST body when allowed', async () => {
    let received = '';
    let method = '';
    const { origin } = await serve((req, res) => {
      method = req.method ?? '';
      req.on('data', (c: Buffer) => (received += c.toString()));
      req.on('end', () => res.end('ok'));
    });
    const r = await httpRequest({
      url: origin,
      method: 'POST',
      allowPost: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=2',
      timeoutMs: 500,
      maxBytes: 100,
    });
    expect(r.status).toBe(200);
    expect(method).toBe('POST');
    expect(received).toBe('a=1&b=2');
  });

  test('never follows a redirect for POST', async () => {
    const { origin } = await serve((req, res) => {
      if (req.url === '/login') res.writeHead(302, { location: '/home' }).end();
      else res.end('home');
      req.resume();
    });
    const r = await httpRequest({
      url: `${origin}/login`,
      method: 'POST',
      allowPost: true,
      body: 'x',
      maxRedirects: 3,
      timeoutMs: 500,
      maxBytes: 100,
    });
    expect(r.status).toBe(302);
    expect(r.redirects).toBe(0);
  });
});

describe('httpRequest redirects', () => {
  test('does not follow by default', async () => {
    const { origin } = await serve(redirectChain);
    const r = await httpRequest({ url: `${origin}/hop1`, timeoutMs: 500, maxBytes: 1e4 });
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/hop2');
    expect(r.redirects).toBe(0);
  });

  test('follows same-host redirect up to the limit', async () => {
    const { origin } = await serve(redirectChain);
    const r = await httpRequest({
      url: `${origin}/hop1`,
      maxRedirects: 3,
      timeoutMs: 500,
      maxBytes: 1e4,
    });
    expect(r.redirects).toBe(2);
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe('done');
    expect(r.url).toBe(`${origin}/final`);
  });

  test('returns the last 3xx as-is when the limit is reached', async () => {
    const { origin } = await serve(redirectChain);
    const r = await httpRequest({
      url: `${origin}/hop1`,
      maxRedirects: 1,
      timeoutMs: 500,
      maxBytes: 1e4,
    });
    expect(r.redirects).toBe(1);
    expect(r.status).toBe(301);
    expect(r.url).toBe(`${origin}/hop2`);
  });

  test('a redirect loop stops at the limit', async () => {
    const { origin } = await serve((_req, res) => res.writeHead(302, { location: '/' }).end());
    const r = await httpRequest({ url: origin, maxRedirects: 3, timeoutMs: 500, maxBytes: 1e4 });
    expect(r.redirects).toBe(3);
    expect(r.status).toBe(302);
  });

  test('keeps the overridden Host header across redirects', async () => {
    const hosts: (string | undefined)[] = [];
    const { origin } = await serve((req, res) => {
      hosts.push(req.headers.host);
      if (req.url === '/a') res.writeHead(302, { location: '/b' }).end();
      else res.end('ok');
    });
    await httpRequest({
      url: `${origin}/a`,
      hostHeader: 'sonarr.example.invalid',
      maxRedirects: 2,
      timeoutMs: 500,
      maxBytes: 1e4,
    });
    expect(hosts).toEqual(['sonarr.example.invalid', 'sonarr.example.invalid']);
  });

  test('follows when only accept, host and user-agent are set (case-insensitive)', async () => {
    const { origin } = await serve(redirectChain);
    const r = await httpRequest({
      url: `${origin}/hop1`,
      headers: { Accept: '*/*', 'User-Agent': 'iris', HOST: 'x.example.invalid' },
      maxRedirects: 3,
      timeoutMs: 500,
      maxBytes: 1e4,
    });
    expect(r.redirects).toBe(2);
  });

  // Review Focus 2
  test('never follows a redirect to another host', async () => {
    let hitsOnB = 0;
    const b = await serve((_req, res) => {
      hitsOnB += 1;
      res.end('leak');
    });
    const a = await serve((_req, res) => res.writeHead(302, { location: `${b.origin}/x` }).end());
    const r = await httpRequest({
      url: a.origin,
      maxRedirects: 3,
      timeoutMs: 500,
      maxBytes: 1e4,
    });
    expect(r.status).toBe(302);
    expect(r.redirects).toBe(0);
    expect(r.url).toBe(`${a.origin}/`);
    expect(hitsOnB).toBe(0);
  });

  test('never follows to the same host on another port or another scheme', async () => {
    const { origin } = await serve((_req, res) =>
      res.writeHead(302, { location: 'http://127.0.0.1:1/x' }).end(),
    );
    const port = await httpRequest({ url: origin, maxRedirects: 3, timeoutMs: 500, maxBytes: 1e4 });
    expect(port.status).toBe(302);
    expect(port.redirects).toBe(0);

    const { origin: o2 } = await serve((_req, res) =>
      res.writeHead(302, { location: 'https://127.0.0.1/x' }).end(),
    );
    const scheme = await httpRequest({ url: o2, maxRedirects: 3, timeoutMs: 500, maxBytes: 1e4 });
    expect(scheme.status).toBe(302);
    expect(scheme.redirects).toBe(0);
  });

  test('never follows a redirect with embedded credentials or an unparsable target', async () => {
    const { origin } = await serve((req, res) => {
      const loc = req.url === '/cred' ? origin.replace('//', '//u:p@') : 'http://[bad';
      res.writeHead(302, { location: loc }).end();
    });
    for (const p of ['/cred', '/bad']) {
      const r = await httpRequest({
        url: `${origin}${p}`,
        maxRedirects: 3,
        timeoutMs: 500,
        maxBytes: 1e4,
      });
      expect(r.status).toBe(302);
      expect(r.redirects).toBe(0);
    }
  });

  test('never follows any redirect with a credential header', async () => {
    let hits = 0;
    const { origin } = await serve((req, res) => {
      hits += 1;
      redirectChain(req, res);
    });
    for (const name of ['X-Api-Key', 'authorization', 'Cookie', 'x-anything']) {
      hits = 0;
      const r = await httpRequest({
        url: `${origin}/hop1`,
        maxRedirects: 3,
        headers: { [name]: 'k' },
        timeoutMs: 500,
        maxBytes: 1e4,
      });
      expect(r.redirects).toBe(0);
      expect(r.status).toBe(302);
      expect(hits).toBe(1);
    }
  });

  test('a redirect response without a location is returned as-is', async () => {
    const { origin } = await serve((_req, res) => res.writeHead(304).end());
    const r = await httpRequest({ url: origin, maxRedirects: 3, timeoutMs: 500, maxBytes: 1e4 });
    expect(r.status).toBe(304);
    expect(r.redirects).toBe(0);
  });
});

describe('httpRequest edge cases', () => {
  test('a followed redirect with a large declared body does not trip the cap', async () => {
    const { origin } = await serve((req, res) => {
      if (req.url === '/a')
        res.writeHead(302, { location: '/b', 'content-length': '99999' }).end('x');
      else res.end('ok');
    });
    const r = await httpRequest({
      url: `${origin}/a`,
      maxRedirects: 1,
      timeoutMs: 500,
      maxBytes: 100,
    });
    expect(r.status).toBe(200);
  });

  test('a connection dropped mid-body rejects', async () => {
    const { origin } = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': '100' });
      res.write('abc');
      setTimeout(() => res.destroy(), 20);
    });
    await expect(httpRequest({ url: origin, timeoutMs: 1000, maxBytes: 1000 })).rejects.toThrow();
  });
});

describe('httpRequest followVirtualHost (R11)', () => {
  const VHOST = 'app.example.invalid';
  // A Traefik stand-in: the app redirects to its own public address, which only the Host
  // header reaches.
  function traefik(seen: { host?: string; url: string }[]): Handler {
    return (req, res) => {
      seen.push({ host: req.headers.host, url: req.url ?? '' });
      if (req.url === '/')
        res.writeHead(302, { location: `https://${VHOST}/login?next=%2F` }).end();
      else res.writeHead(200, { 'x-frame-options': 'DENY' }).end('login page');
    };
  }
  const base = { timeoutMs: 500, maxBytes: 1e4, maxRedirects: 3, followVirtualHost: true } as const;

  test('follows a redirect to the virtual host through the original origin', async () => {
    const seen: { host?: string; url: string }[] = [];
    const { origin } = await serve(traefik(seen));
    const r = await httpRequest({ url: origin, hostHeader: VHOST, ...base });
    expect(r.status).toBe(200);
    expect(r.redirects).toBe(1);
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.url).toBe(`${origin}/login?next=%2F`);
    expect(seen).toEqual([
      { host: VHOST, url: '/' },
      { host: VHOST, url: '/login?next=%2F' },
    ]);
  });

  test('matches the hostname case-insensitively, ignoring a trailing dot, any scheme and port', async () => {
    for (const location of [
      'http://APP.Example.Invalid./login',
      `https://${VHOST}:8443/login`,
      `http://${VHOST}:81/login`,
    ]) {
      const seen: { host?: string; url: string }[] = [];
      const { origin } = await serve((req, res) => {
        seen.push({ host: req.headers.host, url: req.url ?? '' });
        if (req.url === '/') res.writeHead(302, { location }).end();
        else res.end('ok');
      });
      const r = await httpRequest({ url: origin, hostHeader: `${VHOST}:443`, ...base });
      expect(r.status).toBe(200);
      expect(r.url).toBe(`${origin}/login`);
      expect(seen.map((x) => x.host)).toEqual([`${VHOST}:443`, `${VHOST}:443`]);
    }
  });

  test('counts virtual host hops against maxRedirects', async () => {
    const { origin } = await serve((_req, res) =>
      res.writeHead(302, { location: `https://${VHOST}/again` }).end(),
    );
    const r = await httpRequest({ url: origin, hostHeader: VHOST, ...base });
    expect(r.redirects).toBe(3);
    expect(r.status).toBe(302);
  });

  test('does not follow a redirect to a different hostname', async () => {
    let hitsOnOther = 0;
    const other = await serve((_req, res) => {
      hitsOnOther += 1;
      res.end('leak');
    });
    const seen: string[] = [];
    for (const location of [`${other.origin}/x`, 'https://other.example.invalid/x']) {
      seen.length = 0;
      const { origin: o } = await serve((req, res) => {
        seen.push(req.url ?? '');
        res.writeHead(302, { location }).end();
      });
      const r = await httpRequest({ url: o, hostHeader: VHOST, ...base });
      expect(r.status).toBe(302);
      expect(r.redirects).toBe(0);
      expect(seen).toEqual(['/']);
    }
    expect(hitsOnOther).toBe(0);
  });

  test('does not follow a virtual host redirect when a credential header is set', async () => {
    const seen: { host?: string; url: string }[] = [];
    const { origin } = await serve(traefik(seen));
    const r = await httpRequest({
      url: origin,
      hostHeader: VHOST,
      headers: { authorization: 'Bearer k' },
      ...base,
    });
    expect(r.status).toBe(302);
    expect(r.redirects).toBe(0);
    expect(seen).toHaveLength(1);
  });

  test('is off unless asked for, and needs a Host header', async () => {
    const seen: { host?: string; url: string }[] = [];
    const { origin } = await serve(traefik(seen));
    const off = await httpRequest({
      url: origin,
      hostHeader: VHOST,
      timeoutMs: 500,
      maxBytes: 1e4,
      maxRedirects: 3,
    });
    expect(off.status).toBe(302);
    const noHost = await httpRequest({ url: origin, ...base });
    expect(noHost.status).toBe(302);
    expect(seen).toHaveLength(2);
  });

  test('never follows for POST', async () => {
    const seen: string[] = [];
    const { origin } = await serve((req, res) => {
      seen.push(req.url ?? '');
      res.writeHead(302, { location: `https://${VHOST}/next` }).end();
      req.resume();
    });
    const r = await httpRequest({
      url: origin,
      method: 'POST',
      allowPost: true,
      body: 'x',
      hostHeader: VHOST,
      ...base,
    });
    expect(r.status).toBe(302);
    expect(seen).toEqual(['/']);
  });

  test('a protocol-relative path cannot move the request off the origin', async () => {
    const seen: string[] = [];
    const { origin } = await serve((req, res) => {
      seen.push(req.url ?? '');
      if (req.url === '/')
        res.writeHead(302, { location: `https://${VHOST}//evil.example.invalid/x` }).end();
      else res.end('ok');
    });
    const r = await httpRequest({ url: origin, hostHeader: VHOST, ...base });
    expect(r.status).toBe(200);
    expect(r.url.startsWith(origin)).toBe(true);
    expect(seen).toEqual(['/', '//evil.example.invalid/x']);
  });

  test('relative redirects still work', async () => {
    const { origin } = await serve(redirectChain);
    const r = await httpRequest({ url: `${origin}/hop1`, hostHeader: VHOST, ...base });
    expect(r.status).toBe(200);
    expect(r.redirects).toBe(2);
  });
});

describe('httpRequest truncate', () => {
  test('returns the first bytes and stops reading when the body is over the cap', async () => {
    let closed!: () => void;
    const closedP = new Promise<void>((r) => (closed = r));
    const { origin } = await serve((_req, res) => {
      res.writeHead(200, { 'x-frame-options': 'DENY', 'content-length': '100000' });
      res.write(Buffer.alloc(600, 97));
      res.write(Buffer.alloc(600, 98));
      res.on('close', closed);
    });
    const r = await httpRequest({ url: origin, timeoutMs: 1000, maxBytes: 1000, truncate: true });
    expect(r.status).toBe(200);
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.body.length).toBe(1000);
    await closedP;
  });

  test('a small body is returned whole', async () => {
    const { origin } = await serve((_req, res) => res.end('tiny'));
    const r = await httpRequest({ url: origin, timeoutMs: 1000, maxBytes: 1000, truncate: true });
    expect(r.body.toString()).toBe('tiny');
  });
});
