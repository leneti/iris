import { readFileSync } from 'node:fs';
import { CronResponse, HostStatusFile } from '@/lib/shared/contract';
import { defaultDashboardConfig, type DashboardConfig } from '@/lib/server/config/dashboard';
import { buildCronResponse } from '@/lib/server/cron/build';
import type { CronStatusJob } from '@/lib/server/cron/cron-status';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../fixtures/cron/${name}.json`, import.meta.url), 'utf8'));

const NOW = new Date('2026-10-16T12:00:00Z');

const rawJobs: any[] = fixture('cron-status');
const jobs: CronStatusJob[] = rawJobs.map((j) => ({
  name: j.name,
  status: j.status,
  lastRun: new Date(j.lastRun),
  message: j.message ?? null,
  url: j.url ?? null,
}));
const hostFile = HostStatusFile.parse(fixture('host-status'));

const okCron = { state: 'ok', fetchedAt: new Date('2026-10-16T11:59:30Z'), jobs } as const;
const okHost = { state: 'ok', file: hostFile } as const;

function config(
  over: Partial<DashboardConfig> = {},
): Pick<DashboardConfig, 'cron' | 'maintenance'> {
  const base = defaultDashboardConfig();
  return { cron: base.cron, maintenance: base.maintenance, ...over };
}

function build(over: Partial<Parameters<typeof buildCronResponse>[0]> = {}) {
  return buildCronResponse({
    now: NOW,
    config: config(),
    cronStatus: okCron,
    hostStatus: okHost,
    ...over,
  });
}

const row = (r: CronResponse, id: string) => r.jobs.find((j) => j.id === id)!;

describe('buildCronResponse with everything available', () => {
  const r = build();

  test('validates against the contract', () => {
    expect(() => CronResponse.parse(r)).not.toThrow();
    expect(r.generatedAt).toBe(NOW.toISOString());
    expect(r.timezone).toBe('Europe/London');
  });

  test('both sources are ok with their fetch times', () => {
    expect(r.sources).toEqual([
      { id: 'cron-status', state: 'ok', fetchedAt: '2026-10-16T11:59:30.000Z' },
      { id: 'host-status', state: 'ok', fetchedAt: NOW.toISOString() },
    ]);
  });

  test('user jobs keep cron-status order and take their schedule from the host status file', () => {
    const user = r.jobs.filter((j) => j.kind === 'user');
    expect(user.map((j) => j.id)).toEqual([
      'feed-sync',
      'price-watch',
      'photo-index',
      'report-digest',
      'cert-check',
    ]);
    expect(row(r, 'feed-sync')).toEqual({
      id: 'feed-sync',
      name: 'feed-sync',
      kind: 'user',
      schedule: { expr: '*/15 * * * *', label: null, configured: true, source: 'host-status' },
      lastRun: '2026-10-16T11:45:03.000Z',
      result: 'success',
      summary: 'Nothing to do.',
      link: 'https://feed-sync.example.invalid/',
      previousDue: '2026-10-16T11:45:00.000Z',
      nextDue: '2026-10-16T12:15:00.000Z',
      flag: 'ok',
    });
  });

  test('flags follow the rules: failed, overdue, warning, ok', () => {
    expect(row(r, 'price-watch').flag).toBe('failed');
    expect(row(r, 'photo-index').flag).toBe('overdue');
    expect(row(r, 'photo-index').previousDue).toBe('2026-10-16T06:00:00.000Z');
    expect(row(r, 'report-digest').flag).toBe('warning');
    expect(row(r, 'cert-check').flag).toBe('ok');
  });

  test('maintenance rows come from the host status file', () => {
    expect(row(r, 'backup')).toEqual({
      id: 'backup',
      name: 'System backup',
      kind: 'maintenance',
      schedule: { expr: '30 2 * * *', label: null, configured: true, source: 'host-status' },
      lastRun: '2026-10-16T01:30:00.000Z',
      result: 'success',
      summary: null,
      link: null,
      previousDue: '2026-10-16T01:30:00.000Z',
      nextDue: '2026-10-17T01:30:00.000Z',
      flag: 'ok',
    });
    const updater = row(r, 'updater');
    expect(updater).toMatchObject({
      name: 'Image updater',
      result: 'success',
      lastRun: '2026-10-16T03:19:00.000Z',
      flag: 'ok',
      // The file's nextRun is null; Iris computes it from the schedule.
      nextDue: '2026-10-17T03:19:00.000Z',
    });
  });

  test('the summary counts every row', () => {
    expect(r.summary).toEqual({ ok: 4, warning: 1, overdue: 1, failed: 1, unknown: 0 });
  });
});

describe('schedule source order: config, then host status, then none', () => {
  test('a dashboard.yaml entry wins over the host status file and carries label and grace', () => {
    const cfg = config();
    cfg.cron = {
      ...cfg.cron,
      jobs: [{ match: 'feed-sync', schedule: '0 * * * *', label: 'Hourly', graceMinutes: 30 }],
    };
    const j = row(build({ config: cfg }), 'feed-sync');
    expect(j.schedule).toEqual({
      expr: '0 * * * *',
      label: 'Hourly',
      configured: true,
      source: 'config',
    });
    expect(j.nextDue).toBe('2026-10-16T13:00:00.000Z');
    // Hourly with 30 minutes of grace: 12:00 is not yet counted at 12:00, so 11:00 is the reference.
    expect(j.previousDue).toBe('2026-10-16T11:00:00.000Z');
  });

  test('an entry without a schedule keeps its label and uses the host status schedule', () => {
    const cfg = config();
    cfg.cron = { ...cfg.cron, jobs: [{ match: 'feed-sync', label: 'Quarter-hourly' }] };
    expect(row(build({ config: cfg }), 'feed-sync').schedule).toEqual({
      expr: '*/15 * * * *',
      label: 'Quarter-hourly',
      configured: true,
      source: 'host-status',
    });
  });

  test('an invalid expression in dashboard.yaml is ignored in favour of the next source', () => {
    const cfg = config();
    cfg.cron = { ...cfg.cron, jobs: [{ match: 'feed-sync', schedule: 'every day' }] };
    expect(row(build({ config: cfg }), 'feed-sync').schedule.source).toBe('host-status');
  });

  test('no schedule anywhere: not configured, staleAfterMinutes decides, no due times', () => {
    const r = build({ hostStatus: { state: 'stale', file: null } });
    const feed = row(r, 'feed-sync');
    expect(feed.schedule).toEqual({ expr: null, label: null, configured: false, source: null });
    expect(feed.previousDue).toBeNull();
    expect(feed.nextDue).toBeNull();
    expect(feed.flag).toBe('ok'); // ran 15 minutes ago
    expect(row(r, 'cert-check').flag).toBe('overdue'); // last ran 9 hours ago, over 60 minutes
  });

  test('a host status entry with a null or invalid schedule counts as none', () => {
    const file = {
      ...hostFile,
      userJobs: [
        { folder: 'feed-sync', name: 'feed-sync', schedule: null },
        { folder: 'price-watch', name: 'price-watch', schedule: 'garbage' },
      ],
    };
    const r = build({ hostStatus: { state: 'ok', file } });
    expect(row(r, 'feed-sync').schedule.source).toBeNull();
    expect(row(r, 'price-watch').schedule.source).toBeNull();
  });
});

describe('host status stale or missing (criteria 5.3, 5.8)', () => {
  test.each(['stale', 'not-configured', 'unreachable'] as const)(
    'state %s: maintenance rows read Not monitored and raise no flag',
    (state) => {
      const r = build({ hostStatus: { state, file: null } });
      expect(r.sources[1]).toEqual({ id: 'host-status', state, fetchedAt: null });
      for (const id of ['backup', 'updater']) {
        expect(row(r, id)).toMatchObject({
          kind: 'maintenance',
          lastRun: null,
          result: 'unknown',
          summary: 'Not monitored',
          flag: 'unknown',
        });
      }
      expect(r.summary.unknown).toBe(2);
    },
  );

  test('configured maintenance schedules still show, with due times but no flag', () => {
    const cfg = config({
      maintenance: [
        { id: 'backup', name: 'System backup', schedule: '30 2 * * *', label: 'Daily at 02:30' },
        { id: 'updater', name: 'Image updater' },
      ],
    });
    const r = build({ config: cfg, hostStatus: { state: 'stale', file: null } });
    expect(row(r, 'backup').schedule).toEqual({
      expr: '30 2 * * *',
      label: 'Daily at 02:30',
      configured: true,
      source: 'config',
    });
    expect(row(r, 'backup').nextDue).toBe('2026-10-17T01:30:00.000Z');
    expect(row(r, 'backup').flag).toBe('unknown');
    expect(row(r, 'updater').schedule.configured).toBe(false);
  });
});

describe('maintenance rows with the host status file', () => {
  test('the file schedule beats the configured fallback, which fills in when the file has none', () => {
    const cfg = config({
      maintenance: [
        { id: 'backup', name: 'System backup', schedule: '0 5 * * *' },
        { id: 'updater', name: 'Image updater', schedule: '0 6 * * *' },
      ],
    });
    const file = { ...hostFile, updater: { ...hostFile.updater, schedule: null } };
    const r = build({ config: cfg, hostStatus: { state: 'ok', file } });
    expect(row(r, 'backup').schedule).toMatchObject({ expr: '30 2 * * *', source: 'host-status' });
    expect(row(r, 'updater').schedule).toMatchObject({ expr: '0 6 * * *', source: 'config' });
  });

  test('configured name, label and grace apply', () => {
    const cfg = config({
      maintenance: [{ id: 'backup', name: 'Nightly copy', label: 'Daily', graceMinutes: 60 }],
    });
    // The backup was due at 01:30Z; with 60 minutes of grace it is not overdue at 02:20Z.
    const file = {
      ...hostFile,
      backup: {
        ...hostFile.backup,
        lastStart: '2026-10-15T01:30:00Z',
        lastEnd: '2026-10-15T01:45:00Z',
      },
    };
    const early = build({
      config: cfg,
      hostStatus: { state: 'ok', file },
      now: new Date('2026-10-16T02:20:00Z'),
    });
    expect(row(early, 'backup')).toMatchObject({ name: 'Nightly copy', flag: 'ok' });
    expect(row(early, 'backup').schedule.label).toBe('Daily');
    const late = build({
      config: cfg,
      hostStatus: { state: 'ok', file },
      now: new Date('2026-10-16T02:31:00Z'),
    });
    expect(row(late, 'backup').flag).toBe('overdue');
  });

  test('results map: failed backup, paused and failed updater', () => {
    const file = {
      ...hostFile,
      backup: { ...hostFile.backup, result: 'failed' as const },
      updater: { ...hostFile.updater, result: 'paused' as const, paused: true },
    };
    const r = build({ hostStatus: { state: 'ok', file } });
    expect(row(r, 'backup')).toMatchObject({ result: 'failed', flag: 'failed' });
    expect(row(r, 'updater')).toMatchObject({
      result: 'warning',
      summary: 'Updates are paused',
      flag: 'warning',
    });
    const failed = build({
      hostStatus: {
        state: 'ok',
        file: { ...file, updater: { ...file.updater, result: 'failed' } },
      },
    });
    expect(row(failed, 'updater').result).toBe('failed');
  });

  test('a maintenance row with no schedule at all is never overdue', () => {
    const file = {
      ...hostFile,
      backup: { ...hostFile.backup, schedule: null, lastStart: '2026-10-10T01:30:00Z' },
    };
    const r = build({ hostStatus: { state: 'ok', file } });
    expect(row(r, 'backup').flag).toBe('ok');
    expect(row(r, 'backup').nextDue).toBeNull();
  });

  test('never-run maintenance (null times) is unknown, not overdue', () => {
    const file = {
      ...hostFile,
      backup: { ...hostFile.backup, lastStart: null, lastEnd: null, result: 'unknown' as const },
    };
    expect(row(build({ hostStatus: { state: 'ok', file } }), 'backup')).toMatchObject({
      lastRun: null,
      flag: 'unknown',
    });
  });

  test('an unknown maintenance id from dashboard.yaml is listed as not monitored', () => {
    const cfg = config({
      maintenance: [{ id: 'scrub', name: 'Disk scrub', schedule: '0 3 * * 0' }],
    });
    const r = build({ config: cfg });
    expect(row(r, 'scrub')).toMatchObject({ summary: 'Not monitored', flag: 'unknown' });
    expect(r.jobs.filter((j) => j.kind === 'maintenance').map((j) => j.id)).toEqual([
      'scrub',
      'backup',
      'updater',
    ]);
  });
});

describe('cron-status trouble (criterion 5.5)', () => {
  test('unreachable with nothing cached: source unreachable, maintenance rows still build', () => {
    const r = build({ cronStatus: { state: 'unreachable', fetchedAt: null, jobs: [] } });
    expect(r.sources[0]).toEqual({ id: 'cron-status', state: 'unreachable', fetchedAt: null });
    expect(r.sources[1]?.state).toBe('ok');
    expect(r.jobs.map((j) => j.kind)).toEqual(['maintenance', 'maintenance']);
    expect(row(r, 'backup').flag).toBe('ok');
    expect(() => CronResponse.parse(r)).not.toThrow();
  });

  test('unreachable with the last good list: the list stays, the source says unreachable', () => {
    const at = new Date('2026-10-16T11:58:00Z');
    const r = build({ cronStatus: { state: 'unreachable', fetchedAt: at, jobs } });
    expect(r.sources[0]).toEqual({
      id: 'cron-status',
      state: 'unreachable',
      fetchedAt: at.toISOString(),
    });
    expect(r.jobs.filter((j) => j.kind === 'user')).toHaveLength(5);
  });

  test('not configured', () => {
    const r = build({ cronStatus: { state: 'not-configured', fetchedAt: null, jobs: [] } });
    expect(r.sources[0]).toEqual({ id: 'cron-status', state: 'not-configured', fetchedAt: null });
  });
});

describe('summary text and link', () => {
  const one = (job: Partial<CronStatusJob>) =>
    build({
      cronStatus: {
        ...okCron,
        jobs: [{ name: 'x', status: 'success', lastRun: NOW, message: null, url: null, ...job }],
      },
    }).jobs.find((j) => j.kind === 'user')!;

  test('is cut to 200 characters', () => {
    expect(one({ message: 'a'.repeat(500) }).summary).toBe('a'.repeat(200));
    expect(one({ message: 'a'.repeat(200) }).summary).toBe('a'.repeat(200));
  });

  test('is cut by characters, not UTF-16 halves', () => {
    const s = one({ message: '\u{1F600}'.repeat(300) }).summary!;
    expect([...s]).toHaveLength(200);
    expect(s.isWellFormed()).toBe(true);
  });

  test('is plain text: control characters become spaces, runs collapse, ends are trimmed', () => {
    expect(one({ message: '  a\u0000b\nc\td\u001b[31m red\u007f  ' }).summary).toBe(
      'a b c d [31m red',
    );
    expect(one({ message: '‮evil‬' }).summary).toBe('evil');
  });

  test('empty after cleaning is null', () => {
    expect(one({ message: ' \n\t ' }).summary).toBeNull();
    expect(one({ message: null }).summary).toBeNull();
  });

  test('markup is left alone: it is data for a text node', () => {
    expect(one({ message: '<b>hi</b>' }).summary).toBe('<b>hi</b>');
  });

  test.each([
    ['https://a.example.invalid/x?y=1', 'https://a.example.invalid/x?y=1'],
    ['http://a.example.invalid/', 'http://a.example.invalid/'],
    ['javascript:alert(1)', null],
    ['data:text/html,hi', null],
    ['ftp://a.example.invalid/', null],
    ['//a.example.invalid/', null],
    ['not a url', null],
    ['https://user:pw@a.example.invalid/', null],
    ['', null],
  ])('url %s gives %s', (url, link) => {
    expect(one({ url }).link).toBe(link);
  });
});

describe('ids and timezone', () => {
  test('ids are slugs of the name and stay unique, also against the maintenance rows', () => {
    const named = (name: string): CronStatusJob => ({
      name,
      status: 'success',
      lastRun: NOW,
      message: null,
      url: null,
    });
    const r = build({
      cronStatus: {
        ...okCron,
        jobs: [
          named('Feed Sync!'),
          named('feed sync'),
          named('???'),
          named('!!!'),
          named('Backup'),
        ],
      },
    });
    expect(r.jobs.filter((j) => j.kind === 'user').map((j) => j.id)).toEqual([
      'feed-sync',
      'feed-sync-2',
      'job',
      'job-2',
      'backup-2',
    ]);
  });

  test('the configured timezone drives due times', () => {
    const cfg = config();
    cfg.cron = { ...cfg.cron, timezone: 'UTC' };
    const r = build({ config: cfg });
    expect(r.timezone).toBe('UTC');
    expect(row(r, 'backup').nextDue).toBe('2026-10-17T02:30:00.000Z');
  });

  test('an invalid timezone falls back to UTC and says so', () => {
    const cfg = config();
    cfg.cron = { ...cfg.cron, timezone: 'Nowhere/Land' };
    const r = build({ config: cfg });
    expect(r.timezone).toBe('UTC');
    expect(row(r, 'backup').nextDue).toBe('2026-10-17T02:30:00.000Z');
  });
});
