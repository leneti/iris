// The reading: one pure derivation from the five polled responses to everything the Overview
// draws (sentence, meters, ball, circle, hours, omens, footer). No React, no `server-only`.
import { clock, formatBytes, formatDuration } from './format';
import { isDown } from './health';
import type { Source } from './source-health';
import { formatStat, isFailed } from './stats';
import { compassPoint, conditionWord, isWindy } from './weather';
import type {
  CronJob,
  CronResponse,
  ServiceEntry,
  ServicesResponse,
  StatusResponse,
  SystemResponse,
  WidgetsResponse,
} from '@/lib/shared/contract';

export type { Source } from './source-health';

export type ReadingInput = {
  services?: ServicesResponse;
  status?: StatusResponse;
  cron?: CronResponse;
  system?: SystemResponse;
  widgets?: WidgetsResponse;
  now: Date;
  /** The viewer's IANA zone, for the greeting; the machine's own when absent. */
  timeZone?: string;
  unavailable: ReadonlySet<Source>;
};

export type Target =
  | { tab: string }
  | { href: string }
  | { anchor: 'circle' | 'hours' | 'host' | 'sky' };
export type Segment = { text: string; kind?: 'fact' | 'bad' | 'strain'; target?: Target };
export type BallState = {
  color: '#f25bd0' | '#ff7a6b';
  motion: 'rise' | 'fall';
  crackle: number;
  sparks: number;
  flares: number;
  speed: number;
  fill: number;
};
export type ChipState = 'ok' | 'warn' | 'down' | 'idle';
export type Chip = {
  id: string;
  name: string;
  service: ServiceEntry;
  figure: string | null;
  state: ChipState;
};
export type CircleGroup = { name: string; chips: Chip[] };
export type CircleRow =
  | { kind: 'group'; group: CircleGroup }
  | { kind: 'pair'; groups: CircleGroup[] };
export type Meter = { label: string; value: string; percent: number | null; hot: boolean };
/** The fullest disk: its printed figure, the bar's width, and used of total when known. */
export type Storage = { value: string; percent: number; space: string | null; hot: boolean };
export type HourRow =
  | { kind: 'done' | 'fail' | 'idle'; time: string; name: string; note: string }
  | { kind: 'gap'; text: string }
  | { kind: 'now'; time: string }
  | { kind: 'next'; time: string; name: string; note: string; failed: boolean };
export type Reading = {
  pending: boolean;
  wrong: boolean;
  straining: boolean;
  long: boolean;
  eyebrow: 'the reading' | 'a disturbance';
  segments: Segment[];
  colour: string;
  meters: { cpu: Meter; memory: Meter };
  ball: BallState;
  /** `loading`: no services yet, so nothing to draw but a placeholder block. */
  circle: { shown: number | null; rows: CircleRow[] } | { unavailable: true } | { loading: true };
  /** `loading`: the cron answer has not arrived (and has not failed); `unavailable`: it failed. */
  hours: { rows: HourRow[] } | { unavailable: true } | { loading: true };
  /** Per omen: `null` is absent (nothing to show), `loading` is not known yet. */
  omens: {
    markets:
      | { unavailable: true }
      | { loading: true }
      | {
          lines: {
            name: string;
            move: { dir: 'rose' | 'fell'; pct: string } | null;
            price: string;
          }[];
        }
      | null;
    host:
      | { unavailable: true }
      | { loading: true }
      | { word: 'Calm' | 'Straining'; parts: string[]; storage: Storage | null };
    sky: { unavailable: true } | { loading: true } | { text: string } | null;
  };
  foot: { links: { name: string; url: string }[]; quiet: string[] };
};

const DASH = '—';
const PINK = '#f25bd0';
const CORAL = '#ff7a6b';
const LONG_READING = 320;
const BLIND = "I can't see the services right now.";

// ---- small exports ----

const POOLS = {
  morning: ['Good morning.', 'Morning!', 'New orbit, new possibilities.'],
  afternoon: ['Good afternoon.', 'Afternoon!', 'Mid-day quadrant reached.'],
  evening: ['Good evening.', 'Evening!', 'Entering off-duty hours.'],
  late: ['Late-night viewing?', 'Stargazing hours.', 'Settle in for the night.'],
  small: ['Deep space silence.', 'Quiet hours.', 'Even the cron jobs are asleep.'],
} as const;

