import { resetShared } from '../reset-shared';

describe('shared', () => {
  test('builds the value once per key and returns the same one after', async () => {
    const { shared } = await import('@/lib/server/shared');
    const init = vi.fn(() => ({ n: 1 }));
    const a = shared('test:once', init);
    expect(shared('test:once', init)).toBe(a);
    expect(init).toHaveBeenCalledTimes(1);
    expect(shared('test:other', () => ({ n: 2 }))).not.toBe(a);
  });

  test('a module re-imported in another bundle sees the same instance', async () => {
    const first = (await import('@/lib/server/shared')).shared('test:bundle', () => new Map());
    vi.resetModules();
    const second = (await import('@/lib/server/shared')).shared('test:bundle', () => new Map());
    expect(second).toBe(first);
  });

  test('the TTL caches of the page and the route are one cache', async () => {
    const first = await import('@/lib/server/cron/response');
    expect(first).toBeDefined();
    const before = globalThis.__irisShared?.get('cron:cache');
    expect(before).toBeDefined();
    vi.resetModules();
    await import('@/lib/server/cron/response');
    expect(globalThis.__irisShared?.get('cron:cache')).toBe(before);
  });

  test('resetShared starts over', async () => {
    const { shared } = await import('@/lib/server/shared');
    const a = shared('test:reset', () => ({}));
    resetShared();
    expect(shared('test:reset', () => ({}))).not.toBe(a);
  });
});
