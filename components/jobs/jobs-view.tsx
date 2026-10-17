'use client';

import { useCron } from '@/lib/client/api';
import { formatAge } from '@/lib/client/format';
import { cn } from '@/lib/utils';
import { cronUnreachable } from './jobs-pill';
import { JobTag, tagKind, type TagKind } from './job-tag';
import { JobsTable } from './jobs-table';
import { secondsSince, useNow } from './time';

const COUNT_ORDER: readonly [TagKind, string][] = [
  ['failed', 'failed'],
  ['overdue', 'overdue'],
  ['warning', 'warning'],
  ['success', 'ok'],
  ['not-monitored', 'not monitored'],
  ['unknown', 'unknown'],
];

/** The built-in "Scheduled jobs" tab (handoff 7.5): Your jobs and System maintenance. */
export function JobsView() {
  const { data: cron, error } = useCron();
  const now = useNow();
  const unreachable = cronUnreachable(cron) || (cron === undefined && error !== undefined);
  const hostStale = cron?.sources.some((s) => s.id === 'host-status' && s.state === 'stale');

  const mine = cron?.jobs.filter((j) => j.kind === 'user') ?? [];
  const system = cron?.jobs.filter((j) => j.kind === 'maintenance') ?? [];
  const counts = new Map<TagKind, number>();
  for (const j of cron?.jobs ?? []) counts.set(tagKind(j), (counts.get(tagKind(j)) ?? 0) + 1);
  const source = cron?.sources.find((s) => s.id === 'cron-status');
  const age = secondsSince(source?.fetchedAt ?? null, now);
  const tz = cron?.timezone ?? 'UTC';

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-[-0.015em]">Scheduled jobs</h1>
        <div className="flex flex-wrap items-center gap-2">
          {COUNT_ORDER.filter(([kind]) => (counts.get(kind) ?? 0) > 0).map(([kind, word]) => (
            <JobTag key={kind} kind={kind} label={`${counts.get(kind)} ${word}`} />
          ))}
        </div>
        <p className="ml-auto text-xs text-text-2">
          Job status source{age !== null ? ` · updated ${formatAge(age)}` : ''}
          {cron ? ` · times in ${tz}` : ''}
        </p>
      </div>
      {unreachable && (
        <p
          role="status"
          className={cn(
            'rounded-menu border border-tag-line-degraded bg-tint-degraded px-4 py-2 text-status-degraded-text',
          )}
        >
          cron-status is unreachable, so job results may be out of date.
        </p>
      )}
      {hostStale && (
        <p className="rounded-menu border border-tag-line-degraded bg-tint-degraded px-4 py-2 text-status-degraded-text">
          The host status is stale, so maintenance jobs show no result.
        </p>
      )}
      {cron && (
        <>
          <JobsTable title="Your jobs" jobs={mine} now={now} tz={tz} />
          <JobsTable title="System maintenance" jobs={system} now={now} tz={tz} />
        </>
      )}
      <p className="text-xs text-text-2">
        A job is overdue when its last run is older than its most recent scheduled time plus a grace
        period. Failed and overdue jobs also show in the Jobs pill in the top bar.
      </p>
    </div>
  );
}
