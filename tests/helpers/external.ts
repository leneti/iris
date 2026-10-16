import { httpRequest, type HttpResult } from '@/lib/server/http';

type Reply = string | { status: number; body?: string };

/**
 * Stands in for the network: the calling test file mocks `@/lib/server/http`. `routes` maps the
 * request's path and query to a reply; anything else is 404. Returns the options of every call.
 */
export function serve(routes: Record<string, Reply>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  vi.mocked(httpRequest).mockImplementation(async (opts) => {
    const u = new URL(opts.url);
    calls.push({ url: opts.url, headers: opts.headers ?? {} });
    const r = routes[u.pathname + u.search];
    const { status, body } =
      r === undefined
        ? { status: 404, body: '' }
        : typeof r === 'string'
          ? { status: 200, body: r }
          : r;
    const result: HttpResult = {
      status,
      headers: {},
      body: Buffer.from(body ?? ''),
      url: opts.url,
      redirects: 0,
    };
    return result;
  });
  return calls;
}
