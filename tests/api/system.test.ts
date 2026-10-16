import { readFileSync } from 'node:fs';
import { SystemResponse } from '@/lib/shared/contract';
import { httpRequest } from '@/lib/server/http';

vi.mock('@/lib/server/http', () => ({ httpRequest: vi.fn() }));
vi.mock('@/lib/server/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  registerSecret: vi.fn(),
}));
vi.mock('@/lib/server/config/services', () => ({
  getConfigWatcher: () => ({
    get: () => ({
      dashboard: {
        config: {
          system: {
            url: 'http://glances.example.invalid:61208',
            interface: 'auto',
            sensor: 'auto',
            disks: [{ mount: '/example/media', label: 'Media disk' }],
            thresholds: { warn: 80, bad: 90 },
          },
        },
      },
    }),
  }),
}));

const fx = (n: string) => readFileSync(new URL(`../fixtures/glances/${n}.json`, import.meta.url));

beforeEach(() => {
  vi.resetModules();
  vi.mocked(httpRequest).mockReset();
  vi.mocked(httpRequest).mockImplementation(async (o) => ({
    status: 200,
    headers: {},
    body: fx(o.url.split('/api/4/')[1]!),
    url: o.url,
    redirects: 0,
  }));
});

test('exports: nodejs, dynamic, GET only, no request input', async () => {
  const route = await import('@/app/api/system/route');
  expect(route.runtime).toBe('nodejs');
  expect(route.dynamic).toBe('force-dynamic');
  expect(route.GET.length).toBe(0);
  expect(Object.keys(route).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
});

test('serves a contract-valid, uncached response', async () => {
  const { GET } = await import('@/app/api/system/route');
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = SystemResponse.parse(await res.json());
  expect(body.source.state).toBe('ok');
  expect(body.disks.map((d) => d.label)).toEqual(['Media disk']);
});

test('Glances unreachable still answers 200 with state unreachable', async () => {
  vi.mocked(httpRequest).mockRejectedValue(new Error('down'));
  const { GET } = await import('@/app/api/system/route');
  const res = await GET();
  expect(res.status).toBe(200);
  expect(SystemResponse.parse(await res.json()).source.state).toBe('unreachable');
});
