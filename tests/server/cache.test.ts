import { createTtlCache } from '@/lib/server/cache';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createTtlCache', () => {
  test('loads only when get is called: an expired entry is not refreshed in the background', async () => {
    const cache = createTtlCache();
    const load = vi.fn(async () => 1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(load).not.toHaveBeenCalled();
    await cache.get('k', 1000, load);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('two concurrent get calls make one load', async () => {
    const cache = createTtlCache();
    let release: (v: number) => void = () => {};
    const load = vi.fn(() => new Promise<number>((resolve) => (release = resolve)));
    const a = cache.get('k', 1000, load);
    const b = cache.get('k', 1000, load);
    release(7);
    const [ra, rb] = await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(ra).toEqual({ value: 7, fetchedAt: Date.now(), error: null });
    expect(rb).toEqual(ra);
  });

  test('keys are independent', async () => {
    const cache = createTtlCache();
    const load = vi.fn(async () => 'x');
    await Promise.all([cache.get('a', 1000, load), cache.get('b', 1000, load)]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('serves the cached value inside the ttl and reloads after it', async () => {
    const cache = createTtlCache();
    let n = 0;
    const load = vi.fn(async () => ++n);
    const first = await cache.get('k', 1000, load);
    vi.advanceTimersByTime(999);
    const second = await cache.get('k', 1000, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    vi.advanceTimersByTime(1);
    const third = await cache.get('k', 1000, load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(third.value).toBe(2);
    expect(third.fetchedAt).toBe(Date.now());
  });

  test('on error it keeps the last good value and its time', async () => {
    const cache = createTtlCache();
    const good = await cache.get('k', 1000, async () => 'good');
    const goodAt = Date.now();
    vi.advanceTimersByTime(5000);
    const boom = new Error('down');
    const failed = await cache.get('k', 1000, async () => {
      throw boom;
    });
    expect(good.error).toBeNull();
    expect(failed).toEqual({ value: 'good', fetchedAt: goodAt, error: boom });
  });

  test('an error with nothing cached gives null value and time', async () => {
    const cache = createTtlCache();
    const boom = new Error('down');
    const r = await cache.get<string>('k', 1000, async () => {
      throw boom;
    });
    expect(r).toEqual({ value: null, fetchedAt: null, error: boom });
  });

  test('a load that throws before returning a promise counts as an error', async () => {
    const cache = createTtlCache();
    const r = await cache.get<string>('k', 1000, () => {
      throw new Error('sync');
    });
    expect(r.value).toBeNull();
    expect(r.error).toBeInstanceOf(Error);
  });

  test('a failed attempt is not retried inside the ttl, then it is', async () => {
    const cache = createTtlCache();
    const load = vi.fn(async () => {
      throw new Error('down');
    });
    await cache.get('k', 1000, load);
    vi.advanceTimersByTime(500);
    const again = await cache.get('k', 1000, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(again.error).toBeInstanceOf(Error);
    vi.advanceTimersByTime(500);
    await cache.get('k', 1000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('with a long ttl a failure is retried after 30 s', async () => {
    const cache = createTtlCache();
    const load = vi.fn(async () => {
      throw new Error('down');
    });
    await cache.get('k', 1_800_000, load);
    vi.advanceTimersByTime(29_999);
    await cache.get('k', 1_800_000, load);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await cache.get('k', 1_800_000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('with a short ttl a failure is retried after the ttl', async () => {
    const cache = createTtlCache();
    const load = vi.fn(async () => {
      throw new Error('down');
    });
    await cache.get('k', 10_000, load);
    vi.advanceTimersByTime(9_999);
    await cache.get('k', 10_000, load);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await cache.get('k', 10_000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('errorTtlMs overrides how long a failure is kept', async () => {
    const cache = createTtlCache();
    const load = vi.fn(async () => {
      throw new Error('down');
    });
    await cache.get('k', 10_000, load, { errorTtlMs: 2000 });
    vi.advanceTimersByTime(1999);
    await cache.get('k', 10_000, load, { errorTtlMs: 2000 });
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await cache.get('k', 10_000, load, { errorTtlMs: 2000 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('a good value is still served for the full ttl, and survives a failure with its time', async () => {
    const cache = createTtlCache();
    await cache.get('k', 1_800_000, async () => 'good');
    const goodAt = Date.now();
    vi.advanceTimersByTime(1_800_000);
    const failed = await cache.get('k', 1_800_000, async () => {
      throw new Error('down');
    });
    expect(failed).toMatchObject({ value: 'good', fetchedAt: goodAt });
    expect(failed.error).toBeInstanceOf(Error);
  });

  test('a later success clears the error', async () => {
    const cache = createTtlCache();
    await cache.get('k', 1000, async () => {
      throw new Error('down');
    });
    vi.advanceTimersByTime(1000);
    const r = await cache.get('k', 1000, async () => 'back');
    expect(r).toEqual({ value: 'back', fetchedAt: Date.now(), error: null });
  });
});
