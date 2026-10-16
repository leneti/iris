import { WidgetsResponse } from '@/lib/shared/contract';
import { defaultDashboardConfig } from '@/lib/server/config/dashboard';
import { loadEnv } from '@/lib/server/env';
import { httpRequest } from '@/lib/server/http';
import { createContext, type Adapter } from '@/lib/server/integrations/fetcher';
import { adapter } from '@/lib/server/integrations/cloudflared';
import { fixture, codeOf } from '../../helpers/adapter';
import { serve } from '../../helpers/external';
import { stateWith } from '../../helpers/widgets';

const logs = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/server/log', () => {
  const record = (message: string, fields?: unknown) =>
    logs.push(message + (fields === undefined ? '' : JSON.stringify(fields)));
  return { log: { info: record, warn: record, error: record }, registerSecret: vi.fn() };
});
vi.mock('@/lib/server/http', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/server/http')>();
  return { ...actual, httpRequest: vi.fn() };
});

const ACCOUNT = 'acct0123456789abcdef';
const TUNNEL = '11111111-2222-3333-4444-555555555555';
const TOKEN = 'cf-token-9e41b7c2d05a';
const PATH = `/client/v4/accounts/${ACCOUNT}/cfd_tunnel/${TUNNEL}`;
const env = loadEnv({
  DASHBOARD_CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  DASHBOARD_CLOUDFLARE_TUNNEL_ID: TUNNEL,
  DASHBOARD_CLOUDFLARE_TOKEN: TOKEN,
});
const T0 = new Date('2026-10-16T12:00:00.000Z').getTime();

const ctxFor = (creds: Record<string, string>) =>
  createContext({
    adapter,
    widget: { type: 'cloudflared', url: null, host: null, fields: null },
    creds,
    traefikUrl: undefined,
    cached: (_k, _t, load) => load(),
  });
const creds = () => adapter.credentials(env)!;
const withStatus = (status: unknown) => JSON.stringify({ result: { status } });

beforeEach(() => {
  logs.length = 0;
  vi.mocked(httpRequest).mockReset();
});

