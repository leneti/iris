import { adapter } from '@/lib/server/integrations/prowlarr';
import { KEY, codeOf, envWith, fixture, harness } from '../../helpers/adapter';

const ROUTE = '/api/v1/indexerstats';
const open: Awaited<ReturnType<typeof harness>>[] = [];
const start = async (routes: Parameters<typeof harness>[1]) => {
  const h = await harness(adapter, routes);
  open.push(h);
  return h;
};
afterEach(() => Promise.all(open.splice(0).map((h) => h.close())));

describe('prowlarr adapter', () => {
  test('sums over indexers, with X-Api-Key', async () => {
    const h = await start({ [ROUTE]: fixture('prowlarr/indexerstats.json') });
    expect(await adapter.fetch(h.ctx)).toEqual({
      numberOfGrabs: 318,
      numberOfQueries: 9204,
      failedGrabs: 4,
      failedQueries: 20,
    });
    expect(h.seen[0]!.url).toBe(ROUTE);
    expect(h.seen[0]!.headers['x-api-key']).toBe(KEY);
  });

  test('no indexers sums to zero', async () => {
    const h = await start({ [ROUTE]: '{"indexers":[]}' });
    expect(await adapter.fetch(h.ctx)).toMatchObject({ numberOfGrabs: 0, numberOfQueries: 0 });
  });

  test('fields and labels', () => {
    expect(adapter.defaultFields).toEqual(['numberOfGrabs', 'numberOfQueries']);
    expect(adapter.extraFields).toEqual(['failedGrabs', 'failedQueries']);
    expect(adapter.labels).toMatchObject({ numberOfGrabs: 'Grabs', numberOfQueries: 'Queries' });
  });

  test('an empty key is not configured', () => {
    expect(adapter.credentials(envWith('DASHBOARD_PROWLARR_KEY', ''))).toBeNull();
    expect(adapter.credentials(envWith('DASHBOARD_PROWLARR_KEY', KEY))).toEqual({ key: KEY });
  });

  test.each(['nope', '[]', '{"indexers":"x"}', '{"indexers":[{"numberOfGrabs":"5"}]}'])(
    'a malformed reply (%s) is unreachable',
    async (body) => {
      const h = await start({ [ROUTE]: body });
      expect(await codeOf(adapter.fetch(h.ctx))).toBe('unreachable');
    },
  );
});
