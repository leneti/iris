import { describe, expect, test } from 'vitest';
import { reduceStatus, summarize, worstOf } from '@/lib/server/health/reduce';
import type { ProbeResult } from '@/lib/server/health/probe';

const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  ok: true,
  code: 200,
  latencyMs: 12,
  reason: null,
  frame: null,
  checkedAt: '2026-10-10T00:00:00.000Z',
  ...over,
});
const failed = (reason: NonNullable<ProbeResult['reason']>, code: number | null = null) =>
  probe({ ok: false, code, reason });

const base = {
  hasContainer: true,
  dockerFresh: true,
  containerMissing: false,
  probeConfigured: true,
};
const running = (health: 'healthy' | 'unhealthy' | 'starting' | 'none' = 'none') => ({
  state: 'running',
  health,
});

// One case per row of handoff §7.4.
describe('reduceStatus, §7.4 rows', () => {
  test('healthy: running, health none, probe passed', () => {
    expect(reduceStatus({ ...base, docker: running('none'), http: probe() })).toBe('healthy');
  });
  test('healthy: running, health healthy, no probe configured', () => {
    expect(
      reduceStatus({ ...base, probeConfigured: false, docker: running('healthy'), http: null }),
    ).toBe('healthy');
  });
  test('unknown: running, probe configured, no result (proxy unreachable)', () => {
    expect(reduceStatus({ ...base, docker: running('healthy'), http: null })).toBe('unknown');
  });
  test('stopped stays stopped with a configured probe and no result', () => {
    expect(reduceStatus({ ...base, docker: { state: 'exited', health: 'none' }, http: null })).toBe(
      'stopped',
    );
  });
  test('Docker unhealthy and starting still win over a missing probe result', () => {
    expect(reduceStatus({ ...base, docker: running('unhealthy'), http: null })).toBe('unhealthy');
    expect(reduceStatus({ ...base, docker: running('starting'), http: null })).toBe('starting');
  });

  test('starting: Docker health starting', () => {
    expect(reduceStatus({ ...base, docker: running('starting'), http: null })).toBe('starting');
  });
  test('starting: state restarting', () => {
    expect(
      reduceStatus({ ...base, docker: { state: 'restarting', health: 'none' }, http: null }),
    ).toBe('starting');
  });
  test('starting wins over a failed probe', () => {
    expect(reduceStatus({ ...base, docker: running('starting'), http: failed('timeout') })).toBe(
      'starting',
    );
  });

  test.each(['timeout', 'upstream-error', 'route-missing'] as const)(
    'degraded: running and probe failed (%s)',
    (reason) => {
      expect(
        reduceStatus({
          ...base,
          docker: running('healthy'),
          http: failed(reason, reason === 'upstream-error' ? 500 : null),
        }),
      ).toBe('degraded');
    },
  );

  test('unhealthy: Docker health unhealthy, even if the probe passed', () => {
    expect(reduceStatus({ ...base, docker: running('unhealthy'), http: probe() })).toBe(
      'unhealthy',
    );
  });
  test('unhealthy: entry with no container and a failed probe', () => {
    expect(
      reduceStatus({
        docker: null,
        http: failed('upstream-error', 500),
        hasContainer: false,
        probeConfigured: true,
        dockerFresh: true,
        containerMissing: false,
      }),
    ).toBe('unhealthy');
  });
  test('no container and a passing probe is healthy', () => {
    expect(
      reduceStatus({
        docker: null,
        http: probe(),
        hasContainer: false,
        probeConfigured: true,
        dockerFresh: true,
        containerMissing: false,
      }),
    ).toBe('healthy');
  });
  test('no container and stale Docker still follows the probe', () => {
    expect(
      reduceStatus({
        docker: null,
        http: probe(),
        hasContainer: false,
        probeConfigured: true,
        dockerFresh: false,
        containerMissing: false,
      }),
    ).toBe('healthy');
  });

  test.each(['exited', 'dead', 'created', 'paused'])('stopped: state %s', (state) => {
    expect(reduceStatus({ ...base, docker: { state, health: 'none' }, http: probe() })).toBe(
      'stopped',
    );
  });

  test('unknown: no data yet for a container entry', () => {
    expect(reduceStatus({ ...base, docker: null, http: probe() })).toBe('unknown');
  });
  test('unknown: entry with no container and no probe', () => {
    expect(
      reduceStatus({
        docker: null,
        http: null,
        hasContainer: false,
        probeConfigured: false,
        dockerFresh: true,
        containerMissing: false,
      }),
    ).toBe('unknown');
  });
  test('unknown: stale Docker data hides every Docker-backed status', () => {
    for (const docker of [
      running('healthy'),
      running('unhealthy'),
      { state: 'exited', health: 'none' as const },
    ])
      expect(reduceStatus({ ...base, dockerFresh: false, docker, http: probe() })).toBe('unknown');
  });
  test('unknown: a referenced container does not exist', () => {
    expect(
      reduceStatus({
        ...base,
        containerMissing: true,
        docker: null,
        http: failed('timeout'),
      }),
    ).toBe('unknown');
  });
  test('unknown: a state Docker does not describe in §7.4', () => {
    expect(
      reduceStatus({ ...base, docker: { state: 'removing', health: 'none' }, http: probe() }),
    ).toBe('unknown');
  });
});

describe('worstOf and summarize', () => {
  const order = ['unhealthy', 'stopped', 'degraded', 'starting', 'unknown', 'healthy'] as const;

  test('worst-of order is exactly unhealthy, stopped, degraded, starting, unknown, healthy', () => {
    for (let i = 0; i < order.length; i++) {
      const rest = order.slice(i);
      expect(worstOf([...rest].reverse())).toBe(order[i]);
      expect(worstOf([...rest])).toBe(order[i]);
    }
  });
  test('an empty group is unknown', () => {
    expect(worstOf([])).toBe('unknown');
  });
  test('summarize counts every status, zeros included', () => {
    expect(summarize(['healthy', 'healthy', 'degraded', 'unknown'])).toEqual({
      healthy: 2,
      starting: 0,
      degraded: 1,
      unhealthy: 0,
      stopped: 0,
      unknown: 1,
    });
    expect(summarize([])).toEqual({
      healthy: 0,
      starting: 0,
      degraded: 0,
      unhealthy: 0,
      stopped: 0,
      unknown: 0,
    });
  });
});
