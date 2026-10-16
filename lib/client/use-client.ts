'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { prefs, subscribePrefs } from './prefs';

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

/** The current time in ms, refreshed every `periodMs`; for "5 min ago" text. */
export function useNow(periodMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(timer);
  }, [periodMs]);
  return now;
}
