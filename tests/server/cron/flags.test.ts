import { flagFor } from '@/lib/server/cron/flags';

type Input = Parameters<typeof flagFor>[0];

const base: Input = {
  result: 'success',
  lastRun: new Date('2026-10-16T11:45:03Z'),
  schedule: '*/15 * * * *',
  graceMinutes: 10,
  staleAfterMinutes: 60,
  tz: 'Europe/London',
  now: new Date('2026-10-16T12:00:00Z'),
};
const at = (over: Partial<Input>) => flagFor({ ...base, ...over });

describe('flagFor with a schedule', () => {
  test('a job that ran at its last due time is ok, with previous and next due times', () => {
    const r = at({});
    expect(r.flag).toBe('ok');
    // Grace is 10 minutes, so the reference is the due time at or before 11:50.
    expect(r.previousDue?.toISOString()).toBe('2026-10-16T11:45:00.000Z');
    expect(r.nextDue?.toISOString()).toBe('2026-10-16T12:15:00.000Z');
  });

  test('a due time inside the grace period does not make a job overdue', () => {
    // 12:00 was due and has not run yet, but only 5 minutes have passed.
    const r = at({ now: new Date('2026-10-16T12:05:00Z') });
    expect(r.flag).toBe('ok');
    expect(r.previousDue?.toISOString()).toBe('2026-10-16T11:45:00.000Z');
  });

  test('the grace boundary is inclusive: a due time exactly grace minutes ago counts', () => {
    const r = at({ now: new Date('2026-10-16T12:10:00Z') });
    expect(r.flag).toBe('overdue');
    expect(r.previousDue?.toISOString()).toBe('2026-10-16T12:00:00.000Z');
  });

  test('overdue once the grace has passed without a run, and previousDue is the missed time', () => {
    const r = at({ now: new Date('2026-10-16T12:11:00Z') });
    expect(r.flag).toBe('overdue');
    expect(r.previousDue?.toISOString()).toBe('2026-10-16T12:00:00.000Z');
    expect(r.nextDue?.toISOString()).toBe('2026-10-16T12:15:00.000Z');
  });

  test('a last run up to 60 s before the due time is tolerated, 61 s is not', () => {
    const now = new Date('2026-10-16T12:11:00Z');
    expect(at({ now, lastRun: new Date('2026-10-16T11:59:00Z') }).flag).toBe('ok');
    expect(at({ now, lastRun: new Date('2026-10-16T11:58:59Z') }).flag).toBe('overdue');
  });

  test('a job that has never reported cannot be judged overdue', () => {
    expect(at({ lastRun: null, result: 'unknown' }).flag).toBe('unknown');
  });

  test('an invalid schedule or timezone falls back to the staleness rule', () => {
    const stale = new Date('2026-10-16T10:00:00Z');
    expect(at({ schedule: 'not a schedule', lastRun: stale })).toEqual({
      flag: 'overdue',
      previousDue: null,
      nextDue: null,
    });
    expect(at({ tz: 'Nowhere/Land', lastRun: stale }).flag).toBe('overdue');
    expect(at({ schedule: 'not a schedule' }).flag).toBe('ok');
  });
});

describe('flagFor without a schedule', () => {
  const noSchedule = { schedule: null, now: new Date('2026-10-16T12:00:00Z') };

  test('overdue when the last run is older than staleAfterMinutes', () => {
    const r = at({ ...noSchedule, lastRun: new Date('2026-10-16T10:59:00Z') });
    expect(r).toEqual({ flag: 'overdue', previousDue: null, nextDue: null });
  });

  test('ok at exactly staleAfterMinutes, overdue one second later', () => {
    expect(at({ ...noSchedule, lastRun: new Date('2026-10-16T11:00:00Z') }).flag).toBe('ok');
    expect(at({ ...noSchedule, lastRun: new Date('2026-10-16T10:59:59Z') }).flag).toBe('overdue');
  });

  test('an infinite staleAfterMinutes never makes a job overdue', () => {
    const r = at({
      ...noSchedule,
      staleAfterMinutes: Infinity,
      lastRun: new Date('2020-01-01T00:00:00Z'),
    });
    expect(r.flag).toBe('ok');
  });
});

