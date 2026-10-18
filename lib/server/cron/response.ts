import 'server-only';
import type { CronResponse } from '@/lib/shared/contract';
import { createTtlCache } from '../cache';
import { getConfigWatcher } from '../config/services';
import { loadEnv, type ServerEnv } from '../env';
import { log } from '../log';
import { buildCronResponse } from './build';
import { fetchCronStatus } from './cron-status';
import { readHostStatus } from './host-status';

const CRON_STATUS_TTL_MS = 60_000;

const cache = createTtlCache();
let env: ServerEnv | undefined;
let wasDown = false;

/**
 * The body of `/api/cron`. The route and the page's first render both call it, so they share the
 * cron-status cache and the outage log line. No request input is read: the response depends only
 * on the two sources and iris.yaml.
 */
export async function getCronResponse(now: Date): Promise<CronResponse> {
  env ??= loadEnv();

  let cronStatus: Parameters<typeof buildCronResponse>[0]['cronStatus'];
  const url = env.cronStatusUrl;
  if (url === undefined) {
    cronStatus = { state: 'not-configured', fetchedAt: null, jobs: [] };
  } else {
    const r = await cache.get('cron-status', CRON_STATUS_TTL_MS, () => fetchCronStatus(url));
    const down = r.error !== null;
    // One line per outage, not one per poll. Name only: a message can carry the address.
    if (down && !wasDown)
      log.warn('cron-status unreachable', {
        error: r.error instanceof Error ? r.error.name : typeof r.error,
      });
    if (!down && wasDown) log.info('cron-status recovered');
    wasDown = down;
    cronStatus = {
      state: down ? 'unreachable' : 'ok',
      fetchedAt: r.fetchedAt === null ? null : new Date(r.fetchedAt),
      jobs: r.value ?? [],
    };
  }

  return buildCronResponse({
    now,
    config: getConfigWatcher().get().iris.config,
    cronStatus,
    hostStatus: readHostStatus(env.hostStatusFile, now),
  });
}
