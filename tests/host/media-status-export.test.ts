import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HostStatusFile } from '@/lib/shared/contract';
import {
  backupStatus,
  buildStatus,
  cronFileSchedule,
  isSafeSchedule,
  main,
  parseCrontab,
  parseProperties,
  readJobs,
  timerToCron,
  updaterStatus,
  writeAtomic,
  type Deps,
} from '@/host/media-status-export';

const FIXTURES = resolve(__dirname, '../fixtures/host');
const EXPORTER = resolve(__dirname, '../../host/media-status-export.ts');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

// Built here so no token-like string sits in a committed file.
const TOKEN = 'k9'.repeat(20);
const crontab = () => fixture('crontab.txt').replace('@TOKEN@', TOKEN);
const jobsDir = join(FIXTURES, 'jobs');
const scratchDirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'iris-host-'));
  scratchDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const serviceProps = () => parseProperties(fixture('systemctl-service.txt'));
const timers = () => fixture('list-timers.json');
const NOW = new Date('2026-10-16T12:55:00Z');

function inputs() {
  const parsed = parseCrontab(crontab(), readJobs(jobsDir));
  return {
    now: NOW,
    timezone: 'Europe/London',
    userJobs: parsed.userJobs,
    unmatchedCrontabLines: parsed.unmatched,
    backup: backupStatus(serviceProps(), timers(), fixture('media-backup.timer')),
    updater: updaterStatus({
      latch: false,
      logMtime: new Date('2026-10-16T03:19:30Z'),
      schedule: cronFileSchedule(fixture('media-update.cron')),
      now: NOW,
      tz: 'Europe/London',
    }),
  };
}

describe('isSafeSchedule', () => {
  it('accepts five safe fields and @ shorthands', () => {
    for (const s of [
      '@hourly',
      '@daily',
      '*/15 * * * *',
      '0 9 * * mon-fri',
      '30 2 * * *',
      '0 0 1 jan,jul *',
      '1,2,3 4-6 */2 * 0',
    ])
      expect(isSafeSchedule(s), s).toBe(true);
  });

  it('rejects anything else', () => {
    for (const s of [
      '*/15 * * * * ; rm',
      '*/15 * * *',
      '@reboot',
      '@whenever',
      '* * * * $(id)',
      '0 0 * * foo',
      '0 0 * mon *',
      '0 0 * * ,1',
      '',
      '0 0 * * *\n0 0 * * *',
    ])
      expect(isSafeSchedule(s), JSON.stringify(s)).toBe(false);
  });
});

describe('readJobs', () => {
  it('maps folders to the status.json name, or to the folder name', () => {
    const jobs = readJobs(jobsDir);
    expect(jobs.get('feed-sync')).toBe('Feed sync');
    expect(jobs.get('cert-check')).toBe('cert-check');
    expect([...jobs.keys()].sort()).toEqual([
      'cert-check',
      'feed-sync',
      'photo-index',
      'price-watch',
      'report-digest',
    ]);
  });

  it('cuts names to 80 characters and skips unsafe folder names', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'long'));
    mkdirSync(join(dir, 'has space'));
    mkdirSync(join(dir, 'a;b'));
    mkdirSync(join(dir, 'broken'));
    const write = (folder: string, text: string) =>
      writeAtomic(join(dir, folder, 'status.json'), JSON.parse(text));
    write('long', JSON.stringify({ name: 'n'.repeat(120) }));
    write('broken', '{"name": 42}');
    const jobs = readJobs(dir);
    expect(jobs.get('long')).toBe('n'.repeat(80));
    expect(jobs.get('broken')).toBe('broken');
    expect(jobs.has('has space')).toBe(false);
    expect(jobs.has('a;b')).toBe(false);
  });
});

