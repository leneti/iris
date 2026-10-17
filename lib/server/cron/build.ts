import 'server-only';
import type { CronJob, CronResponse, CronSource, HostStatusFile } from '@/lib/shared/contract';
import type { IrisConfig } from '../config/iris';
import type { CronStatusJob } from './cron-status';
import { flagFor, isValidSchedule, isValidTimezone, type Flag } from './flags';
import type { HostStatusState } from './host-status';

// Builds the `/api/cron` response (handoff §7.5, §8.3) from what the two sources gave. Pure:
// the route does the fetching and reading.

export const SUMMARY_MAX_CHARS = 200;
const NOT_MONITORED = 'Not monitored';

export type BuildInput = {
  now: Date;
  config: Pick<IrisConfig, 'cron' | 'maintenance'>;
  cronStatus: {
    state: 'ok' | 'unreachable' | 'not-configured';
    /** When the list was fetched; for `unreachable`, when the last good one was. */
    fetchedAt: Date | null;
    jobs: readonly CronStatusJob[];
  };
  hostStatus: { state: HostStatusState; file: HostStatusFile | null };
};

type Maintenance = IrisConfig['maintenance'][number];

// ---- text ----
// Control characters (and the bidi controls that can reorder text) become spaces or vanish,
// whitespace collapses, and the result is cut by characters, not UTF-16 halves. The browser
// renders it as a text node, so markup is left alone.
// oxlint-disable-next-line no-control-regex -- stripping control characters is the point.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI = /[‎‏‪-‮⁦-⁩]/g;

function plainSummary(text: string | null): string | null {
  if (text === null) return null;
  const clean = text.replace(BIDI, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (clean === '') return null;
  return Array.from(clean).slice(0, SUMMARY_MAX_CHARS).join('');
}

function httpLink(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'job'
  );
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

// ---- rows ----
type Schedule = CronJob['schedule'];

function pickSchedule(
  candidates: readonly (readonly [string | null | undefined, 'config' | 'host-status'])[],
  label: string | undefined,
  tz: string,
): Schedule {
  for (const [expr, source] of candidates)
    if (expr && isValidSchedule(expr, tz))
      return { expr, label: label ?? null, configured: true, source };
  return { expr: null, label: label ?? null, configured: false, source: null };
}

function userRow(job: CronStatusJob, id: string, i: BuildInput, tz: string): CronJob {
  const { cron } = i.config;
  const override = cron.jobs.find((j) => j.match === job.name);
  const host = i.hostStatus.file?.userJobs.find((j) => j.name === job.name);
  const schedule = pickSchedule(
    [
      [override?.schedule, 'config'],
      [host?.schedule, 'host-status'],
    ],
    override?.label,
    tz,
  );
  const { flag, previousDue, nextDue } = flagFor({
    result: job.status,
    lastRun: job.lastRun,
    schedule: schedule.expr,
    graceMinutes: override?.graceMinutes ?? cron.graceMinutes,
    staleAfterMinutes: cron.staleAfterMinutes,
    tz,
    now: i.now,
  });
  return {
    id,
    name: job.name,
    kind: 'user',
    schedule,
    lastRun: iso(job.lastRun),
    result: job.status,
    summary: plainSummary(job.message),
    link: httpLink(job.url),
    previousDue: iso(previousDue),
    nextDue: iso(nextDue),
    flag,
  };
}

const DEFAULT_MAINTENANCE: readonly Maintenance[] = [
  { id: 'backup', name: 'System backup' },
  { id: 'updater', name: 'Image updater' },
];

type Observed = {
  schedule: string | null;
  lastRun: Date | null;
  result: CronJob['result'];
  summary: string | null;
};

function observed(file: HostStatusFile, id: string): Observed | null {
  const date = (s: string | null) => (s === null ? null : new Date(s));
  if (id === 'backup') {
    const b = file.backup;
    return {
      schedule: b.schedule,
      // The start, not the end: a backup still running has this run's start but last run's end.
      lastRun: date(b.lastStart ?? b.lastEnd),
      result: b.result,
      summary: null,
    };
  }
  if (id === 'updater') {
    const u = file.updater;
    return {
      schedule: u.schedule,
      lastRun: date(u.lastRun),
      result: { succeeded: 'success', failed: 'failed', paused: 'warning', unknown: 'unknown' }[
        u.result
      ] as CronJob['result'],
      summary: u.result === 'paused' ? 'Updates are paused' : null,
    };
  }
  return null;
}

function maintenanceRow(row: Maintenance, i: BuildInput, tz: string): CronJob {
  const { cron } = i.config;
  const seen =
    i.hostStatus.state === 'ok' && i.hostStatus.file ? observed(i.hostStatus.file, row.id) : null;
  // The exporter's schedule first; the one in iris.yaml fills in when the file has none.
  const schedule = pickSchedule(
    [
      [seen?.schedule, 'host-status'],
      [row.schedule, 'config'],
    ],
    row.label,
    tz,
  );
  const { flag, previousDue, nextDue } = flagFor({
    result: seen?.result ?? 'unknown',
    lastRun: seen?.lastRun ?? null,
    schedule: schedule.expr,
    graceMinutes: row.graceMinutes ?? cron.graceMinutes,
    // A daily job is not late after an hour: with no schedule, maintenance is never overdue.
    staleAfterMinutes: Infinity,
    tz,
    now: i.now,
  });
  return {
    id: row.id,
    name: row.name,
    kind: 'maintenance',
    schedule,
    lastRun: iso(seen?.lastRun ?? null),
    result: seen?.result ?? 'unknown',
    summary: seen ? seen.summary : NOT_MONITORED,
    link: null,
    previousDue: iso(previousDue),
    nextDue: iso(nextDue),
    flag,
  };
}

// ---- response ----
export function buildCronResponse(i: BuildInput): CronResponse {
  const tz = isValidTimezone(i.config.cron.timezone) ? i.config.cron.timezone : 'UTC';

  // Maintenance ids are reserved first so a user job can never share one.
  const maintenance = [...i.config.maintenance];
  for (const d of DEFAULT_MAINTENANCE)
    if (!maintenance.some((m) => m.id === d.id)) maintenance.push(d);
  const taken = new Set(maintenance.map((m) => m.id));
  const idFor = (name: string): string => {
    const base = slug(name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
  };

  const rows: CronJob[] = [
    ...i.cronStatus.jobs.map((job) => userRow(job, idFor(job.name), i, tz)),
    ...maintenance.map((m) => maintenanceRow(m, i, tz)),
  ];

  const summary: Record<Flag, number> = { ok: 0, warning: 0, overdue: 0, failed: 0, unknown: 0 };
  for (const row of rows) summary[row.flag] += 1;

  const sources: CronSource[] = [
    { id: 'cron-status', state: i.cronStatus.state, fetchedAt: iso(i.cronStatus.fetchedAt) },
    {
      id: 'host-status',
      state: i.hostStatus.state,
      fetchedAt: i.hostStatus.state === 'ok' ? i.now.toISOString() : null,
    },
  ];

  return { generatedAt: i.now.toISOString(), timezone: tz, sources, jobs: rows, summary };
}
