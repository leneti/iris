import { getSystem } from '@/lib/server/panels/glances';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No request input is read: the response depends only on Glances and iris.yaml.
export async function GET() {
  return Response.json(await getSystem(new Date()), { headers: { 'Cache-Control': 'no-store' } });
}
