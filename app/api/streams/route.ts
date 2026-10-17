import { getConfigWatcher } from '@/lib/server/config/services';
import { getActivity, toStreams } from '@/lib/server/panels/tautulli';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No request input is read: the response depends only on Tautulli and iris.yaml.
export async function GET() {
  const showUsers = getConfigWatcher().get().iris.config.streams?.showUsers ?? true;
  return Response.json(toStreams(await getActivity(), showUsers), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
