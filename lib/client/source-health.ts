// When each polled endpoint last answered, so a source that has been failing for a while can be
// called unavailable while a single failed poll (SWR keeps the last good data) changes nothing.
export type Source = 'services' | 'status' | 'cron' | 'system' | 'widgets';

const okAt = new Map<string, number>();

/** Record a successful poll of `key` (the endpoint URL). */
export function markOk(key: string, at: number = Date.now()): void {
  okAt.set(key, at);
}

export function lastOk(key: string): number | null {
  return okAt.get(key) ?? null;
}

/** Failing, and either never had data or has not been ok for more than 3 poll intervals. */
export function isUnavailable(i: {
  hasData: boolean;
  failing: boolean;
  okAt: number | null;
  intervalMs: number;
  now: number;
}): boolean {
  return i.failing && (!i.hasData || (i.okAt !== null && i.now - i.okAt > 3 * i.intervalMs));
}