describe('parseCrontab', () => {
  const jobs = new Map([
    ['feed-sync', 'Feed sync'],
    ['cert-check', 'Cert check'],
  ]);

  it('keeps only the time fields and the folder of each matched line', () => {
    const r = parseCrontab(crontab(), readJobs(jobsDir));
    expect(r.userJobs).toEqual([
      { folder: 'feed-sync', name: 'Feed sync', schedule: '*/15 * * * *' },
      { folder: 'price-watch', name: 'Price watch', schedule: '*/30 * * * *' },
      { folder: 'photo-index', name: 'Photo index', schedule: '0 7 * * *' },
      { folder: 'report-digest', name: 'Report digest', schedule: '0 9 * * mon-fri' },
      { folder: 'cert-check', name: 'cert-check', schedule: '@daily' },
    ]);
    expect(r.unmatched).toBe(1);
    expect(r.cronTz).toBe('Europe/London');
  });

  it('ignores a CRON_TZ that is not a zone', () => {
    expect(parseCrontab('CRON_TZ=Not/AZone\n', jobs).cronTz).toBeNull();
    expect(parseCrontab('CRON_TZ=+01:00\n', jobs).cronTz).toBeNull();
    expect(parseCrontab('CRON_TZ="Europe/Paris"\n', jobs).cronTz).toBe('Europe/Paris');
  });

  it('skips a folder that is not a known job', () => {
    const r = parseCrontab('0 1 * * * node /x/__cron/jobs/../x/script.ts\n', jobs);
    expect(r.userJobs).toEqual([]);
    expect(r.unmatched).toBe(1);
  });

  it('exports a null schedule when the fields are not safe, and counts a repeat once', () => {
    const r = parseCrontab(
      [
        '*/5 * * * $(id) /x/__cron/jobs/feed-sync/script.ts',
        '0 1 * * * /x/__cron/jobs/feed-sync/script.ts',
        'not a cron line',
      ].join('\n'),
      jobs,
    );
    expect(r.userJobs).toEqual([{ folder: 'feed-sync', name: 'Feed sync', schedule: null }]);
    expect(r.unmatched).toBe(2);
  });
});

describe('timerToCron', () => {
  it('turns a daily calendar rule into cron fields', () => {
    expect(timerToCron('OnCalendar=*-*-* 02:30:00 Europe/London')).toBe('30 2 * * *');
    expect(timerToCron(fixture('media-backup.timer'))).toBe('30 2 * * *');
    expect(timerToCron('[Timer]\nOnCalendar=*-*-* 23:05\n')).toBe('5 23 * * *');
  });

  it('gives null for anything it cannot express', () => {
    expect(timerToCron('OnCalendar=Mon *-*-* 02:30:00')).toBeNull();
    expect(timerToCron('OnCalendar=daily')).toBeNull();
    expect(timerToCron('OnCalendar=*-*-* 25:00:00')).toBeNull();
    expect(timerToCron('OnCalendar=*-*-* 02:30:15')).toBeNull();
    expect(timerToCron('')).toBeNull();
  });
});

describe('cronFileSchedule', () => {
  it('reads the five fields of the media-update line', () => {
    expect(cronFileSchedule(fixture('media-update.cron'))).toBe('19 4 * * *');
    expect(cronFileSchedule('@daily root /usr/local/sbin/media-update')).toBe('@daily');
  });

  it('gives null when there is no line, or the fields are unsafe', () => {
    expect(cronFileSchedule('# media-update\nSHELL=/bin/sh\n')).toBeNull();
    expect(cronFileSchedule('1 2 * * $(x) root media-update')).toBeNull();
  });
});

