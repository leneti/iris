// Host status exporter (handoff D1.5, section 8.3). A systemd user timer runs this file every five
// minutes; it writes the one JSON file that Iris reads for the Scheduled jobs view.
//
// Rules for this file:
// - It imports only `node:` modules, so it can be copied to the host on its own.
// - It is erasable TypeScript only (no enums, namespaces or parameter properties), so the host's
//   Node 22 runs it directly with type stripping.
// - From the crontab it keeps the time fields and the job folder of each matching line, and
//   nothing else: no command, no environment assignment, no path.
// - It prints only `matched=<n> unmatched=<m>`.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

// ---- types (the shapes of HostStatusFile in lib/shared/contract.ts, kept local on purpose) ----
export type UserJob = { folder: string; name: string; schedule: string | null };
export type BackupStatus = {
  schedule: string | null;
  lastStart: string | null;
  lastEnd: string | null;
  result: 'success' | 'failed' | 'unknown';
  nextRun: string | null;
};
export type UpdaterStatus = {
  schedule: string | null;
  lastRun: string | null;
  result: 'succeeded' | 'failed' | 'paused' | 'unknown';
  paused: boolean;
  nextRun: string | null;
};
export type HostStatus = {
  version: 1;
  generatedAt: string;
  timezone: string;
  userJobs: UserJob[];
  unmatchedCrontabLines: number;
  backup: BackupStatus;
  updater: UpdaterStatus;
};

// ---- schedules ----
const SHORTHANDS = new Set([
  '@yearly',
  '@annually',
  '@monthly',
  '@weekly',
  '@daily',
  '@midnight',
  '@hourly',
]);
const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function safeField(field: string, index: number): boolean {
  const names = index === 3 ? MONTH_NAMES : index === 4 ? DAY_NAMES : [];
  return field
    .split(/[,/-]/)
    .every((t) => /^\d{1,3}$/.test(t) || t === '*' || names.includes(t.toLowerCase()));
}

/** Five fields of digits, `*`, `/`, `,`, `-`, month and weekday names, or an `@` shorthand. */
export function isSafeSchedule(s: string): boolean {
  if (typeof s !== 'string') return false;
  const parts = s.trim().split(/[ \t]+/);
  if (parts.length === 1) return SHORTHANDS.has((parts[0] ?? '').toLowerCase());
  return parts.length === 5 && parts.every((f, i) => safeField(f, i));
}

const normalise = (fields: string[]): string => fields.join(' ');

// ---- crontab ----
const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const TIME_AND_COMMAND = /^(@\S+|(?:\S+[ \t]+){4}\S+)[ \t]+(\S.*)$/;
const JOB_FOLDER = /\/__cron\/jobs\/([A-Za-z0-9._-]+)\//g;

function validZone(value: string): string | null {
  const v = value.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(v)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: v }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * For each active line that runs a known job folder, keep the time fields and the folder. Every
 * other active line is only counted. `CRON_TZ` is kept when it names a real zone.
 */
export function parseCrontab(
  text: string,
  jobs: Map<string, string>,
): { userJobs: UserJob[]; unmatched: number; cronTz: string | null } {
  const userJobs: UserJob[] = [];
  const seen = new Set<string>();
  let unmatched = 0;
  let cronTz: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const env = ENV_LINE.exec(line);
    if (env) {
      if (env[1] === 'CRON_TZ') cronTz = validZone(env[2] ?? '') ?? cronTz;
      continue;
    }
    const m = TIME_AND_COMMAND.exec(line);
    const folder = m
      ? [...(m[2] ?? '').matchAll(JOB_FOLDER)].map((x) => x[1] ?? '').find((f) => jobs.has(f))
      : undefined;
    if (!m || folder === undefined || seen.has(folder)) {
      unmatched += 1;
      continue;
    }
    seen.add(folder);
    const fields = (m[1] ?? '').split(/[ \t]+/);
    userJobs.push({
      folder,
      name: jobs.get(folder) ?? folder,
      schedule: isSafeSchedule(fields.join(' ')) ? normalise(fields) : null,
    });
  }
  return { userJobs, unmatched, cronTz };
}

// ---- job folders ----
const FOLDER_NAME = /^[A-Za-z0-9._-]+$/;

/** Folder name to display name, from each job's status.json `name` (cut to 80) or the folder. */
export function readJobs(jobsDir: string): Map<string, string> {
  const jobs = new Map<string, string>();
  const folders = readdirSync(jobsDir)
    .filter((f) => FOLDER_NAME.test(f))
    .sort();
  for (const folder of folders) {
    const dir = join(jobsDir, folder);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    let name = folder;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'));
      const given = (parsed as { name?: unknown } | null)?.name;
      const clean = typeof given === 'string' ? given.replace(/\p{Cc}/gu, '').trim() : '';
      if (clean !== '') name = clean.slice(0, 80);
    } catch {
      // No readable status.json: the folder name is the name.
    }
    jobs.set(folder, name);
  }
  return jobs;
}

