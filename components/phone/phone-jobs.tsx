'use client';

import { cronUnreachable } from '@/components/jobs/jobs-pill';
import { JobTag, tagKind, type TagKind } from '@/components/jobs/job-tag';
import { clock, dayOffset, secondsSince, useNow, weekday } from '@/components/jobs/time';
import { useCron } from '@/lib/client/api';
import { formatAge, formatDuration } from '@/lib/client/format';
import type { CronJob } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';

const COUNT_ORDER: readonly [TagKind, string][] = [
  ['failed', 'failed'],
  ['overdue', 'overdue'],
  ['warning', 'warning'],
  ['success', 'ok'],
  ['not-monitored', 'not monitored'],
  ['unknown', 'unknown'],
];

// Failed first, then overdue, then everything else in the order the server gave.
const RANK: Record<string, number> = { failed: 0, overdue: 1 };
const byRank = (a: CronJob, b: CronJob) => (RANK[a.flag] ?? 2) - (RANK[b.flag] ?? 2);

function safeLink(link: string | null): string | null {
  if (link === null) return null;
  try {
    const { protocol } = new URL(link);
    return protocol === 'http:' || protocol === 'https:' ? link : null;
  } catch {
    return null;
  }
}

function when(iso: string, now: number, tz: string): string {
  const offset = dayOffset(iso, now, tz);
  const word = offset === 0 ? '' : `${offset === 1 ? 'tomorrow' : weekday(iso, tz)} `;
  return `${word}${clock(iso, tz)}`;
}

/** "Last 10:00, 26 min ago · Next 10:30": one line for the run that happened and the next one. */
function runLine(job: CronJob, now: number, tz: string): string {
  const last =
    job.lastRun === null
      ? 'Not reported'
      : `Last ${clock(job.lastRun, tz)}, ${formatAge(secondsSince(job.lastRun, now))}`;
  if (job.flag === 'overdue' && job.previousDue !== null) {
    const late = formatDuration(secondsSince(job.previousDue, now));
    return `${last} · Next was ${clock(job.previousDue, tz)}, ${late} late`;
  }
  return job.nextDue === null ? last : `${last} · Next ${when(job.nextDue, now, tz)}`;
}

function Card({ job, now, tz }: { job: CronJob; now: number; tz: string }) {
  const kind = tagKind(job);
  const link = safeLink(job.link);
  const tone = kind === 'failed' ? 'unhealthy' : kind === 'overdue' ? 'degraded' : null;
  return (
    <li
      data-flag={job.flag}
      className={cn(
        'relative overflow-hidden rounded-menu border border-hairline-raised bg-raised px-3.5 py-2.5',
        tone === 'unhealthy' && 'bg-row-unhealthy',
        tone === 'degraded' && 'bg-row-degraded',
      )}
    >
      {tone !== null && (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 w-[3px]',
            tone === 'unhealthy' ? 'bg-status-unhealthy' : 'bg-status-degraded',
          )}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            data-slot="job-name"
            className="-my-2.5 flex min-h-11 min-w-0 items-center text-[15px] font-semibold text-accent-text underline-offset-2"
          >
            {job.name}
          </a>
        ) : (
          <span data-slot="job-name" className="min-w-0 text-[15px] font-semibold">
            {job.name}
          </span>
        )}
        <JobTag kind={kind} className="shrink-0" />
      </div>
      <p className="mt-0.5 text-[13px] text-text-2">
        {job.schedule.expr === null ? (
          'No schedule'
        ) : (
          <>
            {job.schedule.label && <>{job.schedule.label} </>}
            <span className="font-mono text-xs text-text-3">{job.schedule.expr}</span>
          </>
        )}
      </p>
      <p className="mt-0.5 text-[13px] text-text-2 tabular-nums">{runLine(job, now, tz)}</p>
      {job.summary !== null && (
        <p
          className={cn(
            'mt-1 text-[13px] text-text-2',
            kind === 'failed' && 'text-status-unhealthy-text',
          )}
        >
          {job.summary}
        </p>
      )}
    </li>
  );
}

function Section({
  title,
  jobs,
  now,
  tz,
}: {
  title: string;
  jobs: CronJob[];
  now: number;
  tz: string;
}) {
  return (
    <section aria-label={title}>
      <h2 className="flex h-6 items-center px-1 text-[11px] font-semibold tracking-[0.06em] text-text-2 uppercase">
        {title}
      </h2>
      <ul className="mt-1 flex flex-col gap-2">
        {jobs.map((job) => (
          <Card key={job.id} job={job} now={now} tz={tz} />
        ))}
      </ul>
    </section>
  );
}

const NOTE =
  'rounded-menu border border-tag-line-degraded bg-tint-degraded px-3.5 py-2 text-status-degraded-text';

/** Scheduled jobs as cards: flagged first, then the rest, then System maintenance (handoff 7.7). */
export function PhoneJobs() {
  const { data: cron, error } = useCron();
  const now = useNow();
  const unreachable = cronUnreachable(cron) || (cron === undefined && error !== undefined);
  const hostStale = cron?.sources.some((s) => s.id === 'host-status' && s.state === 'stale');
  const tz = cron?.timezone ?? 'UTC';
  const mine = (cron?.jobs.filter((j) => j.kind === 'user') ?? []).sort(byRank);
  const system = (cron?.jobs.filter((j) => j.kind === 'maintenance') ?? []).sort(byRank);
  const counts = new Map<TagKind, number>();
  for (const j of cron?.jobs ?? []) counts.set(tagKind(j), (counts.get(tagKind(j)) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-3 p-3">
      {unreachable && (
        <p role="status" className={NOTE}>
          cron-status is unreachable, so job results may be out of date.
        </p>
      )}
      {hostStale && (
        <p className={NOTE}>The host status is stale, so maintenance jobs show no result.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {COUNT_ORDER.filter(([kind]) => (counts.get(kind) ?? 0) > 0).map(([kind, word]) => (
          <JobTag key={kind} kind={kind} label={`${counts.get(kind)} ${word}`} />
        ))}
      </div>
      {cron === undefined ? (
        <p className="px-1 text-text-2">Loading…</p>
      ) : (
        <>
          <Section title="Your jobs" jobs={mine} now={now} tz={tz} />
          {system.length > 0 && (
            <Section title="System maintenance" jobs={system} now={now} tz={tz} />
          )}
        </>
      )}
    </div>
  );
}
