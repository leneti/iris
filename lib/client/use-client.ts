'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { prefs, subscribePrefs } from './prefs';
import { browserTimeZone, rememberTimeZone } from './time-zone';

const noop = () => () => {};

/** False on the server and during hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export function useHostname(): string {
  return useSyncExternalStore(
    noop,
    () => window.location.hostname,
    () => '',
  );
}

export function useProtocol(): string {
  return useSyncExternalStore(
    noop,
    () => window.location.protocol,
    () => '',
  );
}

/** A media query; `serverValue` is what the server render assumes. */
export function useMedia(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** A per-device preference. The server render and hydration see `fallback`. */
export function usePref<T>(key: string, fallback: T): T {
  const raw = useSyncExternalStore(
    subscribePrefs,
    () => prefs.raw(key),
    () => null,
  );
  // `fallback` is a literal at the call site; the raw text is the real dependency.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (raw === null ? fallback : prefs.get(key, fallback)), [raw, key]);
}

/**
 * The current time in ms, refreshed every `periodMs`; for "5 min ago" text. `initial` is the
 * server's clock: the first render uses it, so the HTML matches, and the browser's clock takes
 * over as soon as the page is mounted.
 */
export function useNow(periodMs = 30_000, initial?: number): number {
  const [now, setNow] = useState(() => initial ?? Date.now());
  useEffect(() => {
    // Leaving the server's clock for the browser's is the one thing an effect is for here.
    // oxlint-disable-next-line react-hooks/set-state-in-effect
    if (initial !== undefined) setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(timer);
  }, [periodMs, initial]);
  return now;
}

/**
 * The viewer's IANA zone. The first render returns `initial`, the zone the server rendered for;
 * once mounted it is the browser's own, which is also stored for the next request.
 */
export function useTimeZone(initial?: string): string | undefined {
  const zone = useSyncExternalStore(
    noop,
    () => browserTimeZone() ?? initial,
    () => initial,
  );
  useEffect(() => {
    if (zone !== undefined) rememberTimeZone(zone);
  }, [zone]);
  return zone;
}