// ---- backup ----
const BACKUP_UNIT = 'media-backup';

/** `OnCalendar=*-*-* HH:MM:SS <zone>` as `M H * * *`; anything else is null. */
export function timerToCron(unitText: string): string | null {
  const rules = unitText.split(/\r?\n/).filter((l) => l.trim().startsWith('OnCalendar='));
  if (rules.length !== 1) return null;
  const m = /^OnCalendar=\*-\*-\*[ \t]+(\d{1,2}):(\d{2})(?::00)?(?:[ \t]+\S+)?$/.exec(
    (rules[0] ?? '').trim(),
  );
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? `${minute} ${hour} * * *` : null;
}

/** The five fields (or the `@` shorthand) of the first `media-update` line in a cron.d file. */
export function cronFileSchedule(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || ENV_LINE.test(line)) continue;
    if (!line.includes('media-update')) continue;
    const tokens = line.split(/[ \t]+/);
    const fields = tokens[0]?.startsWith('@') ? tokens.slice(0, 1) : tokens.slice(0, 5);
    return isSafeSchedule(fields.join(' ')) ? normalise(fields) : null;
  }
  return null;
}

/** `systemctl show` output (`Key=Value` lines) as a record. */
export function parseProperties(text: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) props[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return props;
}

/** `@1760581800` (systemctl --timestamp=unix) as a Date; empty, `n/a` and 0 are null. */
function unixTimestamp(value: string | undefined): Date | null {
  const m = /^@(\d+)(?:\.\d+)?$/.exec((value ?? '').trim());
  const seconds = m ? Number(m[1]) : 0;
  return seconds > 0 ? new Date(seconds * 1000) : null;
}

const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * The timer's next run from `systemctl list-timers <unit> --all --output=json`: `next` is in
 * microseconds since the epoch. Null unless exactly one row is for that unit with a positive time.
 */
function nextTimerRun(json: string, unit: string): Date | null {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const mine = rows.filter((r) => (r as { unit?: unknown } | null)?.unit === unit);
  if (mine.length !== 1) return null;
  const next = (mine[0] as { next?: unknown }).next;
  if (typeof next !== 'number' || !Number.isFinite(next) || next <= 0) return null;
  const date = new Date(next / 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `service` is `systemctl show --timestamp=unix` output for the backup service; `timersJson` is
 * `systemctl list-timers --output=json` for its timer. A run that has started and not exited
 * (systemd resets Result and clears the exit time at the start) is unknown, not success.
 */
export function backupStatus(
  service: Record<string, string>,
  timersJson: string,
  unitText: string,
): BackupStatus {
  const start = unixTimestamp(service['ExecMainStartTimestamp']);
  const end = unixTimestamp(service['ExecMainExitTimestamp']);
  const running = start !== null && (end === null || end.getTime() < start.getTime());
  let result: BackupStatus['result'] = 'unknown';
  if (start && !running)
    result =
      service['Result'] === 'success' && service['ExecMainStatus'] === '0' ? 'success' : 'failed';
  return {
    schedule: timerToCron(unitText),
    lastStart: isoOrNull(start),
    lastEnd: isoOrNull(end),
    result,
    nextRun: isoOrNull(nextTimerRun(timersJson, `${BACKUP_UNIT}.timer`)),
  };
}

// ---- updater ----
const EXPANDED: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};
const LOOKBACK_MINUTES = 35 * 24 * 60;
const BUCKET_MS = 15 * 60_000;

type Field = { values: Set<number>; star: boolean };

function parseField(
  text: string,
  min: number,
  max: number,
  names: string[],
  base: number,
): Field | null {
  const values = new Set<number>();
  for (const part of text.split(',')) {
    const [range = '', stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    const num = (t: string): number => {
      const named = names.indexOf(t.toLowerCase());
      return named >= 0 ? named + base : /^\d+$/.test(t) ? Number(t) : Number.NaN;
    };
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a = '', b = ''] = range.split('-');
      lo = num(a);
      hi = num(b);
    } else {
      lo = num(range);
      hi = stepText === undefined ? lo : max;
    }
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, star: text.startsWith('*') };
}

type Spec = { minute: Field; hour: Field; dom: Field; month: Field; dow: Field };

