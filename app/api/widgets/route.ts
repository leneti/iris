import { getConfigWatcher } from '@/lib/server/config/services';
import { loadEnv, type ServerEnv } from '@/lib/server/env';
import { getWidgets } from '@/lib/server/integrations/registry';
import { getState } from '@/lib/server/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let env: ServerEnv | undefined;

// No request input is read: the response depends only on the discovered services, the
// dashboard config and the environment, and every upstream call is built by the fetcher from
// those (criterion 11.8).
export async function GET() {
  env ??= loadEnv();
  const config = getConfigWatcher().get().dashboard.config;
  return Response.json(await getWidgets(getState(), config, env, Date.now()), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
