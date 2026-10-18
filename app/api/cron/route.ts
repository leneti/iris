import { getCronResponse } from '@/lib/server/cron/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No request input is read: the response depends only on the two sources and iris.yaml.
export async function GET() {
  return Response.json(await getCronResponse(new Date()), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
