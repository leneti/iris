import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadEnv } from '@/lib/server/env';
import { isAllowedHost, normalizeHost, securityHeaders } from '@/lib/server/headers';

// The icon route answers with its own sandboxing CSP. Next applies the proxy's headers first
// and does not overwrite them from the route, so the proxy must set the same value here.
const ICON_CSP = "default-src 'none'; sandbox";

function isIconPath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true; // undecodable: the stricter policy is always safe
  }
  return decoded.toLowerCase().startsWith('/api/icons/');
}

// No `runtime` export: proxy.ts always runs on Node.js in Next 16 and setting it throws.
// The decision reads only the Host header; the matcher decides which paths get here.
export function proxy(request: NextRequest): NextResponse {
  const env = loadEnv();
  const host = normalizeHost(request.headers.get('host'));
  if (host === null || !isAllowedHost(host, env.allowedHosts)) {
    return new NextResponse('Bad Request', {
      status: 400,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  }
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(securityHeaders(host, env)))
    response.headers.set(name, value);
  if (isIconPath(request.nextUrl.pathname))
    response.headers.set('Content-Security-Policy', ICON_CSP);
  return response;
}

// Everything except the health check, static files and /_next included (§14.2).
export const config = {
  matcher: ['/((?!api/healthz$).*)'],
};
