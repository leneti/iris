import { adapter } from '@/lib/server/integrations/radarr';
import { KEY, codeOf, envWith, fixture, harness } from '../../helpers/adapter';

const ROUTE = '/api/v3/movie';
const open: Awaited<ReturnType<typeof harness>>[] = [];
const start = async (routes: Parameters<typeof harness>[1]) => {
  const h = await harness(adapter, routes);
  open.push(h);
  return h;
};
afterEach(() => Promise.all(open.splice(0).map((h) => h.close())));

describe('radarr adapter', () => {
  test('wanted is monitored, no file and available; missing drops the availability test', async () => {
    const h = await start({ [ROUTE]: fixture('radarr/movie.json') });
    expect(await adapter.fetch(h.ctx)).toEqual({ wanted: 14, movies: 1482, missing: 20 });
    expect(h.seen[0]!.url).toBe(ROUTE);
    expect(h.seen[0]!.headers['x-api-key']).toBe(KEY);
  });

  test('fields and labels', () => {
    expect(adapter.defaultFields).toEqual(['wanted', 'movies']);
    expect(adapter.extraFields).toEqual(['missing']);
    expect(adapter.labels).toMatchObject({ wanted: 'Wanted', movies: 'Movies' });
  });

  test('an empty key is not configured', () => {
    expect(adapter.credentials(envWith('IRIS_RADARR_KEY', ''))).toBeNull();
    expect(adapter.credentials(envWith('IRIS_RADARR_KEY', KEY))).toEqual({ key: KEY });
  });

  test.each(['nope', '{"movies":[]}', '[{"monitored":"yes"}]'])(
    'a malformed reply (%s) is unreachable',
    async (body) => {
      const h = await start({ [ROUTE]: body });
      expect(await codeOf(adapter.fetch(h.ctx))).toBe('unreachable');
    },
  );

  test('a list over 32 MiB is unreachable, not a crash (Review Focus 3)', async () => {
    const big = Buffer.alloc(33 * 1024 * 1024, 0x20);
    big.write('[]');
    const h = await start({ [ROUTE]: big });
    expect(await codeOf(adapter.fetch(h.ctx))).toBe('unreachable');
  });

  test('a list under the cap but over the default 8 MiB is read', async () => {
    const pad = Buffer.alloc(9 * 1024 * 1024, 0x20).toString();
    const h = await start({
      [ROUTE]: `[{"monitored":true,"hasFile":false,"isAvailable":true}]${pad}`,
    });
    expect(await adapter.fetch(h.ctx)).toMatchObject({ wanted: 1, movies: 1 });
  });
});
