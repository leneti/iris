import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useIsPhone } from '@/components/shell/app-shell';
import { TZ_COOKIE } from '@/lib/client/time-zone';
import { useNow, useTimeZone } from '@/lib/client/use-client';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T13:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useNow', () => {
  test('starts from the server clock, then takes the browser clock on mount', () => {
    const server = Date.parse('2026-10-17T12:59:00Z');
    const seen: number[] = [];
    renderHook(() => {
      const now = useNow(30_000, server);
      seen.push(now);
      return now;
    });
    expect(seen[0]).toBe(server);
    expect(seen.at(-1)).toBe(Date.now());
  });

  test('without a server clock it is the browser clock from the start', () => {
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(Date.now());
  });

  test('keeps ticking', () => {
    const { result } = renderHook(() => useNow(1000, 0));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(Date.now());
  });
});

describe('useTimeZone', () => {
  const originalTz = process.env.TZ;
  // The browser's zone is the process's zone here.
  const zoneOf = (zone: string) => {
    process.env.TZ = zone;
  };
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  test('the server render uses the zone it was given', () => {
    zoneOf('Asia/Tokyo');
    function Probe() {
      return <>{useTimeZone('Europe/London')}</>;
    }
    expect(renderToString(<Probe />)).toBe('Europe/London');
  });

  test('in the browser it is the browser zone, stored in a cookie', () => {
    zoneOf('Asia/Tokyo');
    const { result } = renderHook(() => useTimeZone('Europe/London'));
    expect(result.current).toBe('Asia/Tokyo');
    expect(document.cookie).toContain(`${TZ_COOKIE}=Asia%2FTokyo`);
  });

  test('with no server zone the browser corrects after mount', () => {
    zoneOf('Asia/Tokyo');
    const { result } = renderHook(() => useTimeZone());
    expect(result.current).toBe('Asia/Tokyo');
  });
});

describe('useIsPhone', () => {
  function screen(phone: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: phone,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  }

  function Probe({ hint }: { hint?: boolean }) {
    return <>{useIsPhone(hint) ? 'phone' : 'desktop'}</>;
  }

  test('the server render assumes the hint, desktop without one', () => {
    expect(renderToString(<Probe />)).toBe('desktop');
    expect(renderToString(<Probe hint />)).toBe('phone');
    expect(renderToString(<Probe hint={false} />)).toBe('desktop');
  });

  test('follows the screen in the browser', () => {
    screen(true);
    expect(renderHook(() => useIsPhone()).result.current).toBe(true);
    screen(false);
    expect(renderHook(() => useIsPhone(true)).result.current).toBe(false);
  });
});
