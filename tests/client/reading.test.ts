// @vitest-environment node
import { describe, expect, test } from 'vitest';
import {
  deriveReading,
  greeting,
  hourWord,
  safeHref,
  type Reading,
  type ReadingInput,
  type Source,
} from '@/lib/client/reading';
import {
  calm,
  job,
  withCron,
  withDown,
  withJob,
  withServices,
  withStatus,
  withSystem,
} from '../helpers/reading';

const text = (r: Reading) => r.segments.map((s) => s.text).join('');
const read = (i: ReadingInput) => deriveReading(i);
const at = (h: number, m = 0, day = 17) => new Date(2026, 9, day, h, m);

const MORNING = ['Good morning.', 'Morning!', 'New orbit, new possibilities.'];
const AFTERNOON = ['Good afternoon.', 'Afternoon!', 'Mid-day quadrant reached.'];
const EVENING = ['Good evening.', 'Evening!', 'Entering off-duty hours.'];
const LATE = ['Late-night viewing?', 'Stargazing hours.', 'Settle in for the night.'];
const SMALL = ['Deep space silence.', 'Quiet hours.', 'Even the cron jobs are asleep.'];

describe('reading text', () => {
  test('all well', () => {
    const r = read(calm());
    const expected = AFTERNOON.map(
      (g) =>
        `${g} All 3 of your services are well, and 1 more are watched quietly. The host is calm. Cloudy over Hometown, 15°.`,
    );
    expect(expected).toContain(text(r));
    expect(r.wrong).toBe(false);
    expect(r.pending).toBe(false);
    expect(r.eyebrow).toBe('the reading');
    expect(r.ball).toMatchObject({ color: '#f25bd0', motion: 'drift' });
    expect(r.colour).toBe('4/4 well');
    expect(r.segments.find((s) => s.text === 'All 3 of your services')).toMatchObject({
      kind: 'fact',
      target: { anchor: 'circle' },
    });
    expect(r.segments.find((s) => s.text === 'The host is calm')?.target).toEqual({
      anchor: 'host',
    });
    expect(r.segments.find((s) => s.text.startsWith('Cloudy'))?.target).toEqual({
      anchor: 'sky',
    });
  });

  test('no hidden services drops the quiet clause', () => {
    const r = read(
      withServices(calm(), [
        ['Media', ['alpha', 'beta']],
        ['Home', ['gamma']],
      ]),
    );
    expect(text(r)).toContain('All 3 of your services are well. The host is calm.');
    expect(text(r)).not.toContain('watched quietly');
    expect(r.foot.quiet).toEqual([]);
  });

  test('one visible service down', () => {
    const r = read(withDown(calm(), 'alpha'));
    expect(text(r)).toContain(
      'Something is wrong. Alpha has fallen silent, and 2 of your 3 are still well.',
    );
    expect(r.wrong).toBe(true);
    expect(r.eyebrow).toBe('a disturbance');
    expect(r.ball).toMatchObject({ color: '#ff7a6b', motion: 'fall' });
    expect(r.segments.find((s) => s.kind === 'bad')?.target).toEqual({ tab: 'alpha' });
    expect(r.segments.find((s) => s.text === '2 of your 3')?.target).toEqual({
      anchor: 'circle',
    });
    expect(r.colour).toBe('3/4 well');
  });

  test('two down', () => {
    const r = read(withDown(calm(), 'alpha', 'beta'));
    expect(text(r)).toContain(
      'Something is wrong. Alpha and Beta have fallen silent, and 1 of your 3 are still well.',
    );
  });

  test('three down', () => {
    const base = withServices(calm(), [
      ['Media', ['alpha', 'beta']],
      ['Home', ['gamma', 'delta']],
    ]);
    const r = read(withDown(base, 'alpha', 'beta', 'gamma'));
    expect(text(r)).toContain(
      'Something is wrong. Alpha, Beta and 1 more have fallen silent, and 1 of your 4 are still well.',
    );
    expect(r.segments.find((s) => s.kind === 'bad')?.target).toEqual({ tab: 'alpha' });
  });

  test('hidden service only down', () => {
    const r = read(withDown(calm(), 'delta'));
    expect(text(r)).toContain(
      'Something is wrong. Delta has fallen silent, one of those watched quietly.',
    );
    expect(text(r)).toContain('All 3 of your services are well');
    expect(r.wrong).toBe(true);
    expect(r.segments.find((s) => s.kind === 'bad')?.target).toEqual({ tab: 'delta' });
    expect(r.colour).toBe('3/4 well');
  });

  test('stopped is not down', () => {
    const r = read(withStatus(calm(), 'alpha', 'stopped'));
    expect(r.wrong).toBe(false);
    expect(text(r)).toContain('All 3 of your services are well');
    expect(r.circle).toMatchObject({ rows: expect.any(Array) });
  });

  test('a failed maintenance job', () => {
    const r = read(withJob(calm(), 'nightly-backup', { result: 'failed' }));
    expect(text(r)).toContain('Something is wrong. nightly-backup failed at 02:30.');
    expect(text(r)).toContain('All 3 of your services are well');
    expect(r.wrong).toBe(true);
    expect(r.colour).toBe('4/4 well · 1 failed');
  });

  test('a failed user job', () => {
    const r = read(withJob(calm(), 'feed-sync', { result: 'failed' }));
    expect(text(r)).toContain('feed-sync failed at 11:15.');
    expect(r.wrong).toBe(true);
    expect(r.eyebrow).toBe('a disturbance');
    expect(r.ball).toMatchObject({ color: '#ff7a6b', motion: 'fall' });
  });

  test('a failed job with a link targets href, without a link targets the hours anchor', () => {
    const linked = read(
      withJob(calm(), 'feed-sync', { result: 'failed', link: 'https://feeds.example.invalid/' }),
    );
    expect(linked.segments.find((s) => s.text.startsWith('feed-sync'))?.target).toEqual({
      href: 'https://feeds.example.invalid/',
    });
    const bare = read(withJob(calm(), 'feed-sync', { result: 'failed' }));
    expect(bare.segments.find((s) => s.text.startsWith('feed-sync'))?.target).toEqual({
      anchor: 'hours',
    });
    const unsafe = read(
      withJob(calm(), 'feed-sync', { result: 'failed', link: 'javascript:alert(1)' }),
    );
    expect(unsafe.segments.find((s) => s.text.startsWith('feed-sync'))?.target).toEqual({
      anchor: 'hours',
    });
  });

  test('a failed job with lastRun null reads "{Job} failed."', () => {
    const r = read(withJob(calm(), 'feed-sync', { result: 'failed', lastRun: null }));
    expect(text(r)).toContain('Something is wrong. feed-sync failed. All 3');
  });

  test('colour reads 3/4 well · 1 failed style (all includes hidden)', () => {
    const r = read(withJob(withDown(calm(), 'delta'), 'feed-sync', { result: 'failed' }));
    expect(r.colour).toBe('3/4 well · 1 failed');
  });
});

