import { adapter } from '@/lib/server/integrations/sonarr';
import { KEY, codeOf, envWith, fixture, harness } from '../../helpers/adapter';

const WANTED = '/api/v3/wanted/missing?page=1&pageSize=1';
const SERIES = '/api/v3/series';
const open: Awaited<ReturnType<typeof harness>>[] = [];
const start = async (routes: Parameters<typeof harness>[1]) => {
  const h = await harness(adapter, routes);
  open.push(h);
  return h;
};
afterEach(() => Promise.all(open.splice(0).map((h) => h.close())));

describe('sonarr adapter', () => {
  test('wanted is totalRecords, series is the list length, both with X-Api-Key', async () => {
    const h = await start({
      [WANTED]: fixture('sonarr/wanted-missing.json'),
      [SERIES]: fixture('sonarr/series.json'),
    });
    expect(await adapter.fetch(h.ctx)).toEqual({ wanted: 9, series: 37 });
    expect(h.seen.map((s) => s.url).sort()).toEqual([SERIES, WANTED].sort());
    for (const s of h.seen) expect(s.headers['x-api-key']).toBe(KEY);
  });

  test('the series list goes through its own cache key (ctx.cached "series", 300 s)', async () => {
    const h = await start({ [WANTED]: fixture('sonarr/wanted-missing.json'), [SERIES]: '[{},{}]' });
    const spy = vi.fn(h.ctx.cached);
    const cached = spy as unknown as typeof h.ctx.cached;
    await adapter.fetch({ ...h.ctx, cached });
    expect(spy).toHaveBeenCalledWith('series', 300_000, expect.any(Function));
    await adapter.fetch({ ...h.ctx, cached });
    // The harness memoizes by key, so the second fetch re-reads only the wanted count.
    expect(h.seen.filter((s) => s.url === SERIES)).toHaveLength(1);
    expect(h.seen.filter((s) => s.url === WANTED)).toHaveLength(2);
  });

  test('fields and labels', () => {
    expect(adapter.defaultFields).toEqual(['wanted', 'series']);
    expect(adapter.labels).toEqual({ wanted: 'Wanted', series: 'Series' });
  });

  test('an empty key is not configured', () => {
    expect(adapter.credentials(envWith('DASHBOARD_SONARR_KEY', ''))).toBeNull();
    expect(adapter.credentials(envWith('DASHBOARD_SONARR_KEY', KEY))).toEqual({ key: KEY });
  });

  test.each([
    ['wanted is not json', 'nope', '[]'],
    ['wanted has no totalRecords', '{"records":[]}', '[]'],
    ['series is not a list', fixture('sonarr/wanted-missing.json'), '{"a":1}'],
  ])('a malformed reply (%s) is unreachable', async (_n, wanted, series) => {
    const h = await start({ [WANTED]: wanted, [SERIES]: series });
    expect(await codeOf(adapter.fetch(h.ctx))).toBe('unreachable');
  });

  test('a series list over 32 MiB is unreachable', async () => {
    const big = Buffer.alloc(33 * 1024 * 1024, 0x20);
    big.write('[]');
    const h = await start({ [WANTED]: fixture('sonarr/wanted-missing.json'), [SERIES]: big });
    expect(await codeOf(adapter.fetch(h.ctx))).toBe('unreachable');
  });
});
