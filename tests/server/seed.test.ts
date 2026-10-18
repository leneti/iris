import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildSeed, SEED_BUDGET_MS } from '@/lib/server/seed';

const later = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('buildSeed', () => {
  test('carries the clock it was built at', async () => {
    const seed = await buildSeed(1234, { instant: {}, budgeted: {} });
    expect(seed).toEqual({ now: 1234, data: {} });
  });

  test('instant sources are included, as the JSON the route would send', async () => {
    const seed = await buildSeed(1, {
      instant: { '/api/a': () => ({ at: new Date('2026-10-17T12:00:00Z'), gone: undefined }) },
      budgeted: {},
    });
    expect(seed.data).toEqual({ '/api/a': { at: '2026-10-17T12:00:00.000Z' } });
  });

  test('a source that answers within the budget is included', async () => {
    const result = buildSeed(1, { instant: {}, budgeted: { '/api/b': () => later(50, 'b') } });
    await vi.advanceTimersByTimeAsync(50);
    expect((await result).data).toEqual({ '/api/b': 'b' });
  });

  test('a slow source is left out once the budget has passed', async () => {
    const result = buildSeed(1, {
      instant: {},
      budgeted: {
        '/api/fast': () => later(10, 'fast'),
        '/api/slow': () => later(SEED_BUDGET_MS + 1, 'slow'),
      },
    });
    await vi.advanceTimersByTimeAsync(SEED_BUDGET_MS);
    const seed = await result;
    expect(seed.data).toEqual({ '/api/fast': 'fast' });
    // The late answer must not appear in the object that was handed out.
    await vi.advanceTimersByTimeAsync(10);
    expect(seed.data).toEqual({ '/api/fast': 'fast' });
  });

  test('does not wait the whole budget when every source answers early', async () => {
    let done = false;
    const result = buildSeed(1, {
      instant: {},
      budgeted: { '/api/a': () => later(5, 1), '/api/b': () => 2 },
    }).then((seed) => {
      done = true;
      return seed;
    });
    await vi.advanceTimersByTimeAsync(5);
    expect(done).toBe(true);
    expect((await result).data).toEqual({ '/api/a': 1, '/api/b': 2 });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('the budget is shared, not per source', async () => {
    const result = buildSeed(
      1,
      {
        instant: {},
        budgeted: { '/api/a': () => later(80, 'a'), '/api/b': () => later(200, 'b') },
      },
      100,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect((await result).data).toEqual({ '/api/a': 'a' });
  });

  test('a throwing or rejecting source is left out, the others stay', async () => {
    const seed = await buildSeed(1, {
      instant: {
        '/api/throws': () => {
          throw new Error('boom');
        },
        '/api/ok': () => 'ok',
      },
      budgeted: {
        '/api/rejects': () => Promise.reject(new Error('boom')),
        '/api/sync-throws': () => {
          throw new Error('boom');
        },
        '/api/fine': () => 'fine',
      },
    });
    expect(seed.data).toEqual({ '/api/ok': 'ok', '/api/fine': 'fine' });
  });

  test('a value that cannot become JSON is left out', async () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const seed = await buildSeed(1, { instant: { '/api/loop': () => loop }, budgeted: {} });
    expect(seed.data).toEqual({});
  });
});
