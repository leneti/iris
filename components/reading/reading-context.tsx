'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { POLL_MS, useCron, useServices, useStatus, useSystem, useWidgets } from '@/lib/client/api';
import { deriveReading, type Reading, type Source } from '@/lib/client/reading';
import { isUnavailable, lastOk } from '@/lib/client/source-health';
import { useNow, useTimeZone } from '@/lib/client/use-client';
import type { ServicesResponse } from '@/lib/shared/contract';

export const ReadingStateContext = createContext<Reading | null>(null);

const URLS: Record<Source, string> = {
  services: '/api/services',
  status: '/api/status',
  cron: '/api/cron',
  system: '/api/system',
  widgets: '/api/widgets',
};

/**
 * Runs the Overview derivation once for the whole shell, so the wordmark is right on every tab and
 * the Overview reads the same object. `services` is the shell's last complete list.
 */
export function ReadingProvider({
  services,
  serverNow,
  serverTimeZone,
  children,
}: {
  services: ServicesResponse | undefined;
  /** The server's clock (ms) the first render uses, so it matches the HTML. */
  serverNow?: number;
  /** The zone the server rendered the greeting for. */
  serverTimeZone?: string;
  children: ReactNode;
}) {
  const status = useStatus();
  const cron = useCron();
  const system = useSystem();
  const widgets = useWidgets();
  const servicesPoll = useServices();
  const now = useNow(30_000, serverNow);
  const timeZone = useTimeZone(serverTimeZone);

  const failing: Record<Source, { hasData: boolean; failing: boolean }> = {
    services: { hasData: services !== undefined, failing: servicesPoll.error !== undefined },
    status: { hasData: status.data !== undefined, failing: status.error !== undefined },
    cron: { hasData: cron.data !== undefined, failing: cron.error !== undefined },
    system: { hasData: system.data !== undefined, failing: system.error !== undefined },
    widgets: { hasData: widgets.data !== undefined, failing: widgets.error !== undefined },
  };
  const down = (Object.keys(failing) as Source[]).filter((source) =>
    isUnavailable({
      ...failing[source],
      okAt: lastOk(URLS[source]),
      intervalMs: POLL_MS[source],
      now,
    }),
  );
  const key = down.sort().join(',');

  const reading = useMemo(
    () =>
      deriveReading({
        services,
        status: status.data,
        cron: cron.data,
        system: system.data,
        widgets: widgets.data,
        now: new Date(now),
        timeZone,
        unavailable: new Set(key === '' ? [] : (key.split(',') as Source[])),
      }),
    [services, status.data, cron.data, system.data, widgets.data, now, timeZone, key],
  );

  return <ReadingStateContext.Provider value={reading}>{children}</ReadingStateContext.Provider>;
}

export function useReading(): Reading {
  const reading = useContext(ReadingStateContext);
  if (reading === null) throw new Error('useReading needs a ReadingProvider');
  return reading;
}

/** False outside a provider, so the wordmark renders on its own. */
export function useReadingWrong(): boolean {
  return useContext(ReadingStateContext)?.wrong ?? false;
}
