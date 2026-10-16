'use client';

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { formatChange, INTERVALS, type Interval } from '@/components/overview/markets-tile';
import { formatStat, isFailed, Unavailable } from '@/components/overview/figures';
import { Panel } from '@/components/overview/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LinkEntry, StandaloneWidget } from '@/lib/shared/contract';

/**
 * A standalone tile as a card with one 44 px row per coin: name, symbol, price and the change.
 * The interval control only picks which of the four intervals in the reply to show.
 */
export function MarketsCard({ widget }: { widget: StandaloneWidget }) {
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
              className="data-[size=sm]:h-11 gap-1 px-3 text-[13px] text-text"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {INTERVALS.map((i) => (
                <SelectItem key={i.value} value={i.value} className="min-h-11">
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
            <li
              key={s.key}
              className="flex min-h-11 items-center gap-2 border-t border-hairline-raised px-4"
            >
              <span className="min-w-0 flex-1 truncate">
                {s.label} <span className="ml-1 text-xs text-text-3">{s.key}</span>
              </span>
              <span className="font-semibold tabular-nums">{formatStat(s)}</span>
              <span className="w-16 text-right text-text-2 tabular-nums">
                {formatChange(s.changePercent?.[interval])}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** One 48 px row per link: a badge, the name, the hostname under it, and the "leaves Iris" mark. */
export function LinksCard({ links }: { links: LinkEntry[] }) {
  if (links.length === 0) return null;
  return (
    <Panel title="Links" meta="open in the browser">
      <ul>
        {links.map((l) => (
          <li key={l.url} className="border-t border-hairline-raised">
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-12 items-center gap-3 px-4 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-tile bg-selected text-[11px] font-semibold text-text-2"
              >
                {l.abbr}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{l.name}</span>
                <span className="block truncate text-xs text-text-3">{host(l.url)}</span>
              </span>
              <ExternalLink
                aria-label="Opens in the browser"
                className="size-4 shrink-0 text-text-3"
              />
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