describe('straining', () => {
  test.each([
    ['cpu', { cpu: 71 }, { cpu: 70 }],
    ['memory', { memory: 81 }, { memory: 80 }],
    ['temperature', { temp: 81 }, { temp: 80 }],
    [
      'a disk',
      { disks: [{ label: 'Media disk', percent: 91 }] },
      { disks: [{ label: 'Media disk', percent: 90 }] },
    ],
  ])('%s over its limit strains, at the limit does not', (_n, over, at_) => {
    expect(read(withSystem(calm(), over)).straining).toBe(true);
    expect(read(withSystem(calm(), at_)).straining).toBe(false);
  });

  test('cpu 71 strains, cpu 70 does not', () => {
    expect(read(withSystem(calm(), { cpu: 71 })).straining).toBe(true);
    expect(read(withSystem(calm(), { cpu: 70 })).straining).toBe(false);
    expect(read(withSystem(calm(), { cpu: 70 })).meters.cpu.hot).toBe(false);
    expect(read(withSystem(calm(), { cpu: 71 })).meters.cpu.hot).toBe(true);
  });

  test('memory 81 strains, 80 does not', () => {
    expect(read(withSystem(calm(), { memory: 81 })).meters.memory.hot).toBe(true);
    expect(read(withSystem(calm(), { memory: 80 })).meters.memory.hot).toBe(false);
  });

  test('temperature 81 strains, 80 does not', () => {
    expect(read(withSystem(calm(), { temp: 81 })).straining).toBe(true);
    expect(read(withSystem(calm(), { temp: 80 })).straining).toBe(false);
  });

  test('a disk at 91 strains, 90 does not', () => {
    const d = (p: number) => ({ disks: [{ label: 'Media disk', percent: p }] });
    expect(read(withSystem(calm(), d(91))).straining).toBe(true);
    expect(read(withSystem(calm(), d(90))).straining).toBe(false);
  });

  test('each trigger alone gives its exact part', () => {
    expect(text(read(withSystem(calm(), { cpu: 84 })))).toContain(
      'The host is straining: CPU at 84%.',
    );
    expect(text(read(withSystem(calm(), { memory: 86 })))).toContain(
      'The host is straining: memory at 86%.',
    );
    expect(text(read(withSystem(calm(), { temp: 83 })))).toContain(
      'The host is straining: running at 83°.',
    );
    expect(
      text(read(withSystem(calm(), { disks: [{ label: 'Media disk', percent: 93 }] }))),
    ).toContain('The host is straining: Media disk at 93% full.');
  });

  test('all four together keep the order', () => {
    const r = read(
      withSystem(calm(), {
        cpu: 84,
        memory: 86,
        temp: 83,
        disks: [{ label: 'Media disk', percent: 93 }],
      }),
    );
    expect(text(r)).toContain(
      'The host is straining: CPU at 84%, memory at 86%, running at 83°, Media disk at 93% full.',
    );
    const seg = r.segments.find((s) => s.kind === 'strain');
    expect(seg?.target).toEqual({ anchor: 'host' });
    expect(r.straining).toBe(true);
    expect(r.omens.host).toMatchObject({ word: 'Straining' });
    expect(r.wrong).toBe(false);
  });

  test('every disk over 90 gets a part', () => {
    const r = read(
      withSystem(calm(), {
        disks: [
          { label: 'Media disk', percent: 95 },
          { label: 'Cache', percent: 50 },
          { label: 'Backup', percent: 92 },
        ],
      }),
    );
    expect(text(r)).toContain('Media disk at 95% full, Backup at 92% full.');
  });
});