type Band = keyof typeof POOLS;

function band(h: number): Band {
  if (h >= 22 || h < 2) return 'late';
  if (h < 5) return 'small';
  if (h < 11) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const two = (n: number) => String(n).padStart(2, '0');

type Clock = { hour: number; date: string };

const zoned = new Map<string, Intl.DateTimeFormat>();

/** Hour and calendar date of `at` in `timeZone`, or in the machine's own zone when there is none. */
function clockIn(at: Date, timeZone: string | undefined): Clock {
  if (timeZone !== undefined) {
    try {
      let format = zoned.get(timeZone);
      if (!format) {
        format = new Intl.DateTimeFormat('en-GB', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          hourCycle: 'h23',
        });
        zoned.set(timeZone, format);
      }
      const parts = format.formatToParts(at);
      const part = (type: string) => parts.find((p) => p.type === type)?.value;
      return {
        hour: Number(part('hour')),
        date: `${part('year')}-${part('month')}-${part('day')}`,
      };
    } catch {
      // An unknown zone reads the clock the way no zone does.
    }
  }
  return {
    hour: at.getHours(),
    date: `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`,
  };
}

/**
 * Stable within a band, different from day to day. 00:00-01:59 belongs to the evening before.
 * `timeZone` is the viewer's IANA zone; without one the machine's own is used.
 */
export function greeting(now: Date, timeZone?: string): string {
  const b = band(clockIn(now, timeZone).hour);
  const { date } = clockIn(new Date(now.getTime() - 2 * 3_600_000), timeZone);
  const pool = POOLS[b];
  return pool[fnv1a(`${date}|${b}`) % pool.length] ?? pool[0];
}

/** The URL itself when it is http or https, otherwise null (config-supplied links can be anything). */
export function safeHref(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url === '') return null;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const WORDS =
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(
    ' ',
  );

/** 'one' to 'twenty', then digits. */
export function hourWord(n: number): string {
  return n >= 1 && n <= 20 ? (WORDS[n] ?? String(n)) : String(n);
}

// ---- figures ----

const num = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

type Figures = {
  cpu: number | null;
  memory: number | null;
  temp: number | null;
  uptime: number | null;
  disks: { label: string; percent: number; used: number | null; total: number | null }[];
};

/** Figures from a system response that is there and says it is ok; otherwise all missing. */
function figuresOf(system: SystemResponse | undefined): Figures | null {
  if (!system || system.source.state !== 'ok') return null;
  return {
    cpu: num(system.cpu.percent),
    memory: num(system.memory.percent),
    temp: num(system.temperature?.celsius),
    uptime: num(system.uptimeSeconds),
    disks: system.disks.flatMap((d) => {
      const percent = num(d.percent);
      return percent === null
        ? []
        : [{ label: d.label, percent, used: num(d.usedBytes), total: num(d.totalBytes) }];
    }),
  };
}

function strainParts(f: Figures | null): string[] {
  if (!f) return [];
  const parts: string[] = [];
  // Compare the figure as it is printed, so "straining: CPU at 70%" can never happen.
  if (f.cpu !== null && Math.round(f.cpu) > 70) parts.push(`CPU at ${Math.round(f.cpu)}%`);
  if (f.memory !== null && Math.round(f.memory) > 80)
    parts.push(`memory at ${Math.round(f.memory)}%`);
  if (f.temp !== null && Math.round(f.temp) > 80) parts.push(`running at ${Math.round(f.temp)}°`);
  for (const d of f.disks)
    if (Math.round(d.percent) > 90) parts.push(`${d.label} at ${Math.round(d.percent)}% full`);
  return parts;
}

function meterOf(label: string, value: number | null, limit: number): Meter {
  return value === null
    ? { label, value: DASH, percent: null, hot: false }
    : {
        label,
        value: `${Math.round(value)}%`,
        percent: clamp(value, 0, 100),
        hot: Math.round(value) > limit,
      };
}