function parseSpec(schedule: string): Spec | null {
  const expanded = EXPANDED[schedule.trim().toLowerCase()] ?? schedule;
  const f = expanded.trim().split(/[ \t]+/);
  if (f.length !== 5) return null;
  const minute = parseField(f[0] ?? '', 0, 59, [], 0);
  const hour = parseField(f[1] ?? '', 0, 23, [], 0);
  const dom = parseField(f[2] ?? '', 1, 31, [], 0);
  const month = parseField(f[3] ?? '', 1, 12, MONTH_NAMES, 1);
  const dow = parseField(f[4] ?? '', 0, 7, DAY_NAMES, 0);
  if (!minute || !hour || !dom || !month || !dow) return null;
  if (dow.values.has(7)) dow.values.add(0);
  return { minute, hour, dom, month, dow };
}

/**
 * The latest minute at or before `now` that the schedule names, read in `tz`. Walks back from now,
 * so a wall time that happens twice (clocks going back) resolves to its later occurrence. Looks
 * back 35 days; a rarer schedule gives null.
 */
function latestScheduledRun(schedule: string, now: Date, tz: string): Date | null {
  const spec = parseSpec(schedule);
  if (!spec) return null;
  let zone: Intl.DateTimeFormat;
  try {
    zone = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
  } catch {
    return null;
  }
  // Zone offsets change only on quarter-hour boundaries, so one lookup serves a 15-minute bucket.
  const offsets = new Map<number, number>();
  const offsetAt = (t: number): number => {
    const bucket = Math.floor(t / BUCKET_MS) * BUCKET_MS;
    let offset = offsets.get(bucket);
    if (offset === undefined) {
      const p: Record<string, number> = {};
      for (const part of zone.formatToParts(new Date(bucket)))
        if (part.type !== 'literal') p[part.type] = Number(part.value);
      offset =
        Date.UTC(
          p['year'] ?? 0,
          (p['month'] ?? 1) - 1,
          p['day'] ?? 1,
          p['hour'] ?? 0,
          p['minute'] ?? 0,
        ) - bucket;
      offsets.set(bucket, offset);
    }
    return offset;
  };
  const start = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let i = 0; i < LOOKBACK_MINUTES; i++) {
    const t = start - i * 60_000;
    const l = new Date(t + offsetAt(t));
    if (!spec.minute.values.has(l.getUTCMinutes()) || !spec.hour.values.has(l.getUTCHours()))
      continue;
    if (!spec.month.values.has(l.getUTCMonth() + 1)) continue;
    const domOk = spec.dom.values.has(l.getUTCDate());
    const dowOk = spec.dow.values.has(l.getUTCDay());
    // Cron: when both day fields are restricted a match on either is enough.
    const dayOk = spec.dom.star || spec.dow.star ? domOk && dowOk : domOk || dowOk;
    if (dayOk) return new Date(t);
  }
  return null;
}

/**
 * The updater's report folder is root-only, so the result is inferred: the pause latch means
 * paused (a failed update always sets it); otherwise the log changing after the latest scheduled
 * run means succeeded; otherwise unknown. Iris computes the next due time from `schedule`.
 */
export function updaterStatus(i: {
  latch: boolean;
  logMtime: Date | null;
  schedule: string | null;
  now: Date;
  tz: string;
}): UpdaterStatus {
  const schedule = i.schedule !== null && isSafeSchedule(i.schedule) ? i.schedule : null;
  let result: UpdaterStatus['result'] = 'unknown';
  if (i.latch) {
    result = 'paused';
  } else if (i.logMtime && schedule) {
    const due = latestScheduledRun(schedule, i.now, i.tz);
    if (due && i.logMtime.getTime() >= due.getTime()) result = 'succeeded';
  }
  return {
    schedule,
    lastRun: isoOrNull(i.logMtime),
    result,
    paused: i.latch,
    nextRun: null,
  };
}

// ---- output ----
export function buildStatus(i: {
  now: Date;
  timezone: string;
  userJobs: UserJob[];
  unmatchedCrontabLines: number;
  backup: BackupStatus;
  updater: UpdaterStatus;
}): HostStatus {
  return {
    version: 1,
    generatedAt: i.now.toISOString(),
    timezone: i.timezone,
    userJobs: i.userJobs.map((j) => ({ folder: j.folder, name: j.name, schedule: j.schedule })),
    unmatchedCrontabLines: i.unmatchedCrontabLines,
    backup: i.backup,
    updater: i.updater,
  };
}

/** Serialise first, write a temporary file beside the target, then rename it into place. */
export function writeAtomic(path: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  if (typeof text !== 'string') throw new TypeError('nothing to write');
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, `${text}\n`, { mode: 0o644, flag: 'wx' });
    chmodSync(tmp, 0o644);
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

