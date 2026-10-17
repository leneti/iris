import 'server-only';
import type { ConfigWatcher } from './config/services';
import type { ContainerSummary } from './docker/parse';
import { discover, type HealthTarget, type ResolvedService } from './discovery/discover';
import type { ServerEnv } from './env';
import type { ProbeResult } from './health/probe';
import { resolveIcon, type IconCatalogue } from './icons/resolve';
import type { IconStore } from './icons/store';
import { log } from './log';
import { getState, observeStatuses, type AppState } from './state';

// Handoff D1.4: Docker is listed every 10 s; each service with a health target is probed every
// 30 s (jittered, 4 at a time); frame headers are re-read every 10 minutes. Nothing here may
// reject: every failure is caught, and the last good data stays.

export const DOCKER_INTERVAL_MS = 10_000;
export const PROBE_INTERVAL_MS = 30_000;
export const PROBE_JITTER = 0.2;
export const PROBE_CONCURRENCY = 4;
export const FRAME_MAX_AGE_MS = 10 * 60_000;
// How often the scheduler looks for probes that are due.
const PUMP_INTERVAL_MS = 1000;

export type PollerDeps = {
  env: ServerEnv;
  fetchContainers: (env: ServerEnv) => Promise<ContainerSummary[]>;
  probe: (target: HealthTarget, env: ServerEnv) => Promise<ProbeResult | null>;
  config: ConfigWatcher;
  icons: IconStore;
  /** Epoch milliseconds. Injected so tests are deterministic. */
  now?: () => number;
  /** In [0, 1). Injected so tests can pin the jitter. */
  random?: () => number;
  /** Defaults to the process-wide state. */
  state?: AppState;
};

const NO_CATALOGUE: IconCatalogue = { has: () => null };

function targetKey(target: HealthTarget): string {
  return JSON.stringify(target);
}

