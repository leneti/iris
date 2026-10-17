import { createTtlCache } from '@/lib/server/cache';
import { getConfigWatcher } from '@/lib/server/config/services';
import { loadEnv, type ServerEnv } from '@/lib/server/env';
import { log } from '@/lib/server/log';
import { buildCronResponse } from '@/lib/server/cron/build';
import { fetchCronStatus } from '@/lib/server/cron/cron-status';
import { readHostStatus } from '@/lib/server/cron/host-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRON_STATUS_TTL_MS = 60_000;

const cache = createTtlCache();
let env: ServerEnv | undefined;
let wasDown = false;

// No request input is read: the response depends only on the two sources and iris.yaml.
export async function GET() {
  env ??= loadEnv();
  const now = new Date();

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

  const body = buildCronResponse({
    now,
    config: getConfigWatcher().get().iris.config,
    cronStatus,
    hostStatus: readHostStatus(env.hostStatusFile, now),
  });
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