describe('backupStatus', () => {
  const unit = fixture('media-backup.timer');

  it('reports a successful run', () => {
    expect(backupStatus(serviceProps(), timers(), unit)).toEqual({
      schedule: '30 2 * * *',
      lastStart: '2026-10-16T01:30:00.000Z',
      lastEnd: '2026-10-16T01:45:00.000Z',
      result: 'success',
      nextRun: '2026-10-17T01:30:00.000Z',
    });
  });

  it('reports failed for any other completed run', () => {
    const base = { ...serviceProps() };
    expect(
      backupStatus({ ...base, Result: 'exit-code', ExecMainStatus: '1' }, '[]', unit).result,
    ).toBe('failed');
    expect(backupStatus({ ...base, ExecMainStatus: '3' }, '[]', unit).result).toBe('failed');
    expect(backupStatus({ ...base, Result: 'timeout' }, '[]', unit).result).toBe('failed');
  });

  it('reports unknown when it has not run since boot', () => {
    const props = { Result: 'success', ExecMainStatus: '0', ExecMainStartTimestamp: '' };
    const r = backupStatus(props, timers(), unit);
    expect(r.result).toBe('unknown');
    expect(r.lastStart).toBeNull();
    expect(r.lastEnd).toBeNull();
  });

  it('reports unknown while a run is in progress (systemd resets Result and clears the exit time)', () => {
    const running = {
      Result: 'success',
      ExecMainStatus: '0',
      ExecMainStartTimestamp: '@1792114200',
      ExecMainExitTimestamp: '',
    };
    const r = backupStatus(running, timers(), unit);
    expect(r.result).toBe('unknown');
    expect(r.lastStart).toBe('2026-10-16T01:30:00.000Z');
    expect(r.lastEnd).toBeNull();
    // An exit time older than the start is the previous run's: still in progress.
    const stale = { ...running, ExecMainExitTimestamp: '@1792027800' };
    expect(backupStatus(stale, timers(), unit).result).toBe('unknown');
  });

  it('reads the next run from the list-timers JSON, in microseconds', () => {
    const json = (rows: unknown) => JSON.stringify(rows);
    const next = (rows: unknown) => backupStatus({}, json(rows), '').nextRun;
    const row = { next: 1792200600000000, unit: 'media-backup.timer' };
    expect(next([row])).toBe('2026-10-17T01:30:00.000Z');
    expect(next([{ ...row, unit: 'other.timer' }, row])).toBe('2026-10-17T01:30:00.000Z');
    expect(next([{ ...row, unit: 'other.timer' }])).toBeNull();
    expect(next([{ ...row, unit: 'media-backup.timer.bak' }])).toBeNull();
    expect(next([{ ...row, next: 0 }])).toBeNull();
    expect(next([{ unit: 'media-backup.timer' }])).toBeNull();
    expect(next([{ ...row, next: 'soon' }])).toBeNull();
    expect(next([row, row])).toBeNull();
    expect(next({ next: 1 })).toBeNull();
    expect(backupStatus({}, 'not json', '').nextRun).toBeNull();
    expect(backupStatus({}, '', '').nextRun).toBeNull();
  });

  it('gives null times for values systemd leaves empty or n/a', () => {
    const r = backupStatus({}, '[]', '');
    expect(r).toEqual({
      schedule: null,
      lastStart: null,
      lastEnd: null,
      result: 'unknown',
      nextRun: null,
    });
  });
});

