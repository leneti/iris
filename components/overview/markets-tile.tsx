'use client';

import { ChartLine } from 'lucide-react';
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { StandaloneWidget } from '@/lib/shared/contract';
import { formatStat, isFailed, Unavailable } from './figures';

export type Interval = StandaloneWidget['interval'];

export const INTERVALS: readonly { value: Interval; label: string; short: string }[] = [
  { value: '1h', label: '1 hour', short: '1 hour' },
  { value: '24h', label: '1 day', short: '1 day' },
  { value: '7d', label: '7 days', short: '7 days' },
  { value: '30d', label: '30 days', short: '30 days' },
];

/** "+1.2 %" or "−3.4 %": a sign carries the direction, so no status colour is used. */
export function formatChange(percent: number | null | undefined): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return '—';
  const rounded = Math.round(Math.abs(percent) * 10) / 10;
  const sign = percent < 0 && rounded !== 0 ? '−' : '+';
  return `${sign}${rounded} %`;
}

/**
 * The standalone "Markets" tile. All four intervals arrive in one reply, so the control only
 * picks which one to show. It never fetches.
 */
export function MarketsTile({ widget }: { widget: StandaloneWidget }) {
  const [interval, setInterval] = useState<Interval>(widget.interval);
  const failed = isFailed(widget.state);
  return (
    <div
      role="group"
      aria-label={widget.name}
      className="flex min-h-[52px] flex-col justify-center rounded-menu border border-hairline-raised bg-raised px-3 py-2"
    >
      <div className="flex h-7 items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-tile bg-selected text-text-2"
        >
          <ChartLine className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">{widget.name}</span>
        {!failed && (
          <Select value={interval} onValueChange={(v) => setInterval(v as Interval)}>
            <SelectTrigger
              size="sm"
              aria-label="Interval"
              className="h-6 gap-1 px-2 py-0 text-xs text-text"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {INTERVALS.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="mt-1.5 min-h-[30px]">
        {failed ? (
          <Unavailable />
        ) : (
          <ul
            className="grid gap-x-2"
            style={{ gridTemplateColumns: `repeat(${widget.stats.length}, minmax(0, 1fr))` }}
          >
            {widget.stats.map((s) => (
              <li key={s.key} className="min-w-0">
                <div className="text-[13px] font-semibold tabular-nums">{formatStat(s)}</div>
                <div className="text-[11px] whitespace-nowrap text-text-3 tabular-nums">
                  {s.key} · {formatChange(s.changePercent?.[interval])}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
