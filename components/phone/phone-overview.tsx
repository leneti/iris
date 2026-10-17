'use client';

import { ChevronRight, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { HealthMark } from '@/components/health-mark';
import { JobsCard } from '@/components/overview/jobs-card';
import { LinksCard } from '@/components/overview/links';
import { MarketsCard } from '@/components/overview/markets';
import { NowPlayingPanel } from '@/components/overview/now-playing-panel';
import { SystemPanel } from '@/components/overview/system-panel';
import { secondsSince, useNow } from '@/components/jobs/time';
import { useCron, useWidgets } from '@/lib/client/api';
import { formatAge, formatDuration } from '@/lib/client/format';
import type { ServiceStatus, ServicesResponse, StatusResponse } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';

export type PhoneOverviewProps = {
  services: ServicesResponse | undefined;
  status: StatusResponse | undefined;
  openIds: string[];
  /** AppShell's wrapper, so a service this device always opens in a browser tab still does. */
  onOpenService: (id: string) => void;
  onOpenJobs: () => void;
};

type Tone = 'unhealthy' | 'degraded' | 'stopped';
type Alert = { key: string; tone: Tone; name: string; what: string; onSelect: () => void };

const TONE: Record<Tone, { row: string; bar: string }> = {
  unhealthy: { row: 'bg-row-unhealthy border-tag-line-unhealthy', bar: 'bg-status-unhealthy' },
  degraded: { row: 'bg-row-degraded border-tag-line-degraded', bar: 'bg-status-degraded' },
  stopped: { row: 'bg-raised border-hairline-raised', bar: 'bg-status-stopped' },
};

const HEALTH_ORDER: readonly { status: ServiceStatus; word: string }[] = [
  { status: 'healthy', word: 'Healthy' },
  { status: 'degraded', word: 'Degraded' },
  { status: 'starting', word: 'Starting' },
  { status: 'unhealthy', word: 'Unhealthy' },
  { status: 'stopped', word: 'Stopped' },
  { status: 'unknown', word: 'Unknown' },
];

function AlertRow({ alert }: { alert: Alert }) {
  const tone = TONE[alert.tone];
  return (
    <li>
      <button
        type="button"
        onClick={alert.onSelect}
        className={cn(
          'relative flex min-h-12 w-full items-center gap-3 overflow-hidden rounded-menu border px-4 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
          tone.row,
        )}
      >
        <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', tone.bar)} />
        <TriangleAlert
          aria-hidden
          className={cn(
            'size-5 shrink-0',
            alert.tone === 'unhealthy' && 'text-status-unhealthy-text',
            alert.tone === 'degraded' && 'text-status-degraded-text',
            alert.tone === 'stopped' && 'text-status-stopped-text',
          )}
        />
        <span className="min-w-0 flex-1 text-[15px]">
          <strong className="font-semibold">{alert.name}</strong> {alert.what}
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-text-2" />
      </button>
    </li>
  );
}

function Health({ summary }: { summary: StatusResponse['summary'] }) {
  const cells = HEALTH_ORDER.filter(({ status }) => summary[status] > 0);
  if (cells.length === 0) return null;
  return (
    <section aria-label="Health">
      <dl
        className="grid gap-px overflow-hidden rounded-menu border border-hairline-raised bg-hairline-raised"
        style={{
          gridTemplateColumns: `repeat(${cells.length > 4 ? 3 : cells.length}, minmax(0, 1fr))`,
        }}
      >
        {cells.map(({ status, word }) => (
          // The word comes first for a screen reader; the count is drawn above it.
          <div key={status} className="flex flex-col-reverse bg-raised px-1 py-3 text-center">
            <dt className="text-[13px] text-text-2">{word}</dt>
            <dd className="flex items-center justify-center gap-2 text-xl font-semibold tabular-nums">
              <HealthMark status={status} size={14} />
              {summary[status]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 p-3">{children}</div>;
}

/**
 * The phone's Overview (handoff 7.7): what needs attention first, then the health counts, System
 * and Now playing, and below them Markets, Links and the jobs that need attention.
 */
export function PhoneOverview({ services, status, onOpenService, onOpenJobs }: PhoneOverviewProps) {
  const { data: cron } = useCron();
  const { data: widgets } = useWidgets();
  const now = useNow();
  const nameOf = new Map(
    (services?.groups ?? []).flatMap((g) => g.services.map((s) => [s.id, s.name] as const)),
  );

  const alerts: Alert[] = [];
  const jobs = cron?.jobs ?? [];
  for (const j of jobs.filter((x) => x.flag === 'failed')) {
    const age = secondsSince(j.lastRun, now);
    alerts.push({
      key: `job:${j.id}`,
      tone: 'unhealthy',
      name: j.name,
      what: age === null ? 'failed' : `failed ${formatAge(age)}`,
      onSelect: onOpenJobs,
    });
  }
  for (const j of jobs.filter((x) => x.flag === 'overdue')) {
    const late = secondsSince(j.previousDue, now);
    alerts.push({
      key: `job:${j.id}`,
      tone: 'degraded',
      name: j.name,
      what: late === null ? 'overdue' : `overdue, ${formatDuration(late)} late`,
      onSelect: onOpenJobs,
    });
  }
  // A service that stopped on its own (a recorded change), not one that was never started.
  for (const [id, entry] of Object.entries(status?.services ?? {})) {
    const name = nameOf.get(id);
    if (name === undefined) continue;
    const age = secondsSince(entry.changedAt, now);
    const since = age === null ? '' : ` ${formatAge(age)}`;
    if (entry.status === 'unhealthy') {
      alerts.push({
        key: `svc:${id}`,
        tone: 'unhealthy',
        name,
        what: `is unhealthy${since}`,
        onSelect: () => onOpenService(id),
      });
    }
  }
  for (const [id, entry] of Object.entries(status?.services ?? {})) {
    const name = nameOf.get(id);
    if (name === undefined || entry.status !== 'stopped' || entry.changedAt === null) continue;
    alerts.push({
      key: `svc:${id}`,
      tone: 'stopped',
      name,
      what: `stopped ${formatAge(secondsSince(entry.changedAt, now))}`,
      onSelect: () => onOpenService(id),
    });
  }

  return (
    <Stack>
      {alerts.length > 0 && (
        <section aria-label="Alerts">
          <ul className="flex flex-col gap-2">
            {alerts.map((a) => (
              <AlertRow key={a.key} alert={a} />
            ))}
          </ul>
        </section>
      )}
      {status && <Health summary={status.summary} />}
      <SystemPanel variant="phone" />
      <NowPlayingPanel />
      {(widgets?.standalone ?? []).map((w) => (
        <MarketsCard key={w.id} widget={w} touch />
      ))}
      <LinksCard links={services?.links ?? []} touch />
      <JobsCard onOpenJobs={onOpenJobs} touch />
    </Stack>
  );
}
