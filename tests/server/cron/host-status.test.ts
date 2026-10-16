import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHostStatus } from '@/lib/server/cron/host-status';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/cron/host-status.json', import.meta.url), 'utf8'),
);
// generatedAt in the fixture is 2026-10-16T11:55:00Z.
const NOW = new Date('2026-10-16T12:00:00Z');

const dir = mkdtempSync(join(tmpdir(), 'iris-host-status-'));
let n = 0;
function put(content: unknown): string {
  const path = join(dir, `status-${n++}.json`);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

describe('readHostStatus', () => {
  test('a fresh, valid file is ok and returned parsed', () => {
    const r = readHostStatus(put(fixture), NOW);
    expect(r.state).toBe('ok');
    expect(r.file?.userJobs).toHaveLength(5);
    expect(r.file?.updater.nextRun).toBeNull();
  });

  test('no path configured is not-configured', () => {
    expect(readHostStatus(undefined, NOW)).toEqual({ state: 'not-configured', file: null });
  });

  test('stale after 15 minutes, ok at exactly 15', () => {
    const at = (iso: string) => readHostStatus(put({ ...fixture, generatedAt: iso }), NOW);
    expect(at('2026-10-16T11:45:00Z').state).toBe('ok');
    expect(at('2026-10-16T11:44:59Z')).toEqual({ state: 'stale', file: null });
  });

  test('a generatedAt well in the future is stale, a small clock skew is not', () => {
    const at = (iso: string) => readHostStatus(put({ ...fixture, generatedAt: iso }), NOW);
    expect(at('2026-10-16T12:02:00Z').state).toBe('ok');
    expect(at('2026-10-16T12:30:00Z').state).toBe('stale');
  });

  test('a missing file is stale (criterion 5.8)', () => {
    expect(readHostStatus(join(dir, 'nope.json'), NOW)).toEqual({ state: 'stale', file: null });
  });

  test('a folder, bad JSON, a wrong shape or an oversized file is unreachable', () => {
    const sub = join(dir, 'a-folder');
    mkdirSync(sub);
    expect(readHostStatus(sub, NOW).state).toBe('unreachable');
    expect(readHostStatus(put('{ not json'), NOW).state).toBe('unreachable');
    expect(readHostStatus(put({ ...fixture, version: 2 }), NOW).state).toBe('unreachable');
    expect(readHostStatus(put({ ...fixture, extra: 1 }), NOW).state).toBe('unreachable');
    expect(readHostStatus(put(' '.repeat(300 * 1024)), NOW).state).toBe('unreachable');
  });

  test('nullable time fields are accepted', () => {
    const file = {
      ...fixture,
      backup: { ...fixture.backup, lastStart: null, lastEnd: null, nextRun: null },
      updater: { ...fixture.updater, lastRun: null },
    };
    expect(readHostStatus(put(file), NOW).state).toBe('ok');
  });
});
