'use client';

import { useEffect, useState } from 'react';

function zone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** "10:15" in the given zone, 24-hour. */
export function clock(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone(tz),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

function day(ms: number, tz: string): number {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: zone(tz) })
    .format(new Date(ms))
    .split('-')
    .map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

/** Calendar days from `now` to `iso` in the zone (0 today, 1 tomorrow). */
export function dayOffset(iso: string, now: number, tz: string): number {
  return day(Date.parse(iso), tz) - day(now, tz);
}

export function weekday(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone(tz), weekday: 'short' }).format(
    new Date(iso),
  );
}

export function secondsSince(iso: string | null, now: number): number | null {
  return iso === null ? null : Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
}

/** Current time, refreshed every `ms`, so ages stay true between polls. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
