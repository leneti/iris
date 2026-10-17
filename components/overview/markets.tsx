'use client';

import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { StandaloneWidget } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';
import { formatStat, isFailed, Unavailable } from './figures';
import { Panel } from './panel';

export type Interval = StandaloneWidget['interval'];

export const INTERVALS: readonly { value: Interval; label: string; short: string }[] = [
  { value: '1h', label: '1 hour', short: '1 hour' },
  { value: '24h', label: '1 day', short: '1 day' },
  { value: '7d', label: '7 days', short: '7 days' },
  { value: '30d', label: '30 days', short: '30 days' },
];

/** "+1.2 %" or "−3.4 %": the sign carries the direction, so it still reads without colour. */
export function formatChange(percent: number | null | undefined): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return '—';
  const rounded = Math.round(Math.abs(percent) * 10) / 10;
  const sign = percent < 0 && rounded !== 0 ? '−' : '+';
  return `${sign}${rounded} %`;
}

/** A change that rounds to zero, or no figure at all, is flat. */
export function direction(percent: number | null | undefined): 'up' | 'down' | 'flat' {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 'flat';
  if (Math.round(Math.abs(percent) * 10) === 0) return 'flat';
  return percent > 0 ? 'up' : 'down';
}

/** The change as a small pill: green with an up arrow, red with a down arrow, grey when flat. */
export function Change({ percent }: { percent: number | null | undefined }) {
  const dir = direction(percent);
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : null;
  return (
    <span
      data-direction={dir}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-row px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums',
        dir === 'up' && 'bg-tint-healthy text-status-healthy-text',
        dir === 'down' && 'bg-tint-unhealthy text-status-unhealthy-text',
        dir === 'flat' && 'bg-selected text-text-2',
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {formatChange(percent)}
    </span>
  );
}

/** One coin: the name in full weight with its symbol, then the price and the change. */
export function CoinRow({
  stat,
  interval,
  className,
}: {
  stat: StandaloneWidget['stats'][number];
  interval: Interval;
  className?: string;
}) {
  return (
    <li className={cn('flex items-center gap-2', className)}>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate font-semibold text-text">{stat.label}</span>
        <span className="text-[11px] font-medium text-text-3">{stat.key}</span>
      </span>
      <span className="font-semibold tabular-nums">{formatStat(stat)}</span>
      <Change percent={stat.changePercent?.[interval]} />
    </li>
  );
}

/**
 * A standalone widget as a card in the side column (the phone's Overview column on a phone), one
 * row per coin. All four intervals arrive in one reply, so the control only picks which one to
 * show. It never fetches. `touch` gives 44 px rows and control for a phone.
 */
export function MarketsCard({
  widget,
  touch = false,
}: {
  widget: StandaloneWidget;
  touch?: boolean;
}) {
  const [interval, setInterval] = useState<Interval>(widget.interval);
  const failed = isFailed(widget.state);
  return (
    <Panel
      title={widget.name}
      meta={
        failed ? undefined : (
          <Select value={interval} onValueChange={(v) => setInterval(v as Interval)}>
            <SelectTrigger
              size="sm"
              aria-label="Interval"
              className={cn(
                'gap-1 text-text',
                touch ? 'px-3 text-[13px] data-[size=sm]:h-11' : 'px-2 text-xs data-[size=sm]:h-7',
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {INTERVALS.map((i) => (
                <SelectItem key={i.value} value={i.value} className={cn(touch && 'min-h-11')}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    >
      {failed ? (
        <div className="px-4 pb-4">
          <Unavailable />
        </div>
      ) : (
        <ul>
          {widget.stats.map((s) => (
            <CoinRow
              key={s.key}
              stat={s}
              interval={interval}
              className={cn(
                'border-t border-hairline-raised px-4',
                touch ? 'min-h-11 gap-3' : 'min-h-10 text-[13px]',
              )}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
