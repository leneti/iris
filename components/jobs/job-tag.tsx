import { Check, CircleHelp, EyeOff, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CronJob } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';

export type TagKind = 'failed' | 'overdue' | 'warning' | 'success' | 'unknown' | 'not-monitored';

/** What a job's result column says. A flag of failed or overdue wins over the last result. */
export function tagKind(job: CronJob): TagKind {
  if (job.flag === 'failed') return 'failed';
  if (job.flag === 'overdue') return 'overdue';
  if (job.flag === 'warning' || job.result === 'warning') return 'warning';
  if (job.result === 'failed') return 'failed';
  if (job.result === 'success') return 'success';
  if (job.kind === 'maintenance' && job.lastRun === null) return 'not-monitored';
  return 'unknown';
}

const LOOK: Record<TagKind, { text: string; icon: ReactNode; cls: string }> = {
  failed: {
    text: 'Failed',
    icon: <X className="size-3" />,
    cls: 'bg-tint-unhealthy text-status-unhealthy-text ring-tag-line-unhealthy',
  },
  overdue: {
    text: 'Overdue',
    icon: <TriangleAlert className="size-3" />,
    cls: 'bg-tint-degraded text-status-degraded-text ring-tag-line-degraded',
  },
  warning: {
    text: 'Warning',
    icon: <TriangleAlert className="size-3" />,
    cls: 'bg-tint-degraded text-status-degraded-text ring-tag-line-degraded',
  },
  success: {
    text: 'Success',
    icon: <Check className="size-3" />,
    cls: 'bg-tint-healthy text-status-healthy-text ring-tag-line-healthy',
  },
  unknown: {
    text: 'Unknown',
    icon: <CircleHelp className="size-3" />,
    cls: 'bg-hover-raised text-text-2 ring-hairline-strong',
  },
  'not-monitored': {
    text: 'Not monitored',
    icon: <EyeOff className="size-3" />,
    cls: 'bg-raised text-text-2 ring-control',
  },
};

export function JobTag({
  kind,
  label,
  className,
}: {
  kind: TagKind;
  /** Replaces the default word, for a count such as "1 failed". */
  label?: string;
  className?: string;
}) {
  const look = LOOK[kind];
  return (
    <span
      data-kind={kind}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-row px-1.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset',
        look.cls,
        className,
      )}
    >
      {look.icon}
      {label ?? look.text}
    </span>
  );
}
