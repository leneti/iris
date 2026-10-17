import { formatBytes } from '@/lib/client/format';
import type { Stat, WidgetState } from '@/lib/shared/contract';

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
