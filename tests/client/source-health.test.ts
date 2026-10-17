import { describe, expect, test } from 'vitest';
import { isUnavailable, lastOk, markOk } from '@/lib/client/source-health';

const base = { hasData: true, failing: true, okAt: 1_000, intervalMs: 10_000, now: 1_000 };

describe('source health', () => {
  test('a failing source with no data is unavailable', () => {
    expect(isUnavailable({ ...base, hasData: false, okAt: null })).toBe(true);
  });

  test('one failed poll with fresh data is not', () => {
    expect(isUnavailable({ ...base, now: 1_000 + 10_000 })).toBe(false);
  });

  test('failing for over 3x the interval is', () => {
    expect(isUnavailable({ ...base, now: 1_000 + 30_000 })).toBe(false);
    expect(isUnavailable({ ...base, now: 1_000 + 30_001 })).toBe(true);
  });

  test('never ok yet but with data is not', () => {
    expect(isUnavailable({ ...base, okAt: null, now: 1_000_000 })).toBe(false);
  });

  test('a source that is not failing is never unavailable', () => {
    expect(isUnavailable({ ...base, failing: false, hasData: false, okAt: null })).toBe(false);
  });

  test('markOk/lastOk round-trip', () => {
    expect(lastOk('/api/never-polled')).toBeNull();
    markOk('/api/test', 1234);
    expect(lastOk('/api/test')).toBe(1234);
    markOk('/api/test', 5678);
    expect(lastOk('/api/test')).toBe(5678);
    const before = Date.now();
    markOk('/api/stamped');
    expect(lastOk('/api/stamped')).toBeGreaterThanOrEqual(before);
  });
});