describe('ball', () => {
  test('maps cpu 0, 50 and 100', () => {
    const b0 = read(withSystem(calm(), { cpu: 0, memory: 0 })).ball;
    const b50 = read(withSystem(calm(), { cpu: 50, memory: 50 })).ball;
    const b100 = read(withSystem(calm(), { cpu: 100, memory: 100 })).ball;
    expect(b0.crackle).toBeCloseTo(0.12);
    expect(b50.crackle).toBeCloseTo(0.56);
    expect(b100.crackle).toBeCloseTo(1);
    expect(b0.sparks).toBeCloseTo(0.2);
    expect(b50.sparks).toBeCloseTo(0.6);
    expect(b100.sparks).toBeCloseTo(1);
    expect(b0.flares).toBeCloseTo(0.3);
    expect(b50.flares).toBeCloseTo(0.65);
    expect(b100.flares).toBeCloseTo(1);
    expect(b0.speed).toBeCloseTo(0.8);
    expect(b50.speed).toBeCloseTo(1.5);
    expect(b100.speed).toBeCloseTo(2.2);
    expect(b0.fill).toBe(0);
    expect(b50.fill).toBeCloseTo(0.5);
    expect(b100.fill).toBe(1);
  });

  test('missing cpu and memory give the resting ball', () => {
    const b = read(withSystem(calm(), { cpu: null, memory: null })).ball;
    expect(b).toMatchObject({ fill: 0, motion: 'drift', color: '#f25bd0' });
    expect(b.crackle).toBeCloseTo(0.12);
    expect(b.speed).toBeCloseTo(0.8);
  });
});

describe('greeting', () => {
  test.each([
    [4, 59, SMALL],
    [5, 0, MORNING],
    [10, 59, MORNING],
    [11, 0, AFTERNOON],
    [16, 59, AFTERNOON],
    [17, 0, EVENING],
    [21, 59, EVENING],
    [22, 0, LATE],
    [1, 59, LATE],
    [2, 0, SMALL],
  ])('band edge %i:%i', (h, m, pool) => {
    expect(pool).toContain(greeting(at(h, m)));
  });

  test('stable within a band', () => {
    expect(greeting(at(13, 0))).toBe(greeting(at(16, 59)));
  });

  test('differs between days', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 14; d++) seen.add(greeting(at(13, 0, d)));
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  test("00:30 shares the previous evening's pick", () => {
    expect(greeting(at(0, 30, 18))).toBe(greeting(at(23, 30, 17)));
  });

  describe('in a time zone', () => {
    const utc = (h: number, m = 0, day = 17) => new Date(Date.UTC(2026, 9, day, h, m));

    test('the band is the hour there, whatever the machine says', () => {
      // 13:00 UTC: 02:00 the next day in Auckland (+13), 09:00 in New York (-4), 13:00 in London.
      expect(SMALL).toContain(greeting(utc(13), 'Pacific/Auckland'));
      expect(MORNING).toContain(greeting(utc(13), 'America/New_York'));
      expect(AFTERNOON).toContain(greeting(utc(13), 'Europe/London'));
      expect(AFTERNOON).toContain(greeting(utc(13), 'UTC'));
    });

    test('band edges are read in the zone', () => {
      // Tokyo is UTC+9.
      expect(MORNING).toContain(greeting(utc(1, 59), 'Asia/Tokyo'));
      expect(AFTERNOON).toContain(greeting(utc(2, 0), 'Asia/Tokyo'));
      expect(EVENING).toContain(greeting(utc(12, 59), 'Asia/Tokyo'));
      expect(LATE).toContain(greeting(utc(13, 0), 'Asia/Tokyo'));
      expect(SMALL).toContain(greeting(utc(19, 59), 'Asia/Tokyo'));
      expect(MORNING).toContain(greeting(utc(20, 0), 'Asia/Tokyo'));
    });

    test("00:30 there shares the previous evening's pick", () => {
      // 15:30 UTC on the 17th is 00:30 on the 18th in Tokyo; 14:30 UTC is 23:30 on the 17th.
      expect(greeting(utc(15, 30), 'Asia/Tokyo')).toBe(greeting(utc(14, 30), 'Asia/Tokyo'));
    });

    test('the date is the date there: the same instant can pick differently', () => {
      const seen = new Set<string>();
      for (let d = 1; d <= 14; d++) seen.add(greeting(utc(13, 0, d), 'Europe/London'));
      expect(seen.size).toBeGreaterThanOrEqual(2);
    });

    test('an unknown zone falls back to the machine clock', () => {
      expect(greeting(at(13, 0), 'Not/AZone')).toBe(greeting(at(13, 0)));
    });

    test('deriveReading passes the zone to the sentence', () => {
      const asia = text(read(calm({ now: utc(13), timeZone: 'Pacific/Auckland' })));
      const london = text(read(calm({ now: utc(13), timeZone: 'Europe/London' })));
      expect(SMALL.some((g) => asia.startsWith(g))).toBe(true);
      expect(AFTERNOON.some((g) => london.startsWith(g))).toBe(true);
    });
  });
});