describe('flag precedence: failed > overdue > warning > ok > unknown', () => {
  const overdue = { now: new Date('2026-10-16T12:30:00Z') };

  test.each([
    ['failed', 'failed', true],
    ['failed', 'failed', false],
    ['warning', 'overdue', true],
    ['warning', 'warning', false],
    ['success', 'overdue', true],
    ['success', 'ok', false],
    ['unknown', 'overdue', true],
    ['unknown', 'unknown', false],
  ] as const)('result %s gives %s (late: %s)', (result, flag, late) => {
    expect(at({ result, ...(late ? overdue : {}) }).flag).toBe(flag);
  });
});

describe('Review Focus 1: Europe/London clock changes', () => {
  test('overdue is correct across the 2026-10-25 fall-back', () => {
    // schedule 30 1 * * * Europe/London; 01:30 occurs twice (BST then GMT)
    const r = flagFor({
      result: 'success',
      lastRun: new Date('2026-10-25T00:31:00Z'),
      schedule: '30 1 * * *',
      graceMinutes: 10,
      staleAfterMinutes: 60,
      tz: 'Europe/London',
      now: new Date('2026-10-25T01:45:00Z'),
    });
    expect(r.flag).toBe('ok'); // the run at 00:30Z counts for the first 01:30; no false overdue
    expect(r.nextDue?.toISOString()).toBe('2026-10-26T01:30:00.000Z');
  });

  test('a missed run is still overdue across the fall-back', () => {
    const r = flagFor({
      ...base,
      schedule: '30 1 * * *',
      lastRun: new Date('2026-10-24T00:31:00Z'),
      now: new Date('2026-10-25T01:45:00Z'),
    });
    expect(r.flag).toBe('overdue');
    expect(r.previousDue?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  test('a frequent job that keeps running through the repeated hour is never overdue', () => {
    for (const now of ['2026-10-25T00:50:00Z', '2026-10-25T01:20:00Z', '2026-10-25T01:50:00Z']) {
      const t = new Date(now);
      // It last ran on a quarter hour, whatever the clock says.
      const lastRun = new Date(Math.floor(t.getTime() / 900_000) * 900_000 + 3000);
      expect(at({ now: t, lastRun }).flag).toBe('ok');
    }
  });

  test('on the 2027-03-28 spring-forward a 01:30 schedule that does not exist is not falsely overdue', () => {
    // 01:00 GMT jumps to 02:00 BST, so 01:30 local does not exist that day. Croner moves the
    // run to 01:30Z (02:30 BST); a cron daemon runs it at the jump, 01:00Z. Either is on time.
    const input: Input = { ...base, schedule: '30 1 * * *' };
    const yesterday = new Date('2027-03-27T01:30:02Z');
    const atJump = new Date('2027-03-28T01:00:02Z');
    const late = new Date('2027-03-28T01:30:02Z');
    const now = new Date('2027-03-28T01:45:00Z');
    expect(flagFor({ ...input, lastRun: atJump, now }).flag).toBe('ok');
    expect(flagFor({ ...input, lastRun: late, now }).flag).toBe('ok');
    // Before anyone is late the job is simply waiting.
    expect(
      flagFor({ ...input, lastRun: yesterday, now: new Date('2027-03-28T01:20:00Z') }).flag,
    ).toBe('ok');
    // And the next due time is the next real 01:30 (BST, 00:30Z).
    expect(flagFor({ ...input, lastRun: atJump, now }).nextDue?.toISOString()).toBe(
      '2027-03-29T00:30:00.000Z',
    );
    // The window of leniency does not hide a day without any run.
    expect(flagFor({ ...input, lastRun: yesterday, now }).flag).toBe('overdue');
  });
});
