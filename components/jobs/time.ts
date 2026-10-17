'use client';

import { useEffect, useState } from 'react';
import { zone } from '@/lib/client/format';

export { clock } from '@/lib/client/format';

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
