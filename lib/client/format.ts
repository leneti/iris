// Display formatting. Plain spaces between figure and unit; the UI adds whitespace-nowrap and
// tabular numerals. Decimal units (kB, MB, GB, TB), as in the placeholder figures of handoff 12.1.
const DASH = '—';

function valid(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

// 100 and over: whole numbers; below: one decimal, with a trailing ".0" dropped.
function figure(n: number): string {
  if (n >= 100) return String(Math.round(n));
  return String(Math.round(n * 10) / 10);
}

function scale(n: number, units: readonly string[]): string {
  let value = n;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i += 1;
  }
  // 999.96 rounds up to 1000: step to the next unit instead of printing "1000 kB".
  if (Math.round(value * 10) / 10 >= 1000 && i < units.length - 1) {
    value /= 1000;
    i += 1;
  }
  return `${i === 0 ? String(Math.round(value)) : figure(value)} ${units[i]}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  return valid(bytes) ? scale(bytes, ['B', 'kB', 'MB', 'GB', 'TB', 'PB']) : DASH;
}

export function formatRate(bitsPerSec: number | null | undefined): string {
  return valid(bitsPerSec) ? scale(bitsPerSec, ['b/s', 'Kb/s', 'Mb/s', 'Gb/s', 'Tb/s']) : DASH;
}

export function formatPercent(percent: number | null | undefined): string {
  return typeof percent === 'number' && Number.isFinite(percent)
    ? `${Math.round(percent)} %`
    : DASH;
}

function parts(seconds: number): string {
  const total = Math.floor(seconds);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return `${total} s`;
}

/** Time since something happened, in seconds: "5 s ago", "11 min ago", "3 h 21 min ago". */
export function formatAge(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return DASH;
  if (seconds < 5) return 'just now';
  return `${seconds < 60 ? `${Math.floor(seconds)} s` : parts(seconds)} ago`;
}

/** A length of time, in seconds: "12 d 4 h" (uptime). */
export function formatDuration(seconds: number | null | undefined): string {
  return valid(seconds) ? parts(seconds) : DASH;
}

/** The zone itself, or UTC when it is empty or not a real zone. */
export function zone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** "10:15" in the given zone, 24-hour. */
export function clock(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone(tz),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