describe('circle', () => {
  const shape = (r: Reading) => {
    if (!('rows' in r.circle)) throw new Error('circle unavailable');
    return r.circle.rows.map((row) =>
      row.kind === 'group' ? row.group.name : row.groups.map((g) => g.name),
    );
  };

  test('a run of three one-service groups is one pair row', () => {
    const r = read(
      withServices(calm(), [
        ['One', ['a1']],
        ['Two', ['a2']],
        ['Three', ['a3']],
      ]),
    );
    expect(shape(r)).toEqual([['One', 'Two', 'Three']]);
    expect(r.circle).toMatchObject({ shown: 3 });
  });

  test('a multi-service group between singles splits the pairs', () => {
    const r = read(
      withServices(calm(), [
        ['One', ['a1']],
        ['Many', ['m1', 'm2']],
        ['Two', ['a2']],
        ['Three', ['a3']],
      ]),
    );
    expect(shape(r)).toEqual([['One'], 'Many', ['Two', 'Three']]);
  });

  test('hidden services and empty groups are dropped', () => {
    const r = read(
      withServices(calm(), [
        ['Media', ['alpha', '~beta']],
        ['Empty', []],
        ['Secret', ['~gamma']],
        ['Home', ['delta', 'epsilon']],
      ]),
    );
    expect(shape(r)).toEqual([['Media'], 'Home']);
    expect(r.circle).toMatchObject({ shown: 3 });
  });

  test('chip state maps degraded to warn, unhealthy to down, absent to idle', () => {
    let i = withServices(calm(), [['G', ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']]]);
    i = withStatus(i, 'beta', 'degraded');
    i = withStatus(i, 'gamma', 'unhealthy');
    i = withStatus(i, 'delta', 'stopped');
    i = withStatus(i, 'epsilon', 'starting');
    const status = i.status;
    if (!status) throw new Error('status');
    delete status.services['zeta'];
    const r = read(i);
    if (!('rows' in r.circle)) throw new Error('circle unavailable');
    const row = r.circle.rows[0];
    if (row?.kind !== 'group') throw new Error('expected a group row');
    expect(row.group.chips.map((c) => [c.id, c.state])).toEqual([
      ['alpha', 'ok'],
      ['beta', 'warn'],
      ['gamma', 'down'],
      ['delta', 'idle'],
      ['epsilon', 'ok'],
      ['zeta', 'idle'],
    ]);
    expect(row.group.chips[0]?.name).toBe('Alpha');
    expect(row.group.chips[0]?.service.id).toBe('alpha');
  });

  test("figure is the first stat's formatted value, null when the widget failed", () => {
    const i = calm();
    const widgets = i.widgets;
    if (!widgets) throw new Error('widgets');
    widgets.services['alpha'] = {
      type: 'x',
      state: 'ok',
      fetchedAt: null,
      stats: [
        { key: 'n', label: 'Streams', value: 1234, unit: null },
        { key: 'm', label: 'Other', value: 9, unit: null },
      ],
    };
    widgets.services['beta'] = {
      type: 'x',
      state: 'unreachable',
      fetchedAt: null,
      stats: [{ key: 'n', label: 'Streams', value: 5, unit: null }],
    };
    const r = read(i);
    if (!('rows' in r.circle)) throw new Error('circle unavailable');
    const row = r.circle.rows[0];
    if (row?.kind !== 'group') throw new Error('expected a group row');
    expect(row.group.chips.map((c) => c.figure)).toEqual(['1,234', null]);
  });
});

describe('hours', () => {
  const rows = (r: Reading) => {
    if (!('rows' in r.hours)) throw new Error('hours unavailable');
    return r.hours.rows;
  };
  const hoursAgo = (n: number, minutes = 0) =>
    new Date(calm().now.getTime() - n * 3_600_000 - minutes * 60_000).toISOString();

  test('maintenance sorted by lastRun ascending, null first', () => {
    const r = read(
      withCron(calm(), [
        job({ id: 'm-late', kind: 'maintenance', lastRun: '2026-10-17T05:00:00+00:00' }),
        job({ id: 'm-none', kind: 'maintenance', lastRun: null }),
        job({
          id: 'm-early',
          kind: 'maintenance',
          lastRun: '2026-10-17T01:00:00+00:00',
          result: 'failed',
        }),
        job({
          id: 'm-warn',
          kind: 'maintenance',
          lastRun: '2026-10-17T03:00:00+00:00',
          result: 'warning',
        }),
      ]),
    );
    const m = rows(r).filter((x) => x.kind === 'done' || x.kind === 'fail' || x.kind === 'idle');
    expect(m.map((x) => ('name' in x ? x.name : ''))).toEqual([
      'm-none',
      'm-early',
      'm-warn',
      'm-late',
    ]);
    expect(m[0]).toMatchObject({ kind: 'done', time: '—', note: 'ok' });
    expect(m[1]).toMatchObject({ kind: 'fail', time: '02:00', note: 'failed' });
    expect(m[2]).toMatchObject({ kind: 'idle', note: 'warning' });
  });

  test('user jobs sorted by nextDue, null last with —', () => {
    const r = read(
      withCron(calm(), [
        job({ id: 'u-none', kind: 'user', nextDue: null, lastRun: null }),
        job({
          id: 'u-b',
          kind: 'user',
          nextDue: '2026-10-17T18:00:00+00:00',
          lastRun: '2026-10-17T10:15:00+00:00',
        }),
        job({ id: 'u-a', kind: 'user', nextDue: '2026-10-17T14:05:00+00:00' }),
      ]),
    );
    const u = rows(r).filter((x) => x.kind === 'next');
    expect(u.map((x) => x.name)).toEqual(['u-a', 'u-b', 'u-none']);
    expect(u[0]).toMatchObject({ time: '15:05', note: '—', failed: false });
    expect(u[1]).toMatchObject({ time: '19:00', note: 'last 11:15' });
    expect(u[2]).toMatchObject({ time: '—', note: '—' });
  });

  test('sorts by time, not string', () => {
    const r = read(
      withCron(calm(), [
        job({ id: 'late', kind: 'user', nextDue: '2026-10-31T23:30:00-05:00' }),
        job({ id: 'early', kind: 'user', nextDue: '2026-11-01T01:00:00+00:00' }),
      ]),
    );
    expect(
      rows(r)
        .filter((x) => x.kind === 'next')
        .map((x) => x.name),
    ).toEqual(['early', 'late']);
  });

  test('gap in words', () => {
    const gap = (h: number) =>
      rows(read(withJob(calm(), 'nightly-backup', { lastRun: hoursAgo(h) }))).find(
        (x) => x.kind === 'gap',
      );
    expect(gap(13)).toEqual({ kind: 'gap', text: 'thirteen quiet hours' });
    expect(gap(21)).toEqual({ kind: 'gap', text: '21 quiet hours' });
    expect(gap(1)).toEqual({ kind: 'gap', text: 'one quiet hour' });
  });

  test('gap omitted under an hour and with no lastRun', () => {
    const none = (lastRun: string | null) =>
      rows(read(withJob(calm(), 'nightly-backup', { lastRun }))).some((x) => x.kind === 'gap');
    expect(none(hoursAgo(0, 59))).toBe(false);
    expect(none(null)).toBe(false);
  });

  test('the gap sits between the maintenance rows and the now row', () => {
    const kinds = rows(read(withJob(calm(), 'nightly-backup', { lastRun: hoursAgo(5) }))).map(
      (x) => x.kind,
    );
    expect(kinds).toEqual(['done', 'gap', 'now', 'next']);
  });

  test('failed user job reads failed HH:MM with failed true', () => {
    const r = read(withJob(calm(), 'feed-sync', { result: 'failed' }));
    expect(rows(r).find((x) => x.kind === 'next')).toMatchObject({
      note: 'failed 11:15',
      failed: true,
    });
  });

  test('zero jobs leaves only the now row', () => {
    const r = read(withCron(calm(), []));
    const london = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(r.hours && 'rows' in r.hours ? calm().now : new Date());
    expect(rows(r)).toEqual([{ kind: 'now', time: london }]);
  });

  test('invalid timezone falls back to UTC', () => {
    const r = read(
      withCron(
        calm(),
        [job({ id: 'x', kind: 'user', nextDue: '2026-10-17T15:00:00+00:00' })],
        'Not/AZone',
      ),
    );
    expect(rows(r).find((x) => x.kind === 'next')).toMatchObject({ time: '15:00' });
  });

  test('empty timezone does not throw', () => {
    const r = read(
      withCron(calm(), [job({ id: 'x', kind: 'user', nextDue: '2026-10-17T15:00:00+00:00' })], ''),
    );
    expect(rows(r).find((x) => x.kind === 'next')).toMatchObject({ time: '15:00' });
  });
});

describe('omens', () => {
  test('markets: rose/fell with two decimals and the formatted price', () => {
    expect(read(calm()).omens.markets).toEqual({
      lines: [
        { name: 'AAA', move: { dir: 'rose', pct: '1.20' }, price: 'US$50.50' },
        { name: 'BBB', move: { dir: 'fell', pct: '0.50' }, price: 'US$2,000' },
      ],
    });
  });

  test('null change drops the move', () => {
    const i = calm();
    const w = i.widgets?.standalone[0];
    if (!w?.stats[0]) throw new Error('markets');
    w.stats[0].changePercent = { '1h': null, '24h': null, '7d': null, '30d': null };
    const m = read(i).omens.markets;
    expect(m && 'lines' in m && m.lines[0]?.move).toBeNull();
  });

  test('no standalone widget gives null', () => {
    const i = calm();
    if (!i.widgets) throw new Error('widgets');
    i.widgets.standalone = [];
    expect(read(i).omens.markets).toBeNull();
  });

  test('a widgets outage shows no markets section', () => {
    expect(read({ ...calm(), unavailable: new Set(['widgets']) }).omens.markets).toBeNull();
  });

  test('cpu is compared as printed: 70.4 calm, 70.6 straining at 71%', () => {
    const calmR = read(withSystem(calm(), { cpu: 70.4 }));
    expect(calmR.straining).toBe(false);
    expect(calmR.meters.cpu.hot).toBe(false);
    const hotR = read(withSystem(calm(), { cpu: 70.6 }));
    expect(hotR.straining).toBe(true);
    expect(hotR.meters.cpu.hot).toBe(true);
    expect(text(hotR)).toContain('CPU at 71%');
  });

  test('failed markets state is unavailable', () => {
    const i = calm();
    const w = i.widgets?.standalone[0];
    if (!w) throw new Error('markets');
    w.state = 'rate-limited';
    expect(read(i).omens.markets).toEqual({ unavailable: true });
  });

  test('host omen lists CPU, memory, highest disk, temperature and uptime; omits a missing figure', () => {
    const full = read(
      withSystem(calm(), {
        disks: [
          { label: 'Media disk', percent: 40 },
          { label: 'Cache', percent: 86 },
        ],
      }),
    ).omens.host;
    expect(full).toEqual({
      word: 'Calm',
      parts: ['CPU 23%', 'memory 61%', 'storage 86%', '54°C', 'up 12 d 4 h'],
    });
    const partial = read(withSystem(calm(), { cpu: null, temp: null, disks: [] })).omens.host;
    expect(partial).toEqual({ word: 'Calm', parts: ['memory 61%', 'up 12 d 4 h'] });
  });

  test('sky omen has no time-of-day phrase', () => {
    const sky = read(calm()).omens.sky;
    expect(sky).toEqual({ text: 'Cloudy over Hometown, 15°C.' });
    const i = calm();
    if (!i.widgets?.weather) throw new Error('weather');
    i.widgets.weather.unit = 'fahrenheit';
    i.widgets.weather.isDay = false;
    expect(read(i).omens.sky).toEqual({ text: 'Cloudy over Hometown, 15°F.' });
  });

  test('null weather omits the sentence and the omen', () => {
    const i = calm();
    if (!i.widgets) throw new Error('widgets');
    i.widgets.weather = null;
    const r = read(i);
    expect(r.omens.sky).toBeNull();
    expect(text(r)).not.toContain('Hometown');
    expect(text(r).endsWith('The host is calm.')).toBe(true);
  });
});

describe('resilience', () => {
  const ALL: Source[] = ['services', 'status', 'cron', 'system', 'widgets'];

  test('every source missing is pending and does not throw', () => {
    const r = read({ now: at(13), unavailable: new Set() });
    expect(r.pending).toBe(true);
    expect(r.segments).toEqual([{ text: 'Reading the signs…' }]);
    expect(r.wrong).toBe(false);
    expect(r.ball).toMatchObject({ color: '#f25bd0', motion: 'drift' });
  });

  test('every source unavailable does not throw and says it cannot see the services', () => {
    const r = read({ ...calm(), unavailable: new Set(ALL) });
    expect(r.pending).toBe(false);
    expect(text(r)).toContain("I can't see the services right now.");
    expect(r.wrong).toBe(false);
    expect(r.colour).toBe('—');
    expect(r.circle).toEqual({ unavailable: true });
    expect(r.hours).toEqual({ unavailable: true });
    expect(r.omens.host).toEqual({ unavailable: true });
    expect(r.omens.sky).toEqual({ unavailable: true });
    expect(r.omens.markets).toBeNull();
    expect(r.meters.cpu).toMatchObject({ value: '—', percent: null });
  });

  test('all-null figures', () => {
    const r = read(
      withSystem(calm(), { cpu: null, memory: null, disks: [], temp: null, uptime: null }),
    );
    expect(r.meters.cpu).toEqual({ label: 'crackle · cpu', value: '—', percent: null, hot: false });
    expect(r.meters.memory).toEqual({
      label: 'dust · memory',
      value: '—',
      percent: null,
      hot: false,
    });
    expect(r.ball.fill).toBe(0);
    expect(r.ball.crackle).toBeCloseTo(0.12);
    expect(r.straining).toBe(false);
    expect(text(r)).toContain('The host is calm.');
  });

  test('meters of the calm host', () => {
    const r = read(calm());
    expect(r.meters.cpu).toEqual({ label: 'crackle · cpu', value: '23%', percent: 23, hot: false });
    expect(r.meters.memory).toEqual({
      label: 'dust · memory',
      value: '61%',
      percent: 61,
      hot: false,
    });
  });

  test('docker unreachable says it cannot see the services and never "All N … well"', () => {
    const i = calm();
    if (!i.status) throw new Error('status');
    i.status.docker = 'unreachable';
    const r = read(i);
    expect(text(r)).toContain("I can't see the services right now.");
    expect(text(r)).not.toMatch(/All \d+ of your/);
    expect(r.colour).toBe('—');
    expect(r.circle).toEqual({ unavailable: true });
  });

  test('no visible services is blind', () => {
    const r = read(
      withServices(calm(), [
        ['Home', ['~delta']],
        ['Empty', []],
      ]),
    );
    expect(text(r)).toContain("I can't see the services right now.");
    expect(text(r)).not.toMatch(/All \d+ of your/);
    const none = read({ ...calm(), services: { ...calm().services!, groups: [] } });
    expect(text(none)).toContain("I can't see the services right now.");
  });

  test('system source unreachable gives — and a resting ball', () => {
    const r = read(withSystem(calm(), { cpu: 95, memory: 95, state: 'unreachable' }));
    expect(r.meters.cpu.value).toBe('—');
    expect(r.meters.memory.value).toBe('—');
    expect(r.ball.fill).toBe(0);
    expect(r.ball.crackle).toBeCloseTo(0.12);
    expect(r.straining).toBe(false);
    expect(r.omens.host).toEqual({ unavailable: true });
    expect(text(r)).not.toContain('The host is');
  });

  test('an unavailable system source is treated the same', () => {
    const r = read({
      ...withSystem(calm(), { cpu: 95 }),
      unavailable: new Set<Source>(['system']),
    });
    expect(r.meters.cpu.value).toBe('—');
    expect(r.straining).toBe(false);
  });

  test('all cron sources unreachable and no jobs gives hours unavailable', () => {
    const i = withCron(calm(), []);
    if (!i.cron) throw new Error('cron');
    i.cron.sources = [
      { id: 'host', state: 'unreachable', fetchedAt: null },
      { id: 'other', state: 'unreachable', fetchedAt: null },
    ];
    expect(read(i).hours).toEqual({ unavailable: true });
    // With jobs from a stale source the list is still shown.
    const j = withCron(calm(), [job({ id: 'x', kind: 'user' })]);
    if (!j.cron) throw new Error('cron');
    j.cron.sources = [{ id: 'host', state: 'unreachable', fetchedAt: null }];
    expect(read(j).hours).not.toEqual({ unavailable: true });
    expect(read({ ...calm(), unavailable: new Set<Source>(['cron']) }).hours).toEqual({
      unavailable: true,
    });
  });

  test('every source down with only unknown jobs (a stale host file) gives hours unavailable', () => {
    const i = withCron(calm(), [
      job({ id: 'x', kind: 'maintenance', lastRun: null, result: 'unknown' }),
    ]);
    if (!i.cron) throw new Error('cron');
    i.cron.sources = [
      { id: 'cron-status', state: 'unreachable', fetchedAt: null },
      { id: 'host-status', state: 'stale', fetchedAt: null },
    ];
    expect(read(i).hours).toEqual({ unavailable: true });
  });

  test('unavailable status ignores service sentences but job failures still make it wrong', () => {
    const base = { ...withDown(calm(), 'alpha'), unavailable: new Set<Source>(['status']) };
    const quiet = read(base);
    expect(text(quiet)).toContain("I can't see the services right now.");
    expect(text(quiet)).not.toContain('fallen silent');
    expect(quiet.wrong).toBe(false);
    expect(quiet.eyebrow).toBe('the reading');
    const failing = read(withJob(base, 'nightly-backup', { result: 'failed' }));
    expect(failing.wrong).toBe(true);
    expect(text(failing)).toContain('nightly-backup failed at 02:30.');
    expect(text(failing)).toContain("I can't see the services right now.");
    expect(text(failing)).toContain('The host is calm.');
  });

  test('a loaded status with services missing, or the reverse, waits', () => {
    expect(read({ ...calm(), services: undefined }).pending).toBe(true);
    expect(read({ ...calm(), status: undefined }).pending).toBe(true);
  });

  test('long is true over 320 characters', () => {
    expect(read(calm()).long).toBe(false);
    const jobs = Array.from({ length: 12 }, (_, n) =>
      job({
        id: `nightly-backup-${n}`,
        kind: 'maintenance',
        lastRun: '2026-10-17T01:30:00+00:00',
        result: 'failed',
      }),
    );
    const r = read(withCron(calm(), jobs));
    expect(text(r).length).toBeGreaterThan(320);
    expect(r.long).toBe(true);
  });

  test('safeHref accepts http and https only', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('ftp://example.invalid/')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref('https://wiki.example.invalid/')).toBe('https://wiki.example.invalid/');
    expect(safeHref('http://wiki.example.invalid/a')).toBe('http://wiki.example.invalid/a');
  });

  test('footer links and quiet names', () => {
    const r = read(calm());
    expect(r.foot).toEqual({
      links: [{ name: 'Example Wiki', url: 'https://wiki.example.invalid/' }],
      quiet: ['Delta'],
    });
  });

  test('hourWord', () => {
    expect(hourWord(1)).toBe('one');
    expect(hourWord(13)).toBe('thirteen');
    expect(hourWord(20)).toBe('twenty');
    expect(hourWord(21)).toBe('21');
  });
});

describe('loading', () => {
  const without = (...keys: (keyof ReadingInput)[]): ReadingInput => {
    const i = calm();
    for (const k of keys) delete i[k];
    return i;
  };

  test('no cron answer yet is loading hours, not an empty list and not unavailable', () => {
    expect(read(without('cron')).hours).toEqual({ loading: true });
  });

  test('a cron answer with no jobs is an empty list, not loading', () => {
    const i = { ...calm(), cron: { ...calm().cron!, jobs: [] } };
    // `calm().now` is local time; the row reads it in the cron zone.
    const london = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(calm().now);
    expect(read(i).hours).toEqual({ rows: [{ kind: 'now', time: london }] });
  });

  test('a failing cron source is unavailable, whether or not it ever answered', () => {
    const down = new Set<Source>(['cron']);
    expect(read({ ...without('cron'), unavailable: down }).hours).toEqual({ unavailable: true });
    expect(read({ ...calm(), unavailable: down }).hours).toEqual({ unavailable: true });
  });

  test('no system answer yet is a loading host omen; a failing one is unavailable', () => {
    expect(read(without('system')).omens.host).toEqual({ loading: true });
    const down = new Set<Source>(['system']);
    expect(read({ ...without('system'), unavailable: down }).omens.host).toEqual({
      unavailable: true,
    });
    expect(read(withSystem(calm(), { state: 'unreachable' })).omens.host).toEqual({
      unavailable: true,
    });
  });

  test('no widgets answer yet loads markets and sky; a failing source does not', () => {
    const r = read(without('widgets'));
    expect(r.omens.markets).toEqual({ loading: true });
    expect(r.omens.sky).toEqual({ loading: true });
    const down = read({ ...without('widgets'), unavailable: new Set<Source>(['widgets']) });
    expect(down.omens.markets).toBeNull();
    expect(down.omens.sky).toEqual({ unavailable: true });
  });

  test('widgets that answered with no markets or weather are absent, not loading', () => {
    const i = { ...calm(), widgets: { ...calm().widgets!, standalone: [], weather: null } };
    const r = read(i);
    expect(r.omens.markets).toBeNull();
    expect(r.omens.sky).toBeNull();
  });

  test('the sections load on their own: one answer does not wait for the others', () => {
    const r = read(without('cron', 'widgets'));
    expect(r.pending).toBe(false);
    expect(r.hours).toEqual({ loading: true });
    expect(r.omens.markets).toEqual({ loading: true });
    expect(r.omens.host).toMatchObject({ word: 'Calm' });
    expect(r.circle).toMatchObject({ shown: 3 });
  });

  test('services known and status not: the real chips, all idle', () => {
    const r = read(without('status'));
    expect(r.pending).toBe(true);
    if (!('rows' in r.circle)) throw new Error('expected chips');
    const chips = r.circle.rows.flatMap((row) =>
      row.kind === 'group' ? row.group.chips : row.groups.flatMap((g) => g.chips),
    );
    expect(chips.map((c) => c.id)).toEqual(['alpha', 'beta', 'gamma']);
    expect(chips.every((c) => c.state === 'idle')).toBe(true);
    expect(r.circle.shown).toBe(3);
  });

  test('no services at all: a placeholder block for the circle', () => {
    expect(read(without('services')).circle).toEqual({ loading: true });
    expect(read(without('services', 'status')).circle).toEqual({ loading: true });
    expect(read({ now: at(13), unavailable: new Set() }).circle).toEqual({ loading: true });
  });

  test('an outage is still an outage: unavailable services are not loading', () => {
    const r = read({ ...without('services'), unavailable: new Set<Source>(['services']) });
    expect(r.circle).toEqual({ unavailable: true });
    expect(r.pending).toBe(false);
  });
});
