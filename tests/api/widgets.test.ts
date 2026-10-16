import { globSync, readFileSync } from 'node:fs';
import { WidgetsResponse } from '@/lib/shared/contract';
import { defaultDashboardConfig } from '@/lib/server/config/dashboard';
import { stateWith } from '../helpers/widgets';

const KEY = 'radarr-key-5d2e8a41c7b3f960';

vi.mock('@/lib/server/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  registerSecret: vi.fn(),
}));
vi.mock('@/lib/server/config/services', () => ({
  getConfigWatcher: () => ({
    get: () => ({ dashboard: { config: defaultDashboardConfig(), warnings: [] } }),
  }),
}));

beforeEach(() => {
  vi.resetModules();
  globalThis.__iris = undefined;
  vi.stubEnv('DASHBOARD_RADARR_KEY', KEY);
  vi.stubEnv('DASHBOARD_TRAEFIK_URL', 'http://traefik.example.invalid');
});
afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.__iris = undefined;
});

test('exports: nodejs, dynamic, GET only, no request input', async () => {
  const route = await import('@/app/api/widgets/route');
  expect(route.runtime).toBe('nodejs');
  expect(route.dynamic).toBe('force-dynamic');
  expect(route.GET.length).toBe(0);
  expect(Object.keys(route).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
});

test('before discovery: an empty, valid, uncached response', async () => {
  const { GET } = await import('@/app/api/widgets/route');
  const res = await GET();
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = WidgetsResponse.parse(await res.json());
  expect(body.services).toEqual({});
  expect(body.standalone).toEqual([]);
  expect(body.weather).toBeNull();
});

test('serves registered adapters through the cache, without the key', async () => {
  const registry = await import('@/lib/server/integrations/registry');
  let loads = 0;
  registry.registerAdapter({
    type: 'radarr',
    defaultFields: ['wanted'],
    extraFields: [],
    labels: { wanted: 'Wanted' },
    credentials: (env) => (env.radarrKey === undefined ? null : { key: env.radarrKey }),
    fetch: async (ctx) => {
      loads += 1;
      if (loads === 99) throw new Error(ctx.creds.key);
      return { wanted: 14 };
    },
  });
  const { getState } = await import('@/lib/server/state');
  globalThis.__iris = stateWith([{ id: 'radarr', type: 'radarr' }]);
  expect(getState().discovery).not.toBeNull();

  const { GET } = await import('@/app/api/widgets/route');
  const [a, b] = await Promise.all([GET(), GET()]);
  const text = await a.text();
  expect(text).not.toContain(KEY);
  expect(await b.text()).not.toContain(KEY);
  expect(loads).toBe(1);
  const body = WidgetsResponse.parse(JSON.parse(text));
  expect(body.services.radarr!.stats).toEqual([
    { key: 'wanted', label: 'Wanted', value: 14, unit: null },
  ]);
});

test('with the variable empty the service reports not-configured and nothing is fetched', async () => {
  vi.stubEnv('DASHBOARD_RADARR_KEY', '');
  const registry = await import('@/lib/server/integrations/registry');
  const fetchSpy = vi.fn(async () => ({}));
  registry.registerAdapter({
    type: 'radarr',
    defaultFields: [],
    extraFields: [],
    labels: {},
    credentials: (env) => (env.radarrKey === undefined ? null : { key: env.radarrKey }),
    fetch: fetchSpy,
  });
  globalThis.__iris = stateWith([{ id: 'radarr', type: 'radarr' }]);
  const { GET } = await import('@/app/api/widgets/route');
  const body = WidgetsResponse.parse(await (await GET()).json());
  expect(body.services.radarr).toEqual({
    type: 'radarr',
    state: 'not-configured',
    fetchedAt: null,
    stats: [],
  });
  expect(fetchSpy).not.toHaveBeenCalled();
});

// Criterion 11.8: no dashboard endpoint passes request input to an outgoing request.
describe('route handlers and request input (criterion 11.8)', () => {
  const ICONS = 'app/api/icons/[...slug]/route.ts';
  const routes = globSync('app/api/**/route.ts');

  test('the glob finds the routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(8);
    expect(routes).toContain(ICONS);
    expect(routes).toContain('app/api/widgets/route.ts');
  });

  test('no route handler passes request input to an outgoing request', () => {
    for (const f of routes.filter((r) => r !== ICONS))
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/searchParams|request\.url|params\)/);
  });

  test('the icons route reads params for the slug only, and reaches the store after the check', () => {
    const src = readFileSync(ICONS, 'utf8');
    expect(src).not.toMatch(/searchParams|request\.url|req\.url|headers\.get/);
    expect(src.match(/\bparams\b/g)?.length).toBe(2); // the type and the one read
    const get = (re: RegExp) => src.search(re);
    expect(get(/SLUG\.test\(name\)/)).toBeGreaterThan(-1);
    expect(get(/LOCAL_FILE\.test\(name\)/)).toBeGreaterThan(-1);
    // Every call into the store sits in a branch that tested the name first.
    for (const m of src.matchAll(/getIconStore\(\)\.get\(/g)) {
      const before = src.slice(0, m.index);
      expect(before.slice(before.lastIndexOf('if ('))).toMatch(/(SLUG|LOCAL_FILE)\.test\(name\)/);
    }
    // Ruling R25, tightened after the final review: the `di` branch also asks the allowlist of
    // slugs the current discovery result references, so the slug is not just well formed.
    expect(src).toMatch(/kind === 'di'\s*&&\s*SLUG\.test\(name\)\s*&&\s*isReferencedSlug\(name\)/);
    expect(src).toMatch(/import \{ isReferencedSlug \} from '@\/lib\/server\/icons\/referenced'/);
    // The patterns live in resolve.ts only.
    expect(src).toMatch(/import \{ LOCAL_FILE, SLUG \} from '@\/lib\/server\/icons\/resolve'/);
    expect(src).not.toMatch(/(?:const|let)\s+(SLUG|LOCAL_FILE)\b/);
    expect(src).not.toMatch(/httpRequest|fetch\(/);
  });

  // Ruling R25. The regex above is not enough: `req.url`, `req.nextUrl`, `request.headers`,
  // `request.json()` and a request parameter of any other name get past it. A handler that
  // declares no parameter cannot read the request at all, and `next/headers` is the other way in.
  test('every exported handler takes no parameters (the request is unreachable)', () => {
    for (const f of routes.filter((r) => r !== ICONS)) {
      const src = readFileSync(f, 'utf8');
      const exported = [
        ...src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g),
      ];
      const handlers = exported.filter(([, name]) =>
        /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name!),
      );
      expect(handlers.length, `${f} exports a handler`).toBeGreaterThan(0);
      for (const [, name, params] of handlers) expect(params!.trim(), `${f} ${name}`).toBe('');
      // No other way to export a handler: a const or a re-export could take a request.
      expect(src, f).not.toMatch(
        /export\s+(?:const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/,
      );
    }
  });

  test('the icons handler is the only one with a parameter, and it uses the context for the slug', () => {
    const src = readFileSync(ICONS, 'utf8');
    expect(src).toMatch(
      /export async function GET\(_req: Request, ctx: \{ params: Promise<\{ slug: string\[\] \}> \}\)/,
    );
    expect(src).not.toMatch(/\b_req\b[.[]/);
    expect(src.match(/\bctx\b/g)?.length).toBe(2); // the declaration and `await ctx.params`
  });

  test('no route imports next/headers, next/server request helpers, or an outgoing-request module', () => {
    for (const f of routes) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from\s+['"]next\/headers['"]|\bcookies\(|\bheaders\(\)/);
      expect(src, f).not.toMatch(
        /\bnextUrl\b|\bNextRequest\b|\.json\(\)|\.formData\(\)|\.text\(\)/,
      );
      expect(src, f).not.toMatch(/lib\/server\/http['"]|integrations\/fetcher['"]/);
    }
  });
});
