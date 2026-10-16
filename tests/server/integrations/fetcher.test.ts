import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpMethodError, HttpTimeoutError, HttpTooLargeError } from '@/lib/server/http';
import type { WidgetSpec } from '@/lib/server/discovery/discover';
import { IntegrationError, createContext, type Adapter } from '@/lib/server/integrations/fetcher';

vi.mock('@/lib/server/http', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/server/http')>();
  return { ...actual, httpRequest: vi.fn(actual.httpRequest) };
});
const { httpRequest } = await import('@/lib/server/http');
const realRequest = vi.mocked(httpRequest).getMockImplementation()!;

const CRED = 'cred-8d41f0a6e7b2c953';

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
type Upstream = { origin: string; seen: Seen[]; close(): Promise<void> };

async function upstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, seen: Seen) => void,
): Promise<Upstream> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const entry = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      seen.push(entry);
      handler(req, res, entry);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

const open: Upstream[] = [];
async function start(handler?: Parameters<typeof upstream>[0]) {
  const u = await upstream(handler ?? ((_req, res) => res.end('{"ok":true}')));
  open.push(u);
  return u;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((u) => u.close()));
  vi.mocked(httpRequest).mockReset();
  vi.mocked(httpRequest).mockImplementation(realRequest);
});

const adapter = (over: Partial<Adapter> = {}): Adapter => ({
  type: 'radarr',
  defaultFields: [],
  extraFields: [],
  labels: {},
  credentials: () => ({ key: CRED }),
  fetch: async () => ({}),
  ...over,
});
const spec = (over: Partial<WidgetSpec> = {}): WidgetSpec => ({
  type: 'radarr',
  url: null,
  host: null,
  fields: null,
  ...over,
});
const ctxFor = (a: Adapter, widget: WidgetSpec | null, traefikUrl?: string) =>
  createContext({
    adapter: a,
    widget,
    creds: { key: CRED },
    traefikUrl,
    cached: (_k, _t, load) => load(),
  });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(IntegrationError);
    return (err as IntegrationError).code;
  }
  throw new Error('expected a rejection');
};

describe('where a request goes', () => {
  test('widget.url: the credential is in the header only, never in the URL', async () => {
    const u = await start();
    const ctx = ctxFor(adapter(), spec({ url: u.origin }));
    const res = await ctx.get('/api/v3/movie?page=1', { headers: { 'X-Api-Key': CRED } });
    expect(res.status).toBe(200);
    expect(u.seen[0]!.url).toBe('/api/v3/movie?page=1');
    expect(u.seen[0]!.headers['x-api-key']).toBe(CRED);
    expect(JSON.stringify(vi.mocked(httpRequest).mock.calls[0]![0].url)).not.toContain(CRED);
  });

  test('widget.url with a path prefix keeps the prefix', async () => {
    const u = await start();
    await ctxFor(adapter(), spec({ url: `${u.origin}/radarr/` })).get('/api/v3/movie');
    expect(u.seen[0]!.url).toBe('/radarr/api/v3/movie');
  });

  test('Traefik: asks Traefik with the service host as Host header', async () => {
    const u = await start();
    await ctxFor(adapter(), spec({ host: 'radarr.example.invalid' }), u.origin).get('/ping');
    expect(u.seen[0]!.headers.host).toBe('radarr.example.invalid');
  });

  test('no widget.url and no Traefik: unreachable, nothing is sent', async () => {
    const ctx = ctxFor(adapter(), spec({ host: 'radarr.example.invalid' }), undefined);
    expect(await code(ctx.get('/ping'))).toBe('unreachable');
    expect(httpRequest).not.toHaveBeenCalled();
  });

  test('baseUrl replaces widget.url and Traefik (ruling R4)', async () => {
    vi.mocked(httpRequest).mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.from('{}'),
      url: '',
      redirects: 0,
    });
    const a = adapter({ type: 'cloudflared', baseUrl: 'https://api.example.invalid' });
    const ctx = ctxFor(a, spec({ url: 'http://other.example.invalid' }), 'http://traefik.invalid');
    await ctx.get('/client/v4/x', { headers: { Authorization: `Bearer ${CRED}` } });
    const call = vi.mocked(httpRequest).mock.calls[0]![0];
    expect(call.url).toBe('https://api.example.invalid/client/v4/x');
    expect(call.hostHeader).toBeUndefined();
  });

  test('a standalone adapter runs without a widget spec', async () => {
    vi.mocked(httpRequest).mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.from('{}'),
      url: '',
      redirects: 0,
    });
    const a = adapter({ type: 'coinmarketcap', baseUrl: 'https://pro-api.example.invalid' });
    const ctx = ctxFor(a, null);
    expect(ctx.widget).toBeNull();
    await ctx.get('/v1/x');
    expect(vi.mocked(httpRequest).mock.calls[0]![0].url).toBe(
      'https://pro-api.example.invalid/v1/x',
    );
  });

  test.each([
    '//evil.example/x',
    'https://evil.example/x',
    '/a b',
    '/a\\b',
    '/x#frag',
    'relative',
    '',
  ])('path %j is refused and nothing is sent', async (path) => {
    const u = await start();
    const ctx = ctxFor(adapter(), spec({ url: u.origin }));
    expect(await code(ctx.get(path))).toBe('unreachable');
    expect(u.seen).toEqual([]);
  });

  test('an adapter cannot set the Host header', async () => {
    const u = await start();
    await ctxFor(adapter(), spec({ url: u.origin })).get('/x', {
      headers: { Host: 'evil.example.invalid' },
    });
    expect(u.seen[0]!.headers.host).toBe(new URL(u.origin).host);
  });
});