describe('cloudflared adapter', () => {
  test('fixed https origin and the ids are path credentials, never the token', () => {
    expect(adapter.baseUrl).toBe('https://api.cloudflare.com');
    expect(adapter.pathCreds).toEqual(['account', 'tunnel']);
  });

  test('reads result.status with the bearer token, from the fixed host', async () => {
    const calls = serve({ [PATH]: fixture('cloudflared/tunnel.json') });
    expect(await adapter.fetch(ctxFor(creds()))).toEqual({ status: 'healthy' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.cloudflare.com${PATH}`);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.url).not.toContain(TOKEN);
  });

  test.each(['healthy', 'degraded', 'down', 'inactive'])('status %s passes through', async (s) => {
    serve({ [PATH]: withStatus(s) });
    expect(await adapter.fetch(ctxFor(creds()))).toEqual({ status: s });
  });

  test.each([withStatus('exploding'), withStatus(3), '{"result":{}}', 'not json', '[]'])(
    'an unknown status or malformed reply (%s) is unreachable',
    async (body) => {
      serve({ [PATH]: body });
      expect(await codeOf(adapter.fetch(ctxFor(creds())))).toBe('unreachable');
    },
  );

  test('401 is unauthorized', async () => {
    serve({ [PATH]: { status: 401 } });
    expect(await codeOf(adapter.fetch(ctxFor(creds())))).toBe('unauthorized');
  });

  test('all three variables are needed; any empty one is not configured', () => {
    const e = (a: string, t: string, k: string) =>
      loadEnv({
        DASHBOARD_CLOUDFLARE_ACCOUNT_ID: a,
        DASHBOARD_CLOUDFLARE_TUNNEL_ID: t,
        DASHBOARD_CLOUDFLARE_TOKEN: k,
      });
    expect(adapter.credentials(e('', TUNNEL, TOKEN))).toBeNull();
    expect(adapter.credentials(e(ACCOUNT, '', TOKEN))).toBeNull();
    expect(adapter.credentials(e(ACCOUNT, TUNNEL, ''))).toBeNull();
    expect(adapter.credentials(e(ACCOUNT, TUNNEL, TOKEN))).toEqual({
      account: ACCOUNT,
      tunnel: TUNNEL,
      token: TOKEN,
    });
  });

  test.each(['a/b', '../x', 'a b', 'a?x=1', 'a%2fb', 'a.b', ''])(
    'an id %j that is not [A-Za-z0-9-]+ is unreachable and nothing is sent',
    async (bad) => {
      const calls = serve({});
      expect(await codeOf(adapter.fetch(ctxFor({ ...creds(), account: bad })))).toBe('unreachable');
      expect(await codeOf(adapter.fetch(ctxFor({ ...creds(), tunnel: bad })))).toBe('unreachable');
      expect(calls).toEqual([]);
    },
  );

  test('the token in a path would be refused by the fetcher (it is not a path credential)', async () => {
    const calls = serve({});
    const a: Adapter = { ...adapter, pathCreds: ['account', 'tunnel'] };
    const ctx = createContext({
      adapter: a,
      widget: null,
      creds: creds(),
      traefikUrl: undefined,
      cached: (_k, _t, load) => load(),
    });
    expect(await codeOf(ctx.get(`/x/${TOKEN}`))).toBe('unreachable');
    expect(calls).toEqual([]);
  });
});

describe('cloudflared through /api/widgets (criterion 11.7)', () => {
  const IPV4 = /\b\d{1,3}(\.\d{1,3}){3}\b/;
  // Colon-separated IPv6 groups: a full eight-group address, or any run containing "::" (a
  // timestamp such as 12:00:00 is not an address).
  const IPV6 = /(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|[0-9a-f:]*::[0-9a-f:]*/i;

  test('origin addresses are in neither the body nor any log call', async () => {
    vi.resetModules();
    const reg = await import('@/lib/server/integrations/registry');
    serve({ [PATH]: fixture('cloudflared/tunnel.json') });
    const state = stateWith([
      { id: 'cloudflared', type: 'radarr', url: 'http://x.example.invalid' },
    ]);
    const service = state.discovery!.groups.flatMap((g) => g.services)[0]!;
    service.widget = { type: 'cloudflared', url: null, host: null, fields: null };

    const res = await reg.getWidgets(state, defaultDashboardConfig(), env, T0);
    const body = JSON.stringify(WidgetsResponse.parse(res));
    expect(res.services.cloudflared).toMatchObject({
      type: 'cloudflared',
      state: 'ok',
      stats: [{ key: 'status', label: 'Tunnel status', value: 'healthy', unit: null }],
    });
    for (const text of [body, logs.join('\n')]) {
      expect(text).not.toContain('198.51.100.7');
      expect(text).not.toContain('2001:db8');
      expect(text).not.toMatch(IPV4);
      expect(text).not.toMatch(IPV6);
    }
    expect(body).not.toContain(TOKEN);
  });

  test('a failure logs no id, token or address', async () => {
    vi.resetModules();
    const reg = await import('@/lib/server/integrations/registry');
    serve({ [PATH]: { status: 500, body: 'origin 198.51.100.7' } });
    const state = stateWith([
      { id: 'cloudflared', type: 'radarr', url: 'http://x.example.invalid' },
    ]);
    state.discovery!.groups.flatMap((g) => g.services)[0]!.widget = {
      type: 'cloudflared',
      url: null,
      host: null,
      fields: null,
    };
    const res = await reg.getWidgets(state, defaultDashboardConfig(), env, T0);
    expect(res.services.cloudflared!.state).toBe('unreachable');
    const all = logs.join('\n') + JSON.stringify(res);
    for (const s of [ACCOUNT, TUNNEL, TOKEN, '198.51.100.7']) expect(all).not.toContain(s);
  });
});