function ballFor(f: Figures | null, wrong: boolean): BallState {
  const c = clamp(f?.cpu ?? 0, 0, 100) / 100;
  return {
    color: wrong ? CORAL : PINK,
    motion: wrong ? 'fall' : 'rise',
    crackle: 0.12 + 0.88 * c,
    sparks: 0.2 + 0.8 * c,
    flares: 0.4 + 0.6 * c,
    speed: 0.8 + 1.4 * c,
    fill: clamp(f?.memory ?? 0, 0, 100) / 100,
  };
}

// ---- services ----

type Seen = {
  all: ServiceEntry[];
  visible: ServiceEntry[];
  hidden: ServiceEntry[];
  visibleDown: ServiceEntry[];
  hiddenDown: ServiceEntry[];
};

function seen(services: ServicesResponse | undefined, status: StatusResponse | undefined): Seen {
  const all = services?.groups.flatMap((g) => g.services) ?? [];
  const down = (s: ServiceEntry) => isDown(status?.services[s.id]?.status);
  const visible = all.filter((s) => !s.hidden);
  const hidden = all.filter((s) => s.hidden);
  return {
    all,
    visible,
    hidden,
    visibleDown: visible.filter(down),
    hiddenDown: hidden.filter(down),
  };
}

function silent(names: string[]): string {
  if (names.length === 1) return `${names[0]} has fallen silent`;
  if (names.length === 2) return `${names[0]} and ${names[1]} have fallen silent`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more have fallen silent`;
}

// ---- time ----

const ms = (iso: string | null): number | null => {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

function hhmm(iso: string | null, tz: string): string | null {
  if (ms(iso) === null || iso === null) return null;
  try {
    return clock(iso, tz);
  } catch {
    return null;
  }
}

const compare = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

// ---- sentences ----

type Ctx = {
  now: Date;
  timeZone: string | undefined;
  blind: boolean;
  wrong: boolean;
  seen: Seen;
  failed: CronJob[];
  timezone: string;
  figures: Figures | null;
  strain: string[];
  weather: WidgetsResponse['weather'];
};

const plain = (text: string): Segment => ({ text });
const fact = (text: string, target?: Target): Segment =>
  target ? { text, kind: 'fact', target } : { text, kind: 'fact' };
const bad = (text: string, target: Target): Segment => ({ text, kind: 'bad', target });

function failures(c: Ctx): Segment[] {
  return c.failed.flatMap((j) => {
    const at = hhmm(j.lastRun, c.timezone);
    const href = safeHref(j.link);
    const target: Target = href ? { href } : { anchor: 'hours' };
    return [
      plain(' '),
      bad(at ? `${j.name} failed at ${at}` : `${j.name} failed`, target),
      plain('.'),
    ];
  });
}

function allWell(c: Ctx): Segment[] {
  const { visible, hidden } = c.seen;
  const head = fact(`All ${visible.length} of your services`, { anchor: 'circle' });
  return hidden.length > 0
    ? [
        head,
        plain(' are well, and '),
        fact(`${hidden.length} more`),
        plain(' are watched quietly.'),
      ]
    : [head, plain(' are well.')];
}

function lead(c: Ctx): Segment[] {
  const { visible, visibleDown, hiddenDown } = c.seen;
  const wrong = plain('Something is wrong.');
  if (c.blind) {
    return c.wrong
      ? [wrong, ...failures(c), plain(` ${BLIND}`)]
      : [plain(`${greeting(c.now, c.timeZone)} ${BLIND}`)];
  }
  if (visibleDown.length > 0) {
    const first = visibleDown[0];
    return [
      wrong,
      plain(' '),
      bad(silent(visibleDown.map((s) => s.name)), { tab: first?.id ?? '' }),
      plain(', and '),
      fact(`${visible.length - visibleDown.length} of your ${visible.length}`, {
        anchor: 'circle',
      }),
      plain(' are still well.'),
      ...failures(c),
    ];
  }
  if (hiddenDown.length > 0) {
    const first = hiddenDown[0];
    return [
      wrong,
      plain(' '),
      bad(silent(hiddenDown.map((s) => s.name)), { tab: first?.id ?? '' }),
      plain(`, ${hourWord(hiddenDown.length)} of those watched quietly.`),
      ...failures(c),
      plain(' '),
      ...allWell(c),
    ];
  }
  if (c.failed.length > 0) return [wrong, ...failures(c), plain(' '), ...allWell(c)];
  return [plain(`${greeting(c.now, c.timeZone)} `), ...allWell(c)];
}

function hostSentence(c: Ctx): Segment[] {
  if (!c.figures) return [];
  const target: Target = { anchor: 'host' };
  return c.strain.length > 0
    ? [
        plain(' The host is '),
        { text: `straining: ${c.strain.join(', ')}`, kind: 'strain', target },
        plain('.'),
      ]
    : [plain(' '), fact('The host is calm', target), plain('.')];
}

/** The full wind for the sky omen: ", wind 5 m/s from the SW (gusts 9)"; "" when unknown. */
function windFull(w: NonNullable<WidgetsResponse['weather']>): string {
  if (w.windSpeed === null) return '';
  const speed = Math.round(w.windSpeed);
  if (speed === 0) return ', no wind';
  const from = w.windDirection === null ? '' : ` from the ${compassPoint(w.windDirection)}`;
  const gusts =
    w.windGusts !== null && Math.round(w.windGusts) > speed
      ? ` (gusts ${Math.round(w.windGusts)})`
      : '';
  return `, wind ${speed} ${w.windUnit}${from}${gusts}`;
}

/** The reading's short wind: ", windy from the SW" when it is windy, else "". */
function windShort(w: NonNullable<WidgetsResponse['weather']>): string {
  if (!isWindy(w)) return '';
  return w.windDirection === null ? ', windy' : `, windy from the ${compassPoint(w.windDirection)}`;
}

function weatherText(w: WidgetsResponse['weather'], full: boolean): string | null {
  if (!w || w.state !== 'ok' || w.temperature === null) return null;
  const deg = full ? (w.unit === 'celsius' ? '°C' : '°F') : '°';
  const wind = full ? windFull(w) : windShort(w);
  return `${conditionWord(w.condition)} over ${w.label}, ${Math.round(w.temperature)}${deg}${wind}`;
}

function weatherSentence(c: Ctx): Segment[] {
  const text = weatherText(c.weather, false);
  return text === null ? [] : [plain(' '), fact(text, { anchor: 'sky' }), plain('.')];
}

function merge(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && !last.kind && !last.target && !s.kind && !s.target) {
      out[out.length - 1] = { text: last.text + s.text };
    } else if (s.text !== '') {
      out.push(s);
    }
  }
  return out;
}

// ---- circle ----

function chipState(status: StatusResponse | undefined, id: string): ChipState {
  switch (status?.services[id]?.status) {
    case 'healthy':
    case 'starting':
      return 'ok';
    case 'degraded':
      return 'warn';
    case 'unhealthy':
      return 'down';
    default:
      return 'idle';
  }
}

function circle(
  services: ServicesResponse | undefined,
  status: StatusResponse | undefined,
  widgets: WidgetsResponse | undefined,
): { shown: number; rows: CircleRow[] } {
  const groups: CircleGroup[] = [];
  for (const g of services?.groups ?? []) {
    const chips = g.services
      .filter((s) => !s.hidden)
      .map((s): Chip => {
        const w = widgets?.services[s.id];
        const stat = w?.state === 'ok' ? w.stats[0] : undefined;
        return {
          id: s.id,
          name: s.name,
          service: s,
          figure: stat ? formatStat(stat) : null,
          state: chipState(status, s.id),
        };
      });
    if (chips.length > 0) groups.push({ name: g.name, chips });
  }
  // A run of consecutive one-service groups shares one pair row.
  const rows: CircleRow[] = [];
  for (const group of groups) {
    const last = rows[rows.length - 1];
    if (group.chips.length !== 1) rows.push({ kind: 'group', group });
    else if (last?.kind === 'pair') last.groups.push(group);
    else rows.push({ kind: 'pair', groups: [group] });
  }
  return { shown: groups.reduce((n, g) => n + g.chips.length, 0), rows };
}

// ---- hours ----

function hours(cron: CronResponse | undefined, now: Date, down: boolean): Reading['hours'] {
  if (down) return { unavailable: true };
  if (!cron) return { loading: true };
  // Every source down and no job has ever been seen to run (a stale host file leaves only "unknown"
  // rows): the schedule is not answering, rather than a list of dashes.
  if (
    cron.sources.length > 0 &&
    cron.sources.every((s) => s.state === 'unreachable' || s.state === 'stale') &&
    cron.sources.some((s) => s.state === 'unreachable') &&
    cron.jobs.every((j) => j.lastRun === null && j.result === 'unknown')
  ) {
    return { unavailable: true };
  }
  const tz = cron.timezone;
  const at = (iso: string | null) => hhmm(iso, tz) ?? DASH;
  const rows: HourRow[] = [];

  const maintenance = cron.jobs
    .filter((j) => j.kind === 'maintenance')
    .sort((a, b) => compare(ms(a.lastRun) ?? -Infinity, ms(b.lastRun) ?? -Infinity));
  for (const j of maintenance) {
    const kind = j.result === 'success' ? 'done' : j.result === 'failed' ? 'fail' : 'idle';
    const note = j.result === 'success' ? 'ok' : j.result;
    rows.push({ kind, time: at(j.lastRun), name: j.name, note });
  }

  const latest = Math.max(-Infinity, ...maintenance.map((j) => ms(j.lastRun) ?? -Infinity));
  const quiet = Number.isFinite(latest) ? Math.floor((now.getTime() - latest) / 3_600_000) : 0;
  if (quiet >= 1) {
    rows.push({ kind: 'gap', text: `${hourWord(quiet)} quiet hour${quiet === 1 ? '' : 's'}` });
  }

  let nowTime = DASH;
  try {
    nowTime = clock(now.toISOString(), tz);
  } catch {
    // An invalid `now` leaves the dash.
  }
  rows.push({ kind: 'now', time: nowTime });

  const user = cron.jobs
    .filter((j) => j.kind === 'user')
    .sort((a, b) => compare(ms(a.nextDue) ?? Infinity, ms(b.nextDue) ?? Infinity));
  for (const j of user) {
    const failed = j.result === 'failed';
    const last = hhmm(j.lastRun, tz);
    rows.push({
      kind: 'next',
      time: at(j.nextDue),
      name: j.name,
      note: failed ? `failed ${last ?? DASH}` : last ? `last ${last}` : DASH,
      failed,
    });
  }
  return { rows };
}

// ---- omens ----

function markets(widgets: WidgetsResponse | undefined, down: boolean): Reading['omens']['markets'] {
  if (down) return null;
  // No widgets data yet: whether markets are configured is unknown, so one group is reserved.
  if (!widgets) return { loading: true };
  const mine = widgets.standalone.filter((w) => w.type === 'coinmarketcap') ?? [];
  if (mine.length === 0) return null;
  const lines = mine
    .filter((w) => !isFailed(w.state))
    .flatMap((w) =>
      w.stats.map((stat) => {
        const change = num(stat.changePercent?.['24h']);
        return {
          name: stat.label,
          move:
            change === null
              ? null
              : {
                  dir: change >= 0 ? ('rose' as const) : ('fell' as const),
                  pct: Math.abs(change).toFixed(2),
                },
          price: formatStat(stat),
        };
      }),
    );
  if (lines.length > 0) return { lines };
  return mine.some((w) => isFailed(w.state)) ? { unavailable: true } : null;
}

/** The fullest disk as a meter; hot on the same "over 90%" as the straining sentence. */
function storageOf(disks: Figures['disks']): Storage | null {
  if (disks.length === 0) return null;
  const d = disks.reduce((a, b) => (b.percent > a.percent ? b : a));
  return {
    value: `${Math.round(d.percent)}%`,
    percent: clamp(d.percent, 0, 100),
    space:
      d.used !== null && d.total !== null
        ? `${formatBytes(d.used)} of ${formatBytes(d.total)}`
        : null,
    hot: Math.round(d.percent) > 90,
  };
}

function hostOmen(
  f: Figures | null,
  straining: boolean,
  loading: boolean,
): Reading['omens']['host'] {
  if (loading) return { loading: true };
  if (!f) return { unavailable: true };
  const parts: string[] = [];
  if (f.cpu !== null) parts.push(`CPU ${Math.round(f.cpu)}%`);
  if (f.memory !== null) parts.push(`memory ${Math.round(f.memory)}%`);
  if (f.temp !== null) parts.push(`${Math.round(f.temp)}°C`);
  if (f.uptime !== null) parts.push(`up ${formatDuration(f.uptime)}`);
  return { word: straining ? 'Straining' : 'Calm', parts, storage: storageOf(f.disks) };
}

function sky(widgets: WidgetsResponse | undefined, down: boolean): Reading['omens']['sky'] {
  if (down) return { unavailable: true };
  if (!widgets) return { loading: true };
  const w = widgets.weather;
  if (!w) return null;
  const text = weatherText(w, true);
  if (text !== null) return { text: `${text}.` };
  return isFailed(w.state) ? { unavailable: true } : null;
}

// ---- the reading ----

export function deriveReading(input: ReadingInput): Reading {
  const { now, unavailable } = input;
  const use = <T>(source: Source, value: T | undefined): T | undefined =>
    unavailable.has(source) ? undefined : value;
  const services = use('services', input.services);
  const status = use('status', input.status);
  const cron = use('cron', input.cron);
  const widgets = use('widgets', input.widgets);
  const figures = figuresOf(use('system', input.system));

  const s = seen(services, status);
  const blind =
    unavailable.has('services') ||
    unavailable.has('status') ||
    input.status?.docker === 'unreachable' ||
    (services !== undefined && s.visible.length === 0);
  const pending = !blind && (services === undefined || status === undefined);
  // Still on its way: no data and not failing. (An unavailable source reads as such, not as loading.)
  const loading = (source: Source) => input[source] === undefined && !unavailable.has(source);

  const failed = cron?.jobs.filter((j) => j.result === 'failed') ?? [];
  const down = blind || pending ? 0 : s.visibleDown.length + s.hiddenDown.length;
  const wrong = !pending && (down > 0 || failed.length > 0);

  const strain = strainParts(figures);
  const straining = strain.length > 0;
  const common = {
    wrong,
    straining,
    eyebrow: wrong ? ('a disturbance' as const) : ('the reading' as const),
    meters: {
      cpu: meterOf('crackle · cpu', figures?.cpu ?? null, 70),
      memory: meterOf('dust · memory', figures?.memory ?? null, 80),
    },
    ball: ballFor(figures, wrong),
    hours: hours(cron, now, unavailable.has('cron')),
    omens: {
      markets: markets(widgets, unavailable.has('widgets')),
      host: hostOmen(figures, straining, loading('system')),
      sky: sky(widgets, unavailable.has('widgets')),
    },
    foot: {
      links: (services?.links ?? []).map((l) => ({ name: l.name, url: l.url })),
      quiet: s.hidden.map((h) => h.name),
    },
  };

  if (pending) {
    return {
      ...common,
      pending: true,
      long: false,
      segments: [plain('Reading the signs…')],
      colour: DASH,
      // Services known, status not: the real chips with idle dots. Nothing known: a placeholder.
      circle: services ? circle(services, status, widgets) : { loading: true },
    };
  }

  const ctx: Ctx = {
    now,
    timeZone: input.timeZone,
    blind,
    wrong,
    seen: s,
    failed,
    timezone: cron?.timezone ?? '',
    figures,
    strain,
    weather: widgets?.weather ?? null,
  };
  const segments = merge([...lead(ctx), ...hostSentence(ctx), ...weatherSentence(ctx)]);
  const failedCount = cron ? cron.jobs.filter((j) => j.result === 'failed').length : 0;
  const colour = blind
    ? DASH
    : `${s.all.length - s.visibleDown.length - s.hiddenDown.length}/${s.all.length} well${failedCount > 0 ? ` · ${failedCount} failed` : ''}`;

  return {
    ...common,
    pending: false,
    long: segments.map((x) => x.text).join('').length > LONG_READING,
    segments,
    colour,
    circle: blind ? { unavailable: true } : circle(services, status, widgets),
  };
}
