import { getState, buildServicesResponse } from '@/lib/server/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No request input is read: the response depends only on what the pollers found.
export async function GET() {
  return Response.json(buildServicesResponse(getState(), Date.now()), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
