import 'server-only';
import type {
  ServiceEntry,
  ServiceStatus,
  ServiceStatusEntry,
  ServicesResponse,
  StatusResponse,
} from '@/lib/shared/contract';
import type { ContainerSummary } from './docker/parse';
import { toPublicService, type ResolvedService, type discover } from './discovery/discover';
import { embedVerdict } from './health/embed';
import type { ProbeResult } from './health/probe';
import { reduceStatus, summarize } from './health/reduce';

// App state shared by the pollers (writers) and the route handlers (readers), plus the pure
// functions that turn it into the `/api/services` and `/api/status` responses (handoff §8.1,
// §8.2, §7.4).

/** The frame headers last taken from a probe, and when (epoch ms). */
export type FrameRecord = { frame: NonNullable<ProbeResult['frame']>; at: number };

export type AppState = {
  discovery: ReturnType<typeof discover> | null;
  /** The last successful Docker list, by container name. */
  containers: Map<string, ContainerSummary>;
  /** Epoch ms of the last successful Docker list. */
  dockerOkAt: number | null;
  /** The most recent Docker call failed. */
  dockerError: boolean;
  /** The latest probe result per service id; absent when there is none. */
  probes: Map<string, ProbeResult>;
  /** ISO time of each service's last status change. */
  changedAt: Map<string, string>;
  /** Frame headers per service id, re-read at most every 10 minutes (D1.4). */
  frames: Map<string, FrameRecord>;
  /** The status `changedAt` was last compared with. */
  lastStatus: Map<string, ServiceStatus>;
};

declare global {
  // oxlint-disable-next-line no-var -- `var` is the only way to declare a global property.
  var __iris: AppState | undefined;
}

/** Data older than this makes every Docker-backed status `unknown` (§7.4). */
export const DOCKER_STALE_MS = 30_000;

export function createState(): AppState {
  return {
    discovery: null,
    containers: new Map(),
    dockerOkAt: null,
    dockerError: false,
    probes: new Map(),
    changedAt: new Map(),
    frames: new Map(),
    lastStatus: new Map(),
  };
}

/** The process-wide state. A singleton on `globalThis`, so HMR and separate bundles share it. */
export function getState(): AppState {
  globalThis.__iris ??= createState();
  return globalThis.__iris;
}

function dockerFresh(state: AppState, now: number): boolean {
  return state.dockerOkAt !== null && now - state.dockerOkAt <= DOCKER_STALE_MS;
}

function services(state: AppState): ResolvedService[] {
  return state.discovery?.groups.flatMap((g) => g.services) ?? [];
}

function embedOf(state: AppState, s: ResolvedService): ServiceEntry['embed'] {
  const hasAddress = s.url !== null || s.lan !== null;
  const record = state.frames.get(s.id) ?? null;
  const verdict = embedVerdict(s.embed.mode, hasAddress, record?.frame ?? null);
  // `checkedAt` is set only when the verdict came from a frame read.
  const fromFrame = s.embed.mode === 'auto' && hasAddress && record !== null;
  return {
    ...verdict,
    checkedAt: fromFrame ? new Date(record.at).toISOString() : null,
  };
}

export function buildServicesResponse(state: AppState, now: number): ServicesResponse {
  const discovery = state.discovery;
  const generatedAt = new Date(now).toISOString();
  // `ok` also needs a discovery built from a Docker list, not from the failed round before it:
  // the browser prunes its open tabs only from an `ok` answer (I1).
  const docker =
    dockerFresh(state, now) && (discovery === null || discovery.sources.docker === 'ok')
      ? 'ok'
      : 'unreachable';
  if (discovery === null) {
    return {
      generatedAt,
      sources: { docker, manual: 'ok' },
      groups: [],
      links: [],
      warnings: [{ code: 'STARTING', message: 'Discovery has not run yet' }],
    };
  }
  return {
    generatedAt,
    sources: { docker, manual: discovery.sources.manual },
    groups: discovery.groups.map((g) => ({
      name: g.name,
      icon: g.icon,
      services: g.services.map((s) => ({ ...toPublicService(s), embed: embedOf(state, s) })),
    })),
    links: discovery.links,
    warnings: discovery.warnings,
  };
}

function statusOf(
  state: AppState,
  s: ResolvedService,
  now: number,
): { status: ServiceStatus; entry: Omit<ServiceStatusEntry, 'status' | 'changedAt'> } {
  const fresh = dockerFresh(state, now);
  const hasContainer = s.containerName !== null;
  const container = s.containerName === null ? undefined : state.containers.get(s.containerName);
  const http = state.probes.get(s.id) ?? null;
  const status = reduceStatus({
    docker: container ? { state: container.state, health: container.health } : null,
    http,
    // Ruling R17: a service with a health target but no result is unknown, not skipped.
    probeConfigured: s.health.kind !== 'none',
    hasContainer,
    dockerFresh: fresh,
    containerMissing: hasContainer && container === undefined,
  });
  return {
    status,
    entry: {
      docker:
        container && fresh
          ? {
              state: container.state,
              health: container.health,
              failingStreak: container.failingStreak,
              statusText: container.statusText,
            }
          : null,
      http: http
        ? {
            ok: http.ok,
            code: http.code,
            latencyMs: http.latencyMs,
            reason: http.reason,
            checkedAt: http.checkedAt,
          }
        : null,
    },
  };
}

/**
 * Records a status change time for each listed service: the first time Iris sees a service, and
 * every time its status differs from the last one seen. Services that are gone are dropped.
 * Safe to call as often as wanted.
 */
export function observeStatuses(state: AppState, now: number): Map<string, ServiceStatus> {
  const statuses = new Map<string, ServiceStatus>();
  const iso = new Date(now).toISOString();
  for (const s of services(state)) {
    const { status } = statusOf(state, s, now);
    statuses.set(s.id, status);
    if (state.lastStatus.get(s.id) !== status || !state.changedAt.has(s.id)) {
      state.lastStatus.set(s.id, status);
      state.changedAt.set(s.id, iso);
    }
  }
  for (const id of [...state.changedAt.keys()])
    if (!statuses.has(id)) {
      state.changedAt.delete(id);
      state.lastStatus.delete(id);
    }
  return statuses;
}

export function buildStatusResponse(state: AppState, now: number): StatusResponse {
  observeStatuses(state, now);
  const entries: Record<string, ServiceStatusEntry> = {};
  for (const s of services(state)) {
    const { status, entry } = statusOf(state, s, now);
    entries[s.id] = { status, ...entry, changedAt: state.changedAt.get(s.id) ?? null };
  }
  return {
    generatedAt: new Date(now).toISOString(),
    docker: dockerFresh(state, now) ? 'ok' : 'unreachable',
    services: entries,
    summary: summarize(Object.values(entries).map((e) => e.status)),
  };
}
