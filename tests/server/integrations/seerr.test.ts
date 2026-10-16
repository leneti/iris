import { adapter } from '@/lib/server/integrations/seerr';
import { KEY, codeOf, envWith, fixture, harness } from '../../helpers/adapter';

const ROUTE = '/api/v1/request/count';
const open: Awaited<ReturnType<typeof harness>>[] = [];
const start = async (routes: Parameters<typeof harness>[1]) => {
  const h = await harness(adapter, routes);
  open.push(h);
  return h;
};
afterEach(() => Promise.all(open.splice(0).map((h) => h.close())));

describe('seerr adapter', () => {
  test('reads pending and available, plus the free extras, with X-Api-Key', async () => {
    const h = await start({ [ROUTE]: fixture('seerr/request-count.json') });
    expect(await adapter.fetch(h.ctx)).toEqual({
      pending: 3,
      available: 208,
      approved: 12,
      processing: 5,
    });
    expect(h.seen[0]!.url).toBe(ROUTE);
    expect(h.seen[0]!.headers['x-api-key']).toBe(KEY);
  });

  test('fields and labels', () => {
    expect(adapter.defaultFields).toEqual(['pending', 'available']);
    expect(adapter.labels).toMatchObject({ pending: 'Pending', available: 'Available' });
  });

  test('an empty or missing key is not configured', () => {
    expect(adapter.credentials(envWith('DASHBOARD_SEERR_KEY', ''))).toBeNull();
    expect(adapter.credentials(envWith('DASHBOARD_SEERR_KEY', KEY))).toEqual({ key: KEY });
  });

  test.each(['not json', '{"pending":"3","available":1}', '[]', '{"pending":1}'])(
    'a malformed reply (%s) is unreachable',
    async (body) => {
      const h = await start({ [ROUTE]: body });
      expect(await codeOf(adapter.fetch(h.ctx))).toBe('unreachable');
    },
  );

  test('401 is unauthorized', async () => {
    const h = await start({ [ROUTE]: { status: 401 } });
    expect(await codeOf(adapter.fetch(h.ctx))).toBe('unauthorized');
  });
});
