import { readFileSync } from 'node:fs';
import { StreamsResponse } from '@/lib/shared/contract';
import { httpRequest } from '@/lib/server/http';

vi.mock('@/lib/server/http', () => ({ httpRequest: vi.fn() }));

const KEY = 'test-key-7f3a91c2d4e8b605';
let showUsers = true;
vi.mock('@/lib/server/config/services', () => ({
  getConfigWatcher: () => ({
    get: () => ({
      iris: {
        config: { streams: { url: 'http://tautulli.example.invalid:8181', showUsers } },
      },
    }),
  }),
}));

const fixture = readFileSync(new URL('../fixtures/tautulli/activity.json', import.meta.url));

beforeEach(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.resetModules();
  showUsers = true;
  vi.stubEnv('IRIS_TAUTULLI_KEY', KEY);
  vi.mocked(httpRequest).mockReset();
  vi.mocked(httpRequest).mockResolvedValue({
    status: 200,
    headers: {},
    body: fixture,
    url: '',
    redirects: 0,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('exports: nodejs, dynamic, GET only, no request input', async () => {
  const route = await import('@/app/api/streams/route');
  expect(route.runtime).toBe('nodejs');
  expect(route.dynamic).toBe('force-dynamic');
  expect(route.GET.length).toBe(0);
  expect(Object.keys(route).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
});

test('serves a contract-valid, uncached response without the key', async () => {
  const { GET } = await import('@/app/api/streams/route');
  const res = await GET();
  expect(res.headers.get('cache-control')).toBe('no-store');
  const text = await res.text();
  expect(text).not.toContain(KEY);
  const body = StreamsResponse.parse(JSON.parse(text));
  expect(body.streamCount).toBe(2);
  expect(body.sessions[0]!.user).toBe('alex');
});

test('showUsers false hides the names', async () => {
  showUsers = false;
  const { GET } = await import('@/app/api/streams/route');
  const body = StreamsResponse.parse(await (await GET()).json());
  expect(body.sessions.map((s) => s.user)).toEqual([null, null]);
});

test('empty key: not-configured and Tautulli is not called', async () => {
  vi.stubEnv('IRIS_TAUTULLI_KEY', '');
  const { GET } = await import('@/app/api/streams/route');
  const body = StreamsResponse.parse(await (await GET()).json());
  expect(body.source.state).toBe('not-configured');
  expect(httpRequest).not.toHaveBeenCalled();
});

test('unauthorized key is reported', async () => {
  vi.mocked(httpRequest).mockResolvedValue({
    status: 401,
    headers: {},
    body: Buffer.from(''),
    url: '',
    redirects: 0,
  });
  const { GET } = await import('@/app/api/streams/route');
  expect(StreamsResponse.parse(await (await GET()).json()).source.state).toBe('unauthorized');
});