// ---- main ----
export type Deps = {
  now(): Date;
  timeZone(): string;
  /** Runs a program with an argument array (no shell) and returns stdout; rejects on failure. */
  run(file: string, args: string[]): Promise<string>;
  /** File contents, or null when it cannot be read. */
  readText(path: string): string | null;
  mtime(path: string): Date | null;
  exists(path: string): boolean;
  readJobs(dir: string): Map<string, string>;
  write(path: string, data: unknown): void;
  print(line: string): void;
  printError(line: string): void;
};

const execFileAsync = promisify(execFile);

export const realDeps: Deps = {
  now: () => new Date(),
  timeZone: () => new Intl.DateTimeFormat().resolvedOptions().timeZone,
  run: async (file, args) =>
    (await execFileAsync(file, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 1 << 20 }))
      .stdout,
  readText: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  mtime: (path) => {
    try {
      return statSync(path).mtime;
    } catch {
      return null;
    }
  },
  exists: existsSync,
  readJobs,
  write: writeAtomic,
  print: (line) => console.log(line),
  printError: (line) => console.error(line),
};

const USAGE = [
  'Usage: media-status-export --jobs-dir <dir> --out <file> [options]',
  '  --jobs-dir <dir>      folder holding one folder per cron job (required)',
  '  --out <file>          status file to write (required)',
  '  --cron-file <file>    default /etc/cron.d/media-update',
  '  --timer-unit <file>   default /etc/systemd/system/media-backup.timer',
  '  --update-log <file>   default /var/log/media-update.log',
  '  --latch <file>        default /var/lib/media-update/paused',
].join('\n');

export async function main(argv: string[], deps: Deps = realDeps): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        help: { type: 'boolean' },
        'jobs-dir': { type: 'string' },
        out: { type: 'string' },
        'cron-file': { type: 'string' },
        'timer-unit': { type: 'string' },
        'update-log': { type: 'string' },
        latch: { type: 'string' },
      },
    }));
  } catch {
    deps.printError(USAGE);
    return 2;
  }
  if (values['help'] === true) {
    deps.print(USAGE);
    return 0;
  }
  const str = (key: string, fallback?: string): string | undefined => {
    const v = values[key];
    return typeof v === 'string' && v !== '' ? v : fallback;
  };
  const jobsDir = str('jobs-dir');
  const out = str('out');
  if (!jobsDir || !out) {
    deps.printError(USAGE);
    return 2;
  }
  const cronFile = str('cron-file', '/etc/cron.d/media-update') ?? '';
  const timerUnit = str('timer-unit', '/etc/systemd/system/media-backup.timer') ?? '';
  const updateLog = str('update-log', '/var/log/media-update.log') ?? '';
  const latch = str('latch', '/var/lib/media-update/paused') ?? '';

  let jobs: Map<string, string>;
  try {
    jobs = deps.readJobs(jobsDir);
  } catch {
    deps.printError('error: cannot read the jobs folder');
    return 1;
  }

  const attempt = async (file: string, args: string[]): Promise<string> => {
    try {
      return await deps.run(file, args);
    } catch {
      // No crontab for the user (exit 1), or systemd unavailable: carry on with what is known.
      return '';
    }
  };
  const crontab = await attempt('crontab', ['-l']);
  const service = parseProperties(
    await attempt('systemctl', [
      'show',
      `${BACKUP_UNIT}.service`,
      '--timestamp=unix',
      '-p',
      'Result',
      '-p',
      'ExecMainStatus',
      '-p',
      'ExecMainStartTimestamp',
      '-p',
      'ExecMainExitTimestamp',
    ]),
  );
  const timers = await attempt('systemctl', [
    'list-timers',
    `${BACKUP_UNIT}.timer`,
    '--all',
    '--output=json',
  ]);

  const parsed = parseCrontab(crontab, jobs);
  const systemZone = deps.timeZone();
  const now = deps.now();
  const status = buildStatus({
    now,
    timezone: parsed.cronTz ?? systemZone,
    userJobs: parsed.userJobs,
    unmatchedCrontabLines: parsed.unmatched,
    backup: backupStatus(service, timers, deps.readText(timerUnit) ?? ''),
    updater: updaterStatus({
      latch: deps.exists(latch),
      logMtime: deps.mtime(updateLog),
      schedule: cronFileSchedule(deps.readText(cronFile) ?? ''),
      now,
      // /etc/cron.d entries follow the system zone, not a user crontab's CRON_TZ.
      tz: systemZone,
    }),
  });
  try {
    deps.write(out, status);
  } catch {
    deps.printError('error: cannot write the status file');
    return 1;
  }
  deps.print(`matched=${parsed.userJobs.length} unmatched=${parsed.unmatched}`);
  return 0;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
