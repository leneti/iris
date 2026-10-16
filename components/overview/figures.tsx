import { TriangleAlert } from 'lucide-react';
import { formatBytes } from '@/lib/client/format';
import type { Stat, WidgetState } from '@/lib/shared/contract';

const MAX_FIGURES = 4;

function currency(value: number, code: string): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: value >= 100 ? 0 : 2,
      minimumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value} ${code}`;
  }
}

/** One figure as text: counts with thousands separators, "100+" at a page limit, rates, prices. */
export function formatStat(stat: Pick<Stat, 'value' | 'unit' | 'atLeast'>): string {
  const { value, unit } = stat;
  if (typeof value === 'string') return value.charAt(0).toUpperCase() + value.slice(1);
  if (unit === 'bytes-per-second') return `${formatBytes(value)}/s`;
  if (unit === 'percent') return `${Math.round(value)} %`;
  if (unit !== null && /^[A-Z]{3}$/.test(unit)) return currency(value, unit);
  return `${value.toLocaleString('en-GB')}${stat.atLeast ? '+' : ''}`;
}

/** A read that did not work: unreachable, unauthorized or rate-limited. Decided from `state`. */
export function isFailed(state: WidgetState): boolean {
  return state === 'unreachable' || state === 'unauthorized' || state === 'rate-limited';
}

export function Unavailable() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-text-2">
      <TriangleAlert aria-hidden className="size-3.5 text-status-degraded" />
      Data unavailable
    </p>
  );
}

/** Up to four figures in equal columns: a value over a small label. */
export function Figures({ stats }: { stats: Stat[] }) {
  const shown = stats.slice(0, MAX_FIGURES);
  return (
    <dl
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}
    >
      {shown.map((s) => {
        // A rate is split so the column stays narrow: the number over "↓ MB/s".
        const rate = s.unit === 'bytes-per-second' && typeof s.value === 'number';
        const [num, unit] = rate ? formatStat(s).split(' ') : [formatStat(s), ''];
        const arrow = s.key === 'download' ? '↓ ' : s.key === 'upload' ? '↑ ' : '';
        return (
          <div key={s.key} className="min-w-0">
            <dd className="truncate text-[13px] font-semibold tabular-nums">{num}</dd>
            <dt className="truncate text-[11px] text-text-3">
              {rate ? `${arrow}${unit}` : s.label}
            </dt>
          </div>
        );
      })}
    </dl>
  );
}
