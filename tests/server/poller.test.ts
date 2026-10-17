import type { ContainerSummary } from '@/lib/server/docker/parse';
import type { ProbeResult } from '@/lib/server/health/probe';
import { startPollers } from '@/lib/server/poller';
import {
  buildServicesResponse,
  buildStatusResponse,
  createState,
  type AppState,
} from '@/lib/server/state';
import { log } from '@/lib/server/log';
import { config, container, env, icons, probeFailed, probeOk } from '../helpers/iris';

vi.mock('@/lib/server/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  registerSecret: vi.fn(),
}));

const T0 = new Date('2026-10-16T12:00:00.000Z');
const sec = (n: number) => n * 1000;

let state: AppState;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  state = createState();
  vi.clearAllMocks();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

type Probe = (target: unknown) => Promise<ProbeResult | null>;

function start(opts: {
  list?: () => Promise<ContainerSummary[]>;
  probe?: Probe;
  random?: () => number;
}) {
  const fetchContainers = vi.fn(opts.list ?? (async () => []));
  const probe = vi.fn(opts.probe ?? (async () => probeOk()));
  const handle = startPollers({
    env,
    state,
    now: () => Date.now(),
    random: opts.random ?? (() => 0.5),
    fetchContainers,
    probe: probe as never,
    config,
    icons,
  });
  stop = handle.stop;
  return { fetchContainers, probe };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const ids = (r: ReturnType<typeof buildServicesResponse>) =>
  r.groups.flatMap((g) => g.services.map((s) => s.id));

describe('docker poller', () => {
  test('lists containers at once and then every 10 s', async () => {
    const { fetchContainers } = start({ list: async () => [container('radarr')] });
    await advance(0);
    expect(fetchContainers).toHaveBeenCalledTimes(1);
    await advance(sec(9.9));
    expect(fetchContainers).toHaveBeenCalledTimes(1);
    await advance(sec(0.1));
    expect(fetchContainers).toHaveBeenCalledTimes(2);
    await advance(sec(20));
    expect(fetchContainers).toHaveBeenCalledTimes(4);
  });

  test('a container that appears shows up in the next services response within 15 s', async () => {
    let list = [container('radarr')];
    start({ list: async () => list });
    await advance(sec(1));
    expect(ids(buildServicesResponse(state, Date.now()))).toEqual(['radarr']);
    list = [container('radarr'), container('probe')];
    await advance(sec(11));
    expect(ids(buildServicesResponse(state, Date.now()))).toEqual(['probe', 'radarr']);
    list = [container('radarr')];
    await advance(sec(10));
    expect(ids(buildServicesResponse(state, Date.now()))).toEqual(['radarr']);
  });

  test('a failed call keeps the last discovery and sets dockerError', async () => {
    let fail = false;
    start({
      list: async () => {
        if (fail) throw new Error('proxy down');
        return [container('radarr')];
      },
    });
    await advance(sec(1));
    expect(state.dockerError).toBe(false);
    fail = true;
    await advance(sec(10));
    expect(state.dockerError).toBe(true);
    expect(ids(buildServicesResponse(state, Date.now()))).toEqual(['radarr']);
    fail = false;
    await advance(sec(10));
    expect(state.dockerError).toBe(false);
  });

  test('a services response is not marked ok until discovery was built from a Docker list (I1)', async () => {
    // The first list fails: discovery runs with no containers, so the answer is not "ok".
    let fail = true;
    start({
      list: async () => {
        if (fail) throw new Error('proxy down');
        return [container('radarr')];
      },
    });
    await advance(sec(1));
    expect(buildServicesResponse(state, Date.now()).sources.docker).toBe('unreachable');
    // The window between "the list arrived" and "discovery was rebuilt from it": the stamp is
    // fresh but the discovery result still comes from the failed round.
    state.dockerOkAt = Date.now();
    expect(buildServicesResponse(state, Date.now()).sources.docker).toBe('unreachable');
    fail = false;
    await advance(sec(10));
    const ok = buildServicesResponse(state, Date.now());
    expect(ok.sources.docker).toBe('ok');
    expect(ids(ok)).toEqual(['radarr']);
  });

  test('without a Docker answer the list is kept and statuses turn unknown after 30 s', async () => {
    let fail = false;
    start({
      list: async () => {
        if (fail) throw new Error('proxy down');
        return [container('radarr'), container('sonarr', { state: 'exited' })];
      },
    });
    await advance(sec(1));
    const first = buildStatusResponse(state, Date.now());
    expect(first.docker).toBe('ok');
    expect(first.services.radarr?.status).toBe('healthy');
    expect(first.services.sonarr?.status).toBe('stopped');

    fail = true;
    // The last success was at 0 s. At 30 s the data is still within the limit.
    await advance(sec(29));
    const at30 = buildStatusResponse(state, Date.now());
    expect(at30.docker).toBe('ok');
    expect(at30.services.radarr?.status).toBe('healthy');

    await advance(sec(1.001));
    const at31 = buildStatusResponse(state, Date.now());
    expect(at31.docker).toBe('unreachable');
    expect(at31.services.radarr?.status).toBe('unknown');
    expect(at31.services.sonarr?.status).toBe('unknown');
    expect(at31.services.radarr?.docker).toBeNull();
    expect(at31.summary.unknown).toBe(2);
    const services = buildServicesResponse(state, Date.now());
    expect(ids(services)).toEqual(['radarr', 'sonarr']);
    expect(services.sources.docker).toBe('unreachable');
  });

  test('the first call failing still produces a (manual-only) discovery', async () => {
    start({
      list: async () => {
        throw new Error('no proxy');
      },
    });
    await advance(sec(1));
    expect(state.discovery).not.toBeNull();
    expect(buildServicesResponse(state, Date.now()).sources.docker).toBe('unreachable');
    expect(buildStatusResponse(state, Date.now()).docker).toBe('unreachable');
  });
});

describe('probe poller', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => container(`svc${i}`));

  test('runs at most 4 probes at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const { probe } = start({
      list: async () => many(10),
      probe: () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        return new Promise<ProbeResult>((resolve) => {
          release.push(() => {
            inFlight -= 1;
            resolve(probeOk());
          });
        });
      },
    });
    await advance(sec(1));
    expect(probe).toHaveBeenCalledTimes(4);
    expect(inFlight).toBe(4);
    // Finishing one starts the next at once.
    release.shift()?.();
    await advance(0);
    expect(probe).toHaveBeenCalledTimes(5);
    expect(inFlight).toBe(4);
    while (release.length > 0) {
      release.shift()?.();
      await advance(0);
    }
    expect(peak).toBe(4);
    expect(probe).toHaveBeenCalledTimes(10);
  });

  test('probes each service every 30 s with plus or minus 20 % jitter', async () => {
    const early = start({ list: async () => [container('radarr')], random: () => 0 });
    await advance(sec(1));
    expect(early.probe).toHaveBeenCalledTimes(1);
    await advance(sec(24));
    expect(early.probe).toHaveBeenCalledTimes(2);
    stop?.();

    state = createState();
    const late = start({ list: async () => [container('radarr')], random: () => 1 });
    await advance(sec(1));
    expect(late.probe).toHaveBeenCalledTimes(1);
    await advance(sec(34));
    expect(late.probe).toHaveBeenCalledTimes(1);
    await advance(sec(3));
    expect(late.probe).toHaveBeenCalledTimes(2);
  });

  test('a service with no health target is never probed', async () => {
    const { probe } = start({
      list: async () => [
        container('radarr', {
          labels: { 'iris.enable': 'true', 'iris.health.url': 'none' },
        }),
      ],
    });
    await advance(sec(35));
    expect(probe).not.toHaveBeenCalled();
    expect(buildStatusResponse(state, Date.now()).services.radarr?.status).toBe('healthy');
  });

  test('a failing probe makes a running container degraded, a passing one heals it', async () => {
    let result: ProbeResult = probeFailed();
    start({ list: async () => [container('radarr')], probe: async () => result });
    await advance(sec(1));
    const bad = buildStatusResponse(state, Date.now()).services.radarr;
    expect(bad?.status).toBe('degraded');
    expect(bad?.http?.ok).toBe(false);
    result = probeOk();
    await advance(sec(37));
    const good = buildStatusResponse(state, Date.now()).services.radarr;
    expect(good?.status).toBe('healthy');
    expect(good?.http?.code).toBe(200);
  });

  test('a probe with no result leaves a probed running container unknown', async () => {
    start({ list: async () => [container('radarr')], probe: async () => null });
    await advance(sec(1));
    expect(buildStatusResponse(state, Date.now()).services.radarr?.status).toBe('unknown');
    expect(state.probes.has('radarr')).toBe(false);
  });

  test('a throwing probe is caught, logged without detail, and polling continues', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      let calls = 0;
      const { probe } = start({
        list: async () => [container('radarr')],
        probe: async () => {
          calls += 1;
          throw new Error('boom http://user:pw@host.example.invalid/x');
        },
        random: () => 0,
      });
      await advance(sec(1));
      await advance(sec(30));
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(probe).toHaveBeenCalledTimes(calls);
      expect(buildStatusResponse(state, Date.now()).services.radarr?.status).toBe('unknown');
      await advance(0);
      expect(rejections).toEqual([]);
      expect(log.warn).toHaveBeenCalledWith('health probe failed', {
        serviceId: 'radarr',
        error: 'Error',
      });
      expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain('user:pw');
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  test('frame headers are kept for 10 minutes before they are re-read', async () => {
    let frame: ProbeResult['frame'] = { xfo: null, csp: null };
    start({
      list: async () => [container('radarr')],
      probe: async () => probeOk(frame),
      random: () => 0.5,
    });
    const verdict = () =>
      buildServicesResponse(state, Date.now()).groups[0]?.services[0]?.embed.verdict;
    await advance(sec(1));
    expect(verdict()).toBe('allowed');
    frame = { xfo: 'DENY', csp: null };
    await advance(sec(5 * 60));
    expect(verdict()).toBe('allowed');
    await advance(sec(5 * 60 + 40));
    expect(verdict()).toBe('blocked');
    const embed = buildServicesResponse(state, Date.now()).groups[0]?.services[0]?.embed;
    expect(embed?.reason).toBe('x-frame-options');
    expect(embed?.checkedAt).not.toBeNull();
  });

  test('with no probe yet the embed verdict is unknown', async () => {
    start({
      list: async () => [container('radarr')],
      probe: () => new Promise<never>(() => undefined),
    });
    await advance(sec(1));
    const embed = buildServicesResponse(state, Date.now()).groups[0]?.services[0]?.embed;
    expect(embed).toMatchObject({ mode: 'auto', verdict: 'unknown', checkedAt: null });
  });

  describe('while a probe is pending', () => {
    const withUrl = (url: string) =>
      container('radarr', {
        labels: { 'iris.enable': 'true', 'iris.health.url': url },
      });

    function pending() {
      const calls: { target: { kind: string; url?: string }; resolve: (r: ProbeResult) => void }[] =
        [];
      let inFlight = 0;
      let peak = 0;
      const probe: Probe = (target) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        return new Promise<ProbeResult>((resolve) => {
          calls.push({
            target: target as { kind: string; url?: string },
            resolve: (r) => {
              inFlight -= 1;
              resolve(r);
            },
          });
        });
      };
      return { calls, probe, peak: () => peak };
    }

    test('a changed target discards the stale result and is probed again on the new target', async () => {
      const fake = pending();
      let list = [withUrl('http://a.example.invalid/')];
      start({ list: async () => list, probe: fake.probe, random: () => 0.5 });
      await advance(sec(1));
      expect(fake.calls).toHaveLength(1);

      list = [withUrl('http://b.example.invalid/')];
      await advance(sec(10));
      // One probe per service at a time: the new target waits for the old probe.
      expect(fake.calls).toHaveLength(1);

      fake.calls[0]?.resolve(probeFailed());
      await advance(0);
      expect(state.probes.has('radarr')).toBe(false);
      expect(fake.calls).toHaveLength(2);
      expect(fake.calls[1]?.target).toEqual({ kind: 'url', url: 'http://b.example.invalid/' });

      fake.calls[1]?.resolve(probeOk());
      await advance(0);
      expect(buildStatusResponse(state, Date.now()).services.radarr?.status).toBe('healthy');
      await advance(sec(31));
      expect(fake.calls).toHaveLength(3);
      expect(fake.calls[2]?.target).toEqual({ kind: 'url', url: 'http://b.example.invalid/' });
      expect(fake.peak()).toBe(1);
    });

    test('a removed and re-added service has one probe in flight and is probed again', async () => {
      const fake = pending();
      let list = [withUrl('http://a.example.invalid/')];
      start({ list: async () => list, probe: fake.probe, random: () => 0.5 });
      await advance(sec(1));
      expect(fake.calls).toHaveLength(1);

      list = [];
      await advance(sec(10));
      list = [withUrl('http://a.example.invalid/')];
      await advance(sec(10));
      expect(fake.calls).toHaveLength(1);

      fake.calls[0]?.resolve(probeOk());
      await advance(0);
      expect(buildStatusResponse(state, Date.now()).services.radarr?.status).toBe('healthy');
      await advance(sec(31));
      expect(fake.calls).toHaveLength(2);
      expect(fake.peak()).toBe(1);
    });

    test('a result for a service that was removed is discarded', async () => {
      const fake = pending();
      let list = [withUrl('http://a.example.invalid/')];
      start({ list: async () => list, probe: fake.probe });
      await advance(sec(1));
      list = [];
      await advance(sec(10));
      fake.calls[0]?.resolve(probeOk());
      await advance(0);
      expect(state.probes.size).toBe(0);
      expect(state.frames.size).toBe(0);
    });
  });

  test('stop() ends both pollers', async () => {
    const { fetchContainers, probe } = start({ list: async () => [container('radarr')] });
    await advance(sec(1));
    stop?.();
    const docker = fetchContainers.mock.calls.length;
    const probes = probe.mock.calls.length;
    await advance(sec(120));
    expect(fetchContainers).toHaveBeenCalledTimes(docker);
    expect(probe).toHaveBeenCalledTimes(probes);
  });
});

