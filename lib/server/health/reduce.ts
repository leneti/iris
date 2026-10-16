import 'server-only';
import type { ServiceStatus } from '@/lib/shared/contract';
import type { ContainerSummary } from '../docker/parse';
import type { ProbeResult } from './probe';

// Handoff §7.4.

const STOPPED_STATES = new Set(['exited', 'dead', 'created', 'paused']);

/** Worst first: the order a group header and the status strip use. */
const WORST_FIRST: readonly ServiceStatus[] = [
  'unhealthy',
  'stopped',
  'degraded',
  'starting',
  'unknown',
  'healthy',
];

export type ReduceInput = {
  docker: { state: string; health: ContainerSummary['health'] } | null;
  /** null means "not configured" when `probeConfigured` is false, otherwise "no result" (proxy unreachable or nothing yet). */
  http: ProbeResult | null;
  /** The service has a health target, so a missing result is unknown rather than skipped. */
  probeConfigured: boolean;
  /** The entry is backed by a container. */
  hasContainer: boolean;
  /** The last successful Docker list is at most 30 s old. */
  dockerFresh: boolean;
  /** A label or config entry names a container that does not exist. */
  containerMissing: boolean;
};

export function reduceStatus(i: ReduceInput): ServiceStatus {
  if (i.containerMissing) return 'unknown';

  if (!i.hasContainer) {
    // No container: the probe is the only source, and a failed probe is `unhealthy`.
    if (i.http === null) return 'unknown';
    return i.http.ok ? 'healthy' : 'unhealthy';
  }

  if (!i.dockerFresh || i.docker === null) return 'unknown';
  const { state, health } = i.docker;
  if (STOPPED_STATES.has(state)) return 'stopped';
  if (health === 'unhealthy') return 'unhealthy';
  if (state === 'restarting' || health === 'starting') return 'starting';
  if (state !== 'running') return 'unknown';
  if (i.http === null) return i.probeConfigured ? 'unknown' : 'healthy';
  return i.http.ok ? 'healthy' : 'degraded';
}

export function worstOf(statuses: readonly ServiceStatus[]): ServiceStatus {
  for (const candidate of WORST_FIRST) if (statuses.includes(candidate)) return candidate;
  return 'unknown';
}

export function summarize(statuses: readonly ServiceStatus[]): Record<ServiceStatus, number> {
  const counts: Record<ServiceStatus, number> = {
    healthy: 0,
    starting: 0,
    degraded: 0,
    unhealthy: 0,
    stopped: 0,
    unknown: 0,
  };
  for (const status of statuses) counts[status] += 1;
  return counts;
}
