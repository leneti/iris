import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useShell } from '@/components/shell/use-shell';
import { saveTabs } from '@/lib/client/tabs';
import type { ServicesResponse } from '@/lib/shared/contract';
import { group, servicesResponse, svc } from './fixtures';

let servicesData: ServicesResponse | undefined;
vi.mock('@/lib/client/api', () => ({
  useServices: () => ({ data: servicesData }),
  useStatus: () => ({ data: undefined }),
  useCron: () => ({ data: undefined }),
}));

const starting: ServicesResponse = {
  ...servicesResponse([]),
  warnings: [{ code: 'STARTING', message: 'Discovery has not run yet' }],
};
const dockerDown = (r: ServicesResponse): ServicesResponse => ({
  ...r,
  sources: { docker: 'unreachable', manual: 'ok' },
});

const two = servicesResponse([group('Media', [svc('a', 'Alpha'), svc('b', 'Beta')])]);
const stored = () => localStorage.getItem('iris.tabs');

beforeEach(() => {
  servicesData = undefined;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('useShell', () => {
  test('stored tabs survive until the first services response, then load', () => {
    saveTabs(localStorage, { open: ['a', 'b'], active: 'a', lru: ['a', 'b'], live: ['a'] });
    const before = stored();
    const { result, rerender } = renderHook(() => useShell('lan'));
    expect(result.current.tabs.open).toEqual([]);
    expect(stored()).toBe(before);
    servicesData = two;
    rerender();
    expect(result.current.tabs.open).toEqual(['a', 'b']);
    expect(result.current.tabs.active).toBe('a');
    expect(stored()).toBe(before);
  });

  test('a service that disappears from a later poll closes its tab', () => {
    servicesData = two;
    const { result, rerender } = renderHook(() => useShell('lan'));
    act(() => result.current.openService('a'));
    act(() => result.current.openService('b'));
    servicesData = servicesResponse([group('Media', [svc('a', 'Alpha')])]);
    rerender();
    expect(result.current.tabs.open).toEqual(['a']);
    expect(result.current.tabs.active).toBe('a');
  });

  test('keeps #tab=<id> in step with the active tab', () => {
    servicesData = two;
    const { result } = renderHook(() => useShell('lan'));
    act(() => result.current.openService('b'));
    expect(window.location.hash).toBe('#tab=b');
    act(() => result.current.dispatch({ type: 'closeAll' }));
    expect(window.location.hash).toBe('');
  });

  test('caps live frames at 8 without per-dispatch limits', () => {
    const many = Array.from({ length: 10 }, (_, i) => svc(`s${i}`, `Svc ${i}`));
    servicesData = servicesResponse([group('Media', many)]);
    const { result } = renderHook(() => useShell('lan'));
    act(() => {
      for (const s of many) result.current.openService(s.id);
    });
    expect(result.current.tabs.open).toHaveLength(10);
    expect(result.current.tabs.live).toHaveLength(8);
  });

  test('openBuiltin opens the built-in views', () => {
    servicesData = two;
    const { result } = renderHook(() => useShell('lan'));
    act(() => result.current.openBuiltin('builtin:jobs'));
    expect(result.current.tabs.active).toBe('builtin:jobs');
  });

  test('a response from before discovery has run neither restores nor prunes tabs', () => {
    saveTabs(localStorage, { open: ['a', 'b'], active: 'a', lru: ['a', 'b'], live: ['a'] });
    const before = stored();
    servicesData = starting;
    const { result, rerender } = renderHook(() => useShell('lan'));
    expect(result.current.tabs.open).toEqual([]);
    expect(stored()).toBe(before);
    servicesData = two;
    rerender();
    expect(result.current.tabs.open).toEqual(['a', 'b']);
    expect(stored()).toBe(before);
  });

  test('a first response with Docker unreadable does not drop stored tabs', () => {
    saveTabs(localStorage, { open: ['a', 'b'], active: 'a', lru: ['a', 'b'], live: ['a'] });
    const before = stored();
    servicesData = dockerDown(servicesResponse([group('Links', [svc('m', 'Manual')])]));
    const { result, rerender } = renderHook(() => useShell('lan'));
    expect(result.current.tabs.open).toEqual([]);
    expect(stored()).toBe(before);
    servicesData = two;
    rerender();
    expect(result.current.tabs.open).toEqual(['a', 'b']);
  });

  test('an open page keeps its tabs and its last service list through a restart', () => {
    servicesData = two;
    const { result, rerender } = renderHook(() => useShell('lan'));
    act(() => result.current.openService('a'));
    act(() => result.current.openService('b'));
    const saved = stored();
    servicesData = starting;
    rerender();
    expect(result.current.tabs.open).toEqual(['a', 'b']);
    expect(result.current.services).toBe(two);
    servicesData = dockerDown(servicesResponse([]));
    rerender();
    expect(result.current.tabs.open).toEqual(['a', 'b']);
    expect(result.current.services).toBe(two);
    expect(stored()).toBe(saved);
    // Once discovery is whole again, pruning works as before.
    servicesData = servicesResponse([group('Media', [svc('a', 'Alpha')])]);
    rerender();
    expect(result.current.tabs.open).toEqual(['a']);
  });
});
