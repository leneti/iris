import 'server-only';
import { Cron } from 'croner';
import type { CronJob } from '@/lib/shared/contract';

// Cron flags (handoff §7.5). With a schedule, a job is overdue when its last run is older than
// the most recent scheduled time that is at least `graceMinutes` in the past, with 60 s of
// tolerance. Without one, when its last run is older than `staleAfterMinutes`. `croner`
// computes the times in the configured timezone.
//
// Clock changes in the timezone (Review Focus 1). What croner does, and how this file stays
// right with it, checked against croner 10.0.1 for Europe/London:
// - Fall-back (2026-10-25, 02:00 BST to 01:00 GMT): a fixed time such as `30 1 * * *` fires
//   once, at its first occurrence (00:30Z), like cron daemons do. Croner's `*/15` skips the
//   repeated hour, where a daemon keeps running. That can only put a due time later than the
//   real one, so a job is never called overdue wrongly; its "next due" reads late in that hour.
// - Spring-forward (2027-03-28, 01:00 GMT to 02:00 BST): a `30 1 * * *` time that does not
//   exist fires at 01:30Z (02:30 BST). A daemon runs it at the jump, 01:00Z. So within three
//   hours after a forward jump, a run up to the size of the jump before the due time counts.

export type Flag = CronJob['flag'];
export type JobResult = CronJob['result'];

export const TOLERANCE_MS = 60_000;
const MINUTE_MS = 60_000;
const JUMP_WINDOW_MS = 3 * 3_600_000;

export type FlagInput = {
  result: JobResult;
  lastRun: Date | null;
  schedule: string | null;
  graceMinutes: number;
  staleAfterMinutes: number;
  tz: string;
  now: Date;
};

export type FlagOutput = { flag: Flag; previousDue: Date | null; nextDue: Date | null };

/** True when croner accepts the expression and the timezone. */
export function isValidSchedule(expr: string, tz: string): boolean {
  try {
    new Cron(expr, { timezone: tz }).nextRun(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** UTC offset of the zone at an instant, in minutes. */
function offsetMinutes(at: Date, tz: string): number {
  const part = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(part ?? '');
  if (!m) return 0;
  const minutes = m[1] ? Number(m[2]) * 60 + Number(m[3]) : 0;
  return m[1] === '-' ? -minutes : minutes;
}

/** How early a run may be and still count for `due`: the size of a forward clock jump just before it. */
function earlyAllowanceMs(due: Date, tz: string): number {
  const jump = offsetMinutes(due, tz) - offsetMinutes(new Date(due.getTime() - JUMP_WINDOW_MS), tz);
  return jump > 0 ? jump * MINUTE_MS : 0;
}

type Due = { previousDue: Date | null; nextDue: Date | null; earliest: number | null };

function dueTimes(expr: string, tz: string, now: Date, graceMinutes: number): Due | null {
  try {
    const cron = new Cron(expr, { timezone: tz });
    const cutoff = now.getTime() - graceMinutes * MINUTE_MS;
    // previousRuns is not exact at its reference: it drops sub-second parts, includes or
    // excludes a run at the reference depending on them, and on a spring-forward day it can
    // return the shifted run although that lies after the reference. So ask a second past the
    // cutoff for a few runs and keep the latest one at or before the cutoff.
    const previousDue =
      cron
        .previousRuns(3, new Date(cutoff + 1000))
        .filter((d) => d.getTime() <= cutoff)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      previousDue,
      nextDue: cron.nextRun(now),
      earliest:
        previousDue === null
          ? null
          : previousDue.getTime() - TOLERANCE_MS - earlyAllowanceMs(previousDue, tz),
    };
  } catch {
    return null;
  }
}

export function flagFor(i: FlagInput): FlagOutput {
  const due = i.schedule === null ? null : dueTimes(i.schedule, i.tz, i.now, i.graceMinutes);
  let overdue = false;
  if (i.lastRun !== null) {
    if (due !== null) {
      overdue = due.earliest !== null && i.lastRun.getTime() < due.earliest;
    } else {
      overdue = i.now.getTime() - i.lastRun.getTime() > i.staleAfterMinutes * MINUTE_MS;
    }
  }
  // Precedence: failed, overdue, warning, ok, unknown.
  const flag: Flag =
    i.result === 'failed'
      ? 'failed'
      : overdue
        ? 'overdue'
        : i.result === 'warning'
          ? 'warning'
          : i.result === 'success'
            ? 'ok'
            : 'unknown';
  return { flag, previousDue: due?.previousDue ?? null, nextDue: due?.nextDue ?? null };
}
