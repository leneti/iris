import { afterEach, describe, expect, test, vi } from 'vitest';
import { prefs } from '@/lib/client/prefs';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('prefs', () => {
  test('round-trips values per key', () => {
    prefs.set('sidebarCollapsed', true);
    prefs.set('groups', { media: false });
    expect(prefs.get('sidebarCollapsed', false)).toBe(true);
    expect(prefs.get('groups', {} as Record<string, boolean>)).toEqual({ media: false });
  });
  test('missing key gives the fallback', () => {
    expect(prefs.get('nope', 'x')).toBe('x');
  });
  test('corrupt JSON or a value of the wrong type gives the fallback', () => {
    localStorage.setItem('iris.pref.a', '{not json');
    localStorage.setItem('iris.pref.b', JSON.stringify('text'));
    localStorage.setItem('iris.pref.c', JSON.stringify({ x: 1 }));
    expect(prefs.get('a', true)).toBe(true);
    expect(prefs.get('b', false)).toBe(false);
    expect(prefs.get('c', [] as string[])).toEqual([]);
  });
  test('throwing storage never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(prefs.get('k', 7)).toBe(7);
    expect(() => prefs.set('k', 8)).not.toThrow();
  });
  test('an unreachable localStorage accessor never throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(prefs.get('k', 'd')).toBe('d');
    expect(() => prefs.set('k', 'v')).not.toThrow();
  });
});
