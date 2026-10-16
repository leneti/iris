'use client';

import { ChevronRight } from 'lucide-react';
import { JobTag, tagKind } from '@/components/jobs/job-tag';
import { cronUnreachable } from '@/components/jobs/jobs-pill';
import { secondsSince, useNow } from '@/components/jobs/time';
import { useCron } from '@/lib/client/api';
import { formatAge, formatDuration } from '@/lib/client/format';
import type { CronJob } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';
import { Panel, PanelNote } from './panel';

const MAX_ROWS = 5;
const RANK: Record<string, number> = { failed: 0, overdue: 1, warning: 2 };

function when(job: CronJob, now: number): string {
  if (job.flag === 'overdue' && job.previousDue !== null) {
    return `${formatDuration(secondsSince(job.previousDue, now))} late`;
  }
  return job.lastRun === null ? '—' : formatAge(secondsSince(job.lastRun, now));
}

/** Failed, overdue and warning jobs, worst first, with a link to the jobs view. */
export function JobsCard({
  onOpenJobs,
  touch = false,
}: {
  onOpenJobs: () => void;
  /** The phone: rows and the link are at least 44 px tall. */
  touch?: boolean;
}) {
  const { data } = useCron();
  const now = useNow();
  const needing = (data?.jobs ?? [])
    .filter((j) => j.flag in RANK)
    .sort((a, b) => (RANK[a.flag] ?? 9) - (RANK[b.flag] ?? 9))
    .slice(0, MAX_ROWS);
  const total = data?.jobs.length ?? 0;
  return (
    <Panel
      title="Scheduled jobs"
      meta={data ? `${total} ${total === 1 ? 'job' : 'jobs'}` : undefined}
    >
      {!data ? (
        <PanelNote>Loading…</PanelNote>
      ) : (
        <>
          {cronUnreachable(data) && (
            <p className="px-4 pb-2 text-status-degraded-text">cron-status is unreachable</p>
          )}
          {needing.length === 0 ? (
            <PanelNote>Nothing needs attention</PanelNote>
          ) : (
            <ul>
              {needing.map((j) => (
                <li
                  key={j.id}
                  className={cn(
                    'flex items-center gap-3 border-t border-hairline-raised px-4',
                    touch ? 'min-h-12' : 'h-10',
                  )}
                >
                  <JobTag kind={tagKind(j)} className="w-[84px] shrink-0 justify-center" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{j.name}</span>
                  <span className="shrink-0 text-xs text-text-3 tabular-nums">{when(j, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <button
        type="button"
        onClick={onOpenJobs}
        className={cn(
          'flex w-full items-center gap-1 border-t border-hairline-raised px-4 text-accent-text outline-none hover:bg-hover-raised focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          touch ? 'h-12' : 'h-10',
        )}
      >
        Open scheduled jobs
        <ChevronRight aria-hidden className="size-3.5" />
      </button>
    </Panel>
  );
}