describe('updaterStatus', () => {
  const tz = 'Europe/London';

  it('is paused when the latch exists', () => {
    const r = updaterStatus({
      latch: true,
      logMtime: null,
      schedule: '19 4 * * *',
      now: NOW,
      tz,
    });
    expect(r.result).toBe('paused');
    expect(r.paused).toBe(true);
    expect(r.nextRun).toBeNull();
  });

  it('succeeded when the log changed after the latest scheduled run', () => {
    const r = updaterStatus({
      latch: false,
      logMtime: new Date('2026-10-16T03:19:30Z'),
      schedule: '19 4 * * *',
      now: new Date('2026-10-16T09:00:00Z'),
      tz,
    });
    expect(r.result).toBe('succeeded');
    expect(r.paused).toBe(false);
    expect(r.lastRun).toBe('2026-10-16T03:19:30.000Z');
    expect(r.schedule).toBe('19 4 * * *');
    expect(r.nextRun).toBeNull();
  });

  it('is unknown when the log is older than the latest scheduled run, or missing', () => {
    const at = (logMtime: Date | null, schedule: string | null = '19 4 * * *') =>
      updaterStatus({ latch: false, logMtime, schedule, now: NOW, tz });
    expect(at(new Date('2026-10-15T03:19:30Z')).result).toBe('unknown');
    expect(at(null).result).toBe('unknown');
    expect(at(null).lastRun).toBeNull();
    expect(at(new Date('2026-10-16T03:19:30Z'), null).result).toBe('unknown');
  });

  it('uses the later of the two 01:30 on the day the clocks go back', () => {
    // 2026-10-25: 01:30 happens at 00:30Z (BST) and again at 01:30Z (GMT).
    const at = (mtime: string) =>
      updaterStatus({
        latch: false,
        logMtime: new Date(mtime),
        schedule: '30 1 * * *',
        now: new Date('2026-10-25T01:45:00Z'),
        tz,
      }).result;
    expect(at('2026-10-25T00:40:00Z')).toBe('unknown');
    expect(at('2026-10-25T01:31:00Z')).toBe('succeeded');
  });

  it('handles @ shorthands and weekday fields', () => {
    const r = updaterStatus({
      latch: false,
      logMtime: new Date('2026-10-16T00:00:30Z'),
      schedule: '@daily',
      now: NOW,
      tz: 'UTC',
    });
    expect(r.result).toBe('succeeded');
    // 2026-10-16 is a Friday; the latest Monday run was 2026-10-12.
    const weekly = (mtime: string) =>
      updaterStatus({
        latch: false,
        logMtime: new Date(mtime),
        schedule: '0 6 * * mon',
        now: NOW,
        tz: 'UTC',
      }).result;
    expect(weekly('2026-10-12T06:00:10Z')).toBe('succeeded');
    expect(weekly('2026-10-12T05:00:00Z')).toBe('unknown');
  });
});

describe('buildStatus', () => {
  it('produces a file that passes the contract', () => {
    const status = buildStatus(inputs());
    expect(HostStatusFile.safeParse(status).success).toBe(true);
    expect(status.generatedAt).toBe('2026-10-16T12:55:00.000Z');
    expect(status.userJobs).toHaveLength(5);
    expect(status.backup.result).toBe('success');
    expect(status.updater.result).toBe('succeeded');
  });

  it('exports none of the command text, environment values or tokens (criterion 5.7)', () => {
    const out = JSON.stringify(buildStatus(inputs()));
    for (const leaked of [
      'GOTIFY_TOKEN',
      'abc123secretvalue',
      TOKEN,
      'example.invalid',
      'curl',
      'token=x',
      '--api-key',
      'script.ts',
      'output.log',
      '/opt/node',
      '/srv/cron',
      'MAILTO',
    ])
      expect(out, leaked).not.toContain(leaked);
    // The curl line is the one unrelated command in the invented crontab.
    expect(buildStatus(inputs()).unmatchedCrontabLines).toBe(1);
  });
});

describe('writeAtomic', () => {
  it('writes the file with mode 0644 and leaves no temporary file', () => {
    const dir = scratch();
    const path = join(dir, 'status.json');
    writeAtomic(path, { a: 1 });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ a: 1 });
    expect(statSync(path).mode & 0o777).toBe(0o644);
    expect(readdirSync(dir)).toEqual(['status.json']);
  });

  it('leaves no partial file, and the old file intact, when serialising throws', () => {
    const dir = scratch();
    const path = join(dir, 'status.json');
    writeAtomic(path, { old: true });
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => writeAtomic(path, cyclic)).toThrow();
    expect(readdirSync(dir)).toEqual(['status.json']);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ old: true });
    const fresh = join(dir, 'other.json');
    expect(() => writeAtomic(fresh, cyclic)).toThrow();
    expect(readdirSync(dir)).toEqual(['status.json']);
  });

  it('cleans up the temporary file when the rename fails', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'status.json'));
    expect(() => writeAtomic(join(dir, 'status.json'), { a: 1 })).toThrow();
    expect(readdirSync(dir)).toEqual(['status.json']);
  });
});

