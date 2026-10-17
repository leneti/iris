import type { GroupEntry, ServicesResponse } from '@/lib/shared/contract';

/**
 * Whether a `/api/services` answer is a real, complete list. The server answers `STARTING` with
 * no groups before discovery has run, and marks `sources.docker` as not ok while Docker has not
 * been read (or the last read failed), when only the manual entries are listed. Open tabs are
 * restored and pruned from a ready answer only, and the last ready list stays on screen (§7.4).
 */
export function isDiscoveryReady(services: ServicesResponse): boolean {
  return services.sources.docker === 'ok' && !services.warnings.some((w) => w.code === 'STARTING');
}

/**
 * The groups as lists show them: services hidden in iris.yaml are left out, and so is a group
 * they leave empty. Search, health counts and alerts still use every service.
 */
export function shownGroups(groups: GroupEntry[]): GroupEntry[] {
  return groups.flatMap((g) => {
    const services = g.services.filter((s) => s.hidden !== true);
    return services.length === 0 ? [] : [{ ...g, services }];
  });
}