describe('a credential is never put in a URL', () => {
  const SPECIAL = 'p/w d+1&x=é';
  const make = (a: Adapter, url: string) =>
    createContext({
      adapter: a,
      widget: spec({ url }),
      creds: { key: CRED, special: SPECIAL, account: 'acct-42', empty: '' },
      traefikUrl: undefined,
      cached: (_k, _t, load) => load(),
    });

  test.each([
    ['raw', `/api?apikey=${CRED}`],
    ['raw in the path', `/key/${CRED}/x`],
    ['percent-encoded', `/api?k=${encodeURIComponent(SPECIAL)}`],
  ])('%s: refused, and the upstream records zero requests', async (_name, path) => {
    const u = await start();
    expect(await code(make(adapter({ pathCreds: ['account'] }), u.origin).get(path))).toBe(
      'unreachable',
    );
    expect(u.seen).toEqual([]);
  });

  test('the raw form with special characters is refused too', async () => {
    const u = await start();
    expect(await code(make(adapter(), u.origin).get(`/api?k=${SPECIAL}`))).toBe('unreachable');
    expect(u.seen).toEqual([]);
  });

  test('a credential named in pathCreds may be in the path; an empty one never matches', async () => {
    const u = await start();
    const ctx = make(adapter({ pathCreds: ['account'] }), u.origin);
    await ctx.get('/accounts/acct-42/tunnel');
    expect(u.seen.map((s) => s.url)).toEqual(['/accounts/acct-42/tunnel']);
    expect(await code(make(adapter(), u.origin).get('/accounts/acct-42/tunnel'))).toBe(
      'unreachable',
    );
  });

  test('a credential in a header is fine, and the qBittorrent sign-in body is exempt', async () => {
    const u = await start();
    await make(adapter(), u.origin).get('/x', { headers: { 'x-api-key': CRED } });
    const q = make(adapter({ type: 'qbittorrent' }), u.origin);
    await q.post!('/api/v2/auth/login', `username=a&password=${CRED}`);
    expect(u.seen.map((s) => s.method)).toEqual(['GET', 'POST']);
  });
});

describe('status mapping', () => {
  const reply = (status: number) => async () => {
    const u = await start((_q, res) => {
      res.statusCode = status;
      res.end('upstream text that must not travel');
    });
    return ctxFor(adapter(), spec({ url: u.origin })).get('/x');
  };

  test.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate-limited'],
    [404, 'unreachable'],
    [500, 'unreachable'],
    [503, 'unreachable'],
  ])('%i gives %s', async (status, expected) => {
    expect(await code(reply(status)())).toBe(expected);
  });

  test('the error never carries upstream text', async () => {
    const err = await reply(500)().catch((e: unknown) => e);
    expect(String((err as Error).message)).not.toContain('upstream text');
  });

  test.each([
    ['timeout', new HttpTimeoutError(5000)],
    ['too large', new HttpTooLargeError(8)],
    [
      'connection refused',
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    ],
  ])('%s gives unreachable', async (_name, failure) => {
    vi.mocked(httpRequest).mockRejectedValue(failure);
    expect(await code(ctxFor(adapter(), spec({ url: 'http://x.example.invalid' })).get('/x'))).toBe(
      'unreachable',
    );
  });

  test('a body over the cap is unreachable (default 8 MiB, adapter may ask for more)', async () => {
    vi.mocked(httpRequest).mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.alloc(0),
      url: '',
      redirects: 0,
    });
    const ctx = ctxFor(adapter(), spec({ url: 'http://x.example.invalid' }));
    await ctx.get('/x');
    await ctx.get('/y', { maxBytes: 32 * 1024 * 1024 });
    expect(vi.mocked(httpRequest).mock.calls.map(([o]) => o.maxBytes)).toEqual([
      8 * 1024 * 1024,
      32 * 1024 * 1024,
    ]);
    expect(vi.mocked(httpRequest).mock.calls.every(([o]) => o.timeoutMs === 5000)).toBe(true);
  });

  test('a real oversized reply is unreachable', async () => {
    const u = await start((_q, res) => res.end(Buffer.alloc(64)));
    expect(await code(ctxFor(adapter(), spec({ url: u.origin })).get('/x', { maxBytes: 16 }))).toBe(
      'unreachable',
    );
  });

  test('a stalled upstream is unreachable, not a hang', async () => {
    const u = await start(() => {});
    vi.mocked(httpRequest).mockImplementation((o) => realRequest({ ...o, timeoutMs: 50 }));
    expect(await code(ctxFor(adapter(), spec({ url: u.origin })).get('/x'))).toBe('unreachable');
  });
});