describe('main', () => {
  function fakeDeps(over: Partial<Deps> = {}) {
    const calls: { file: string; args: string[] }[] = [];
    const lines: string[] = [];
    const written: { path: string; data: unknown }[] = [];
    const deps: Deps = {
      now: () => NOW,
      timeZone: () => 'Europe/London',
      run: async (file, args) => {
        calls.push({ file, args });
        if (file === 'crontab') return crontab();
        if (args.includes('media-backup.service')) return fixture('systemctl-service.txt');
        if (args.includes('list-timers')) return fixture('list-timers.json');
        throw new Error(`unexpected call: ${file}`);
      },
      readText: (path) => {
        if (path === '/etc/cron.d/media-update') return fixture('media-update.cron');
        if (path === '/etc/systemd/system/media-backup.timer') return fixture('media-backup.timer');
        return null;
      },
      mtime: () => new Date('2026-10-16T03:19:30Z'),
      exists: () => false,
      readJobs,
      write: (path, data) => void written.push({ path, data }),
      print: (line) => void lines.push(line),
      printError: (line) => void lines.push(`E:${line}`),
      ...over,
    };
    return { deps, calls, lines, written };
  }

  it('writes the file and prints only the matched and unmatched counts', async () => {
    const { deps, calls, lines, written } = fakeDeps();
    const code = await main(['--jobs-dir', jobsDir, '--out', '/out/status.json'], deps);
    expect(code).toBe(0);
    expect(lines).toEqual(['matched=5 unmatched=1']);
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe('/out/status.json');
    expect(HostStatusFile.safeParse(written[0]?.data).success).toBe(true);
    // Commands go through execFile with an argument array: no shell string anywhere.
    expect(calls[0]).toEqual({ file: 'crontab', args: ['-l'] });
    expect(calls.every((c) => c.args.every((a) => !/[;&|$`]/.test(a)))).toBe(true);
    expect(calls.some((c) => c.file === 'systemctl' && c.args[0] === 'show')).toBe(true);
  });

  it('still writes a file when crontab, systemctl and the optional files are unavailable', async () => {
    const { deps, lines, written } = fakeDeps({
      run: async () => {
        throw new Error('boom');
      },
      readText: () => null,
      mtime: () => null,
    });
    expect(await main(['--jobs-dir', jobsDir, '--out', '/out/s.json'], deps)).toBe(0);
    expect(lines).toEqual(['matched=0 unmatched=0']);
    const data = written[0]?.data as HostStatusFile;
    expect(HostStatusFile.safeParse(data).success).toBe(true);
    expect(data.backup.result).toBe('unknown');
    expect(data.updater.result).toBe('unknown');
  });

  it('writes the crontab CRON_TZ zone, and the system zone when it is not a zone', async () => {
    const withTz = (line: string) =>
      fakeDeps({
        timeZone: () => 'UTC',
        run: async (file, args) =>
          file === 'crontab'
            ? `${line}\n${crontab()}`.replace('CRON_TZ=Europe/London\n', '')
            : args.includes('list-timers')
              ? fixture('list-timers.json')
              : fixture('systemctl-service.txt'),
      });
    const valid = withTz('CRON_TZ=Europe/Paris');
    await main(['--jobs-dir', jobsDir, '--out', '/o.json'], valid.deps);
    const validData = valid.written[0]?.data as HostStatusFile;
    expect(validData.timezone).toBe('Europe/Paris');
    const invalid = withTz('CRON_TZ=Not/AZone');
    await main(['--jobs-dir', jobsDir, '--out', '/o.json'], invalid.deps);
    const invalidData = invalid.written[0]?.data as HostStatusFile;
    expect(invalidData.timezone).toBe('UTC');
  });

  it('asks systemd for timestamps and the timer list through execFile argument arrays', async () => {
    const { deps, calls } = fakeDeps();
    await main(['--jobs-dir', jobsDir, '--out', '/o.json'], deps);
    expect(calls.map((c) => [c.file, ...c.args].join(' '))).toEqual(
      expect.arrayContaining([
        'systemctl list-timers media-backup.timer --all --output=json',
        expect.stringContaining('systemctl show media-backup.service --timestamp=unix'),
      ]),
    );
  });

  it('marks the updater paused when the latch exists', async () => {
    const { deps, written } = fakeDeps({ exists: (p) => p === '/var/lib/media-update/paused' });
    await main(['--jobs-dir', jobsDir, '--out', '/o.json'], deps);
    const data = written[0]?.data as HostStatusFile;
    expect(data.updater.paused).toBe(true);
  });

  it('honours the optional path flags', async () => {
    const seen: string[] = [];
    const { deps } = fakeDeps({
      readText: (p) => (seen.push(p), null),
      mtime: (p) => (seen.push(p), null),
      exists: (p) => (seen.push(p), false),
    });
    await main(
      [
        '--jobs-dir',
        jobsDir,
        '--out',
        '/o.json',
        '--cron-file',
        '/c/cron',
        '--timer-unit',
        '/c/timer',
        '--update-log',
        '/c/log',
        '--latch',
        '/c/latch',
      ],
      deps,
    );
    expect(seen).toEqual(expect.arrayContaining(['/c/cron', '/c/timer', '/c/log', '/c/latch']));
  });

  it('fails with a short message when a required flag is missing or the jobs dir is unreadable', async () => {
    const a = fakeDeps();
    expect(await main(['--out', '/o.json'], a.deps)).toBe(2);
    expect(await main(['--jobs-dir', jobsDir], a.deps)).toBe(2);
    expect(await main(['--jobs-dir', jobsDir, '--out', '/o.json', '--bogus'], a.deps)).toBe(2);
    expect(a.written).toEqual([]);
    const b = fakeDeps();
    expect(await main(['--jobs-dir', '/does/not/exist', '--out', '/o.json'], b.deps)).toBe(1);
    expect(b.written).toEqual([]);
    expect(b.lines.every((l) => l.startsWith('E:'))).toBe(true);
  });

  it('prints usage and exits 0 for --help', async () => {
    const { deps, lines } = fakeDeps();
    expect(await main(['--help'], deps)).toBe(0);
    expect(lines.join('\n')).toContain('--jobs-dir');
  });
});

describe('the exporter file', () => {
  it('imports only node: modules', () => {
    const source = readFileSync(EXPORTER, 'utf8');
    const specifiers = [
      ...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`;]*?\bfrom\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]/g),
    ].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) expect(s, String(s)).toMatch(/^node:/);
  });

  it('runs under type stripping alone (erasable TypeScript only)', () => {
    const out = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', EXPORTER, '--help'],
      { encoding: 'utf8' },
    );
    expect(out).toContain('--jobs-dir');
  });

  it('keeps the unit templates free of real paths', () => {
    const service = readFileSync(resolve(__dirname, '../../host/media-status.service'), 'utf8');
    const timer = readFileSync(resolve(__dirname, '../../host/media-status.timer'), 'utf8');
    expect(service).toContain(
      'ExecStart=@NODE@ --disable-warning=ExperimentalWarning @EXPORTER@ --jobs-dir @JOBS_DIR@ --out /var/lib/media-status/status.json',
    );
    expect(service).toMatch(/^Type=oneshot$/m);
    // crontab -l is setgid; NoNewPrivileges would leave the exporter with an empty crontab.
    expect(service).not.toMatch(/^NoNewPrivileges=/m);
    expect(service).toMatch(/^Nice=10$/m);
    expect(timer).toMatch(/^OnBootSec=1min$/m);
    expect(timer).toMatch(/^OnUnitActiveSec=5min$/m);
    expect(timer).toMatch(/^WantedBy=timers\.target$/m);
    expect(`${service}${timer}`).not.toMatch(/\/home\/|\/media\//);
  });
});
