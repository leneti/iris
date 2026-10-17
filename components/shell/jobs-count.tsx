'use client';

import { cn } from '@/lib/utils';

export type JobsBadge = { failed: number; overdue: number };

export function JobsCount({ jobs, className }: { jobs: JobsBadge; className?: string }) {
  const count = jobs.failed + jobs.overdue;
  if (count === 0) return null;
  return (
    <span
      aria-label={`${count} jobs need attention`}
      className={cn(
        'flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums text-status-on-solid',
        jobs.failed > 0 ? 'bg-status-unhealthy' : 'bg-status-degraded',
        className,
      )}
    >
      {count}
    </span>
  );
}