describe('changedAt', () => {
  test('stays put while the status is unchanged and moves when it changes', async () => {
    let docker: ContainerSummary = container('radarr');
    start({ list: async () => [docker] });
    await advance(sec(1));
    const first = buildStatusResponse(state, Date.now()).services.radarr?.changedAt;
    expect(first).toEqual(expect.any(String));
    await advance(sec(25));
    expect(buildStatusResponse(state, Date.now()).services.radarr?.changedAt).toBe(first);
    expect(state.changedAt.get('radarr')).toBe(first);

    docker = container('radarr', { state: 'exited' });
    await advance(sec(10));
    const second = buildStatusResponse(state, Date.now());
    expect(second.services.radarr?.status).toBe('stopped');
    expect(second.services.radarr?.changedAt).not.toBe(first);
    expect(Date.parse(second.services.radarr?.changedAt ?? '')).toBeGreaterThan(
      Date.parse(first ?? ''),
    );
  });

  test('a service that disappears drops its entry', async () => {
    let list = [container('radarr'), container('sonarr')];
    start({ list: async () => list });
    await advance(sec(1));
    buildStatusResponse(state, Date.now());
    expect([...state.changedAt.keys()].sort()).toEqual(['radarr', 'sonarr']);
    list = [container('radarr')];
    await advance(sec(10));
    buildStatusResponse(state, Date.now());
    expect([...state.changedAt.keys()]).toEqual(['radarr']);
  });
});
