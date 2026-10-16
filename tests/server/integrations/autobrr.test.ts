import { adapter } from '@/lib/server/integrations/autobrr';
import { KEY, codeOf, envWith, fixture, harness } from '../../helpers/adapter';

const ROUTE = '/api/release/stats';
const open: Awaited<ReturnType<typeof harness>>[] = [];
const start = async (routes: Parameters<typeof harness>[1]) => {
  const h = await harness(adapter, routes);
  open.push(h);
  return h;
};
afterEach(() => Promise.all(open.splice(0).map((h) => h.close())));

describe('autobrr adapter', () => {
  test('reads approved and rejected pushes with X-API-Token', async () => {
    const h = await start({ [ROUTE]: fixture('autobrr/release-stats.json') });
    expect(await adapter.fetch(h.ctx)).toEqual({
      approvedPushes: 42,
      rejectedPushes: 317,
      filtered: 1171,
    });
    expect(h.seen[0]!.url).toBe(ROUTE);
    expect(h.seen[0]!.headers['x-api-token']).toBe(KEY);
    expect(h.seen[0]!.headers['x-api-key']).toBeUndefined();
  });

  test('fields and labels', () => {
    expect(adapter.defaultFields).toEqual(['approvedPushes', 'rejectedPushes']);
    expect(adapter.extraFields).toEqual(['filtered']);
    expect(adapter.labels).toMatchObject({
      approvedPushes: 'Approved',
      rejectedPushes: 'Rejected',
    });
  });

  test('an empty key is not configured', () => {
    expect(adapter.credentials(envWith('DASHBOARD_AUTOBRR_KEY', ''))).toBeNull();
    expect(adapter.credentials(envWith('DASHBOARD_AUTOBRR_KEY', KEY))).toEqual({ key: KEY });
  });

  test.each([
    'nope',
    '{"push_approved_count":"1","push_rejected_count":2}',
    '{"push_approved_count":1}',
  ])('a malformed reply (%s) is unreachable', async (body) => {
    const h = await start({ [ROUTE]: body });
    expect(await codeOf(adapter.fetch(h.ctx))).toBe('unreachable');
  });

  test('403 is unauthorized', async () => {
    const h = await start({ [ROUTE]: { status: 403 } });
    expect(await codeOf(adapter.fetch(h.ctx))).toBe('unauthorized');
  });
});
