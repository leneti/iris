import type { ServiceStatus } from '@/lib/shared/contract';

/** Worst first (handoff 7.4). */
export const WORST_FIRST: readonly ServiceStatus[] = [
  'unhealthy',
  'stopped',
  'degraded',
  'starting',
  'unknown',
  'healthy',
];

export function worstStatus(statuses: readonly ServiceStatus[]): ServiceStatus {
  for (const s of WORST_FIRST) if (statuses.includes(s)) return s;
  return 'unknown';
}

/** A service is down when it is unhealthy. Stopped is deliberately grey, not down. */
export const isDown = (s: ServiceStatus | undefined): boolean => s === 'unhealthy';
