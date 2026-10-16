'use client';

import { Clock } from 'lucide-react';
import type { CronResponse } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';

export type JobsPillState = { tone: 'neutral' | 'amber' | 'red'; text: string };

/** True when /api/cron reports its cron-status source as unreachable. */
export function cronUnreachable(cron: CronResponse | undefined): boolean {
  return cron?.sources.some((s) => s.id === 'cron-status' && s.state === 'unreachable') ?? false;
}

export function jobsPill(cron: CronResponse | undefined, unreachable: boolean): JobsPillState {
  if (unreachable) return { tone: 'amber', text: 'Jobs · unavailable' };
  if (!cron) return { tone: 'neutral', text: 'Jobs' };
  const { failed, overdue, warning } = cron.summary;
  if (failed > 0) return { tone: 'red', text: `Jobs · ${failed} failed` };
  if (overdue > 0) return { tone: 'amber', text: `Jobs · ${overdue} overdue` };
  if (warning > 0) return { tone: 'amber', text: `Jobs · ${warning} warning` };
  return { tone: 'neutral', text: 'Jobs' };
}

const TONE: Record<JobsPillState['tone'], string> = {
  neutral: 'bg-hover text-text-2 ring-hairline-strong',
  amber: 'bg-raised text-status-degraded-text ring-status-degraded',
  red: 'bg-raised text-status-unhealthy-text ring-status-unhealthy',
};

/** The strip's Jobs pill: red for failed, amber for overdue, warning or unreachable cron-status. */
export function JobsPill({ cron, onOpen }: { cron: CronResponse | undefined; onOpen: () => void }) {
  const state = jobsPill(cron, cronUnreachable(cron));
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex h-5 shrink-0 items-center gap-1 rounded-row px-1.5 text-[11px] font-medium ring-1 ring-inset outline-none focus-visible:ring-2 focus-visible:ring-ring',
        TONE[state.tone],
      )}
    >
      <Clock className="size-3" />
      {state.text}
    </button>
  );
}
