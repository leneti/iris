'use client';

import { useEffect, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { markOk } from '@/lib/client/source-health';

/** What the server rendered with: the clock it used, and each endpoint's body by URL. */
export type ShellSeed = { now: number; data: Record<string, unknown> };

/**
 * Hands the server's data to SWR as its fallback, so the first render already has it and the
 * polls that follow replace it in place. Seeded endpoints count as answered at mount, which
 * starts the clock `isUnavailable` measures a later outage from.
 */
export function SeedProvider({ seed, children }: { seed?: ShellSeed; children: ReactNode }) {
  const data = seed?.data;
  useEffect(() => {
    for (const url of Object.keys(data ?? {})) markOk(url);
  }, [data]);
  return <SWRConfig value={{ fallback: data ?? {} }}>{children}</SWRConfig>;
}
