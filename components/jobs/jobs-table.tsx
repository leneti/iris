'use client';

import { Clock } from 'lucide-react';
import { formatAge, formatDuration } from '@/lib/client/format';
import type { CronJob } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';
import { JobTag, tagKind } from './job-tag';
import { clock, dayOffset, secondsSince, weekday } from './time';

const HEADS = ['Job', 'Schedule', 'Last run', 'Result', 'Summary', 'Next due'] as const;

function safeLink(link: string | null): string | null {
  if (link === null) return null;
  try {
    const { protocol } = new URL(link);
    return protocol === 'http:' || protocol === 'https:' ? link : null;
  } catch {
    return null;
  }
}

function dayWord(iso: string, now: number, tz: string): string {
  const offset = dayOffset(iso, now, tz);
  if (offset === 0) return '';
  return `${offset === 1 ? 'Tomorrow' : weekday(iso, tz)} `;
}

function NextDue({ job, now, tz }: { job: CronJob; now: number; tz: string }) {
  if (job.flag === 'overdue' && job.previousDue !== null) {
    const late = secondsSince(job.previousDue, now) ?? 0;
    return (
      <>
        <div className="font-medium tabular-nums">
          Due {dayWord(job.previousDue, now, tz)}
          {clock(job.previousDue, tz)}
        </div>
        <div className="text-xs text-text-3 tabular-nums">{formatDuration(late)} late</div>
      </>
    );
  }
  if (job.nextDue === null) return <span className="text-text-3">—</span>;
  const until = Math.max(0, Math.round((Date.parse(job.nextDue) - now) / 1000));
  return (
    <>
      <div className="font-medium tabular-nums">
        {dayWord(job.nextDue, now, tz)}
        {clock(job.nextDue, tz)}
      </div>
      <div className="text-xs text-text-3 tabular-nums">in {formatDuration(until)}</div>
    </>
  );
}

function Row({ job, now, tz }: { job: CronJob; now: number; tz: string }) {
  const kind = tagKind(job);
  const link = safeLink(job.link);
  const flagged = kind === 'failed' ? 'unhealthy' : kind === 'overdue' ? 'degraded' : null;
  const age = secondsSince(job.lastRun, now);
  return (
    <tr
      data-flag={job.flag}
      className={cn(
        'border-t border-hairline-raised',
        flagged === 'unhealthy' && 'bg-row-unhealthy',
        flagged === 'degraded' && 'bg-row-degraded',
      )}
    >
      <td className="relative px-4 py-2.5 align-middle">
        {flagged && (
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-0 left-0 w-[3px]',
              flagged === 'unhealthy' ? 'bg-status-unhealthy' : 'bg-status-degraded',
            )}
          />
        )}
        <span className="flex items-center gap-2">
          <Clock aria-hidden className="size-3.5 shrink-0 text-text-3" />
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-accent-text underline-offset-2 hover:underline"
            >
              {job.name}
            </a>
          ) : (
            <span className="font-semibold">{job.name}</span>
          )}
        </span>
      </td>
      <td className="px-4 py-2.5 align-middle">
        {job.schedule.expr === null ? (
          <span className="text-text-3">No schedule</span>
        ) : (
          <>
            {job.schedule.label && <div>{job.schedule.label}</div>}
            <div className="font-mono text-xs text-text-3">{job.schedule.expr}</div>
          </>
        )}
      </td>
      <td className="px-4 py-2.5 align-middle">
        {job.lastRun === null ? (
          <>
            <div className="text-text-3">—</div>
            <div className="text-xs text-text-3">not reported</div>
          </>
        ) : (
          <>
            <div className="tabular-nums">{clock(job.lastRun, tz)}</div>
            <div className="text-xs text-text-3 tabular-nums">{formatAge(age)}</div>
          </>
        )}
      </td>
      <td className="px-4 py-2.5 align-middle">
        <JobTag kind={kind} />
      </td>
      <td
        className={cn(
          'px-4 py-2.5 align-middle',
          flagged === 'unhealthy' && 'text-status-unhealthy-text',
          job.summary === null && 'text-text-3',
        )}
      >
        {job.summary ?? '—'}
      </td>
      <td className="px-4 py-2.5 align-middle">
        <NextDue job={job} now={now} tz={tz} />
      </td>
    </tr>
  );
}

export function JobsTable({
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
    <section className="overflow-hidden rounded-menu border border-hairline-raised bg-raised">
      <div className="flex h-10 items-center justify-between px-4">
        <h2 className="text-[11px] font-semibold tracking-[0.06em] text-text-2 uppercase">
          {title}
        </h2>
        <span className="text-xs text-text-3 tabular-nums">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
        </span>
      </div>
      <table aria-label={title} className="w-full table-fixed border-collapse text-[13px]">
        <colgroup>
          <col className="w-[16%]" />
          <col className="w-[15%]" />
          <col className="w-[13%]" />
          <col className="w-[11%]" />
          <col />
          <col className="w-[15%]" />
        </colgroup>
        <thead>
          <tr className="h-8 text-left text-xs text-text-3">
            {HEADS.map((h) => (
              <th key={h} scope="col" className="px-4 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <Row key={job.id} job={job} now={now} tz={tz} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