export function startPollers(deps: PollerDeps): { stop(): void } {
  const { env, fetchContainers, probe, config, icons } = deps;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const state = deps.state ?? getState();

  let stopped = false;
  let dockerBusy = false;
  let probesRunning = 0;
  /** Per service id: when the next probe is due, and the target that schedule belongs to. */
  const schedule = new Map<string, { due: number; key: string }>();
  /** Ids with a probe in flight: one at a time per id, whatever happens to its schedule entry. */
  const inFlight = new Set<string>();

  // ---- discovery ----
  async function rediscover(): Promise<void> {
    try {
      // The icon lookups are async; `discover` wants a synchronous resolver.
      const [catalogue, localFiles] = await Promise.all([
        icons.catalogue().catch(() => NO_CATALOGUE),
        icons.localFiles().catch(() => new Set<string>()),
      ]);
      const snapshot = config.get();
      const result = discover({
        containers: [...state.containers.values()],
        config: snapshot.iris.config,
        manual: snapshot.manual,
        zone: env.zone,
        resolveIcon: (input) => resolveIcon(input, catalogue, localFiles),
        docker: state.dockerError ? 'unreachable' : 'ok',
      });
      if (stopped) return;
      // `discover` leaves the iris.yaml problems to its caller.
      state.discovery = {
        ...result,
        warnings: [...snapshot.iris.warnings, ...result.warnings],
      };
    } catch (err) {
      // Keep the last discovery.
      log.error('discovery failed', { error: err });
    }
  }

  async function dockerTick(): Promise<void> {
    if (dockerBusy || stopped) return;
    dockerBusy = true;
    try {
      try {
        const list = await fetchContainers(env);
        if (stopped) return;
        state.containers = new Map(list.map((c) => [c.name, c]));
        state.dockerOkAt = now();
        if (state.dockerError) log.info('docker list recovered');
        state.dockerError = false;
      } catch (err) {
        if (stopped) return;
        // One line per outage, not one per poll.
        if (!state.dockerError) log.warn('docker list failed', { error: err });
        state.dockerError = true;
      }
      await rediscover();
      if (stopped) return;
      observeStatuses(state, now());
      pump();
    } finally {
      dockerBusy = false;
    }
  }

  // ---- probes ----
  function recordProbe(s: ResolvedService, result: ProbeResult | null): void {
    if (result === null) {
      state.probes.delete(s.id);
      return;
    }
    state.probes.set(s.id, result);
    // Keep the frame headers we have until they are 10 minutes old, then take the new ones.
    const held = state.frames.get(s.id);
    if (result.frame !== null && (!held || now() - held.at >= FRAME_MAX_AGE_MS))
      state.frames.set(s.id, { frame: result.frame, at: now() });
  }

  /** True while the schedule still holds the target this probe was started for. */
  const current = (id: string, key: string) => schedule.get(id)?.key === key;

  async function runProbe(s: ResolvedService, key: string): Promise<void> {
    try {
      const result = await probe(s.health, env);
      // The target changed or the service went away meanwhile: the result is not about it.
      if (!stopped && current(s.id, key)) recordProbe(s, result);
    } catch (err) {
      // Name and kind only: an error message from a request can carry the address.
      log.warn('health probe failed', {
        serviceId: s.id,
        error: err instanceof Error ? err.name : typeof err,
      });
      if (!stopped && current(s.id, key)) state.probes.delete(s.id);
    }
  }

  function pump(): void {
    if (stopped) return;
    const listed = state.discovery?.groups.flatMap((g) => g.services) ?? [];
    const at = now();
    const ids = new Set<string>();
    const due: ResolvedService[] = [];
    for (const s of listed) {
      if (s.health.kind === 'none') continue;
      ids.add(s.id);
      const key = targetKey(s.health);
      let entry = schedule.get(s.id);
      if (entry === undefined || entry.key !== key) {
        // New service, or its target changed: probe at once, and forget what the old target said.
        if (entry !== undefined) {
          state.probes.delete(s.id);
          state.frames.delete(s.id);
        }
        entry = { due: at, key };
        schedule.set(s.id, entry);
      }
      if (!inFlight.has(s.id) && entry.due <= at) due.push(s);
    }
    for (const id of [...schedule.keys()])
      if (!ids.has(id)) {
        schedule.delete(id);
        state.probes.delete(id);
        state.frames.delete(id);
      }
    for (const id of [...state.probes.keys()]) if (!ids.has(id)) state.probes.delete(id);

    // Most overdue first.
    due.sort((a, b) => (schedule.get(a.id)?.due ?? 0) - (schedule.get(b.id)?.due ?? 0));
    for (const s of due) {
      if (probesRunning >= PROBE_CONCURRENCY) break;
      const key = schedule.get(s.id)?.key;
      if (key === undefined) continue;
      inFlight.add(s.id);
      probesRunning += 1;
      void runProbe(s, key).finally(() => {
        probesRunning -= 1;
        inFlight.delete(s.id);
        // Only the schedule of the target that was probed moves on; a new target is already due.
        const entry = schedule.get(s.id);
        if (entry !== undefined && entry.key === key) {
          const spread = 1 + (random() * 2 - 1) * PROBE_JITTER;
          entry.due = now() + PROBE_INTERVAL_MS * spread;
        }
        safely('probe follow-up', () => {
          if (stopped) return;
          observeStatuses(state, now());
          pump();
        });
      });
    }
  }

  function safely(what: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      log.error(`${what} failed`, { error: err });
    }
  }

  const runDocker = () => {
    dockerTick().catch((err: unknown) => log.error('docker poll failed', { error: err }));
  };
  const dockerTimer = setInterval(runDocker, DOCKER_INTERVAL_MS);
  const pumpTimer = setInterval(() => safely('probe scheduling', pump), PUMP_INTERVAL_MS);
  dockerTimer.unref();
  pumpTimer.unref();
  runDocker();

  return {
    stop() {
      stopped = true;
      clearInterval(dockerTimer);
      clearInterval(pumpTimer);
    },
  };
}