describe('only GET, except the qBittorrent sign-in (criterion 11.4)', () => {
  test('there is no post on any adapter but qbittorrent', () => {
    expect(ctxFor(adapter({ type: 'radarr' }), spec()).post).toBeUndefined();
    expect(ctxFor(adapter({ type: 'cloudflared' }), null).post).toBeUndefined();
    expect(ctxFor(adapter({ type: 'qbittorrent' }), spec()).post).toBeTypeOf('function');
  });

  test('qbittorrent: any other POST path throws and nothing is sent', async () => {
    const u = await start();
    const ctx = ctxFor(adapter({ type: 'qbittorrent' }), spec({ url: u.origin }));
    for (const path of ['/api/v2/torrents/delete', '/api/v2/auth/logout', '/api/v2/auth/login/x'])
      await expect(ctx.post!(path, 'x=1')).rejects.toBeInstanceOf(HttpMethodError);
    expect(u.seen).toEqual([]);
  });

  test('qbittorrent: the sign-in carries the credentials in the body, not the URL', async () => {
    const u = await start((_q, res) => {
      res.setHeader('set-cookie', 'SID=abc; HttpOnly');
      res.end('Ok.');
    });
    const ctx = ctxFor(adapter({ type: 'qbittorrent' }), spec({ url: u.origin }));
    const res = await ctx.post!('/api/v2/auth/login', `username=a&password=${CRED}`);
    expect(res.headers['set-cookie']).toContain('SID=abc');
    const seen = u.seen[0]!;
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/api/v2/auth/login');
    expect(seen.body).toBe(`username=a&password=${CRED}`);
    expect(seen.headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  test('the fetcher never sends a method other than GET or POST to the helper', async () => {
    const u = await start();
    await ctxFor(adapter(), spec({ url: u.origin })).get('/x');
    expect(vi.mocked(httpRequest).mock.calls.map(([o]) => [o.method, o.allowPost])).toEqual([
      ['GET', false],
    ]);
  });
});

describe('a redirect never carries a credential (Review Focus 2)', () => {
  test('a 302 to another host is not followed and the other host sees nothing', async () => {
    const elsewhere = await start();
    const first = await start((_q, res) => {
      res.statusCode = 302;
      res.setHeader('location', `${elsewhere.origin}/steal`);
      res.end();
    });
    const ctx = ctxFor(adapter(), spec({ url: first.origin }));
    expect(await code(ctx.get('/x', { headers: { 'X-Api-Key': CRED } }))).toBe('unreachable');
    expect(first.seen).toHaveLength(1);
    expect(elsewhere.seen).toEqual([]);
  });

  test('a same-host redirect is not followed either while a credential header is present', async () => {
    const u = await start((q, res) => {
      if (q.url === '/x') {
        res.statusCode = 302;
        res.setHeader('location', '/y');
      }
      res.end();
    });
    const ctx = ctxFor(adapter(), spec({ url: u.origin }));
    expect(await code(ctx.get('/x', { headers: { 'X-Api-Key': CRED } }))).toBe('unreachable');
    expect(u.seen.map((s) => s.url)).toEqual(['/x']);
  });

  test('with no credential header, a redirect to another host is still not followed', async () => {
    const elsewhere = await start();
    const first = await start((_q, res) => {
      res.statusCode = 302;
      res.setHeader('location', `${elsewhere.origin}/x`);
      res.end();
    });
    expect(await code(ctxFor(adapter(), spec({ url: first.origin })).get('/x'))).toBe(
      'unreachable',
    );
    expect(elsewhere.seen).toEqual([]);
  });
});
