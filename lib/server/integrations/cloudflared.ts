import 'server-only';
import { z } from 'zod';
import { IntegrationError, type Adapter } from './fetcher';
import { parseReply } from './reply';

// The Cloudflare tunnel's status (D1.12). The reply also holds the tunnel's connections with
// their origin addresses; the schema names `result.status` and nothing else, so zod drops the
// rest and no address can reach the browser or a log line.
const ID = /^[A-Za-z0-9-]+$/;
const schema = z.object({
  result: z.object({ status: z.enum(['healthy', 'degraded', 'down', 'inactive']) }),
});

export const adapter: Adapter = {
  type: 'cloudflared',
  defaultFields: ['status'],
  extraFields: [],
  labels: { status: 'Tunnel status' },
  baseUrl: 'https://api.cloudflare.com',
  // The two ids are path segments, not secrets. The token goes in a header and is refused in a URL.
  pathCreds: ['account', 'tunnel'],
  // Missing variables mean "not configured". Ids that are present but malformed are a mistake
  // worth showing: `fetch` refuses them as "unreachable" before anything is sent.
  credentials: (env) =>
    env.cloudflareAccountId && env.cloudflareTunnelId && env.cloudflareToken
      ? {
          account: env.cloudflareAccountId,
          tunnel: env.cloudflareTunnelId,
          token: env.cloudflareToken,
        }
      : null,
  async fetch(ctx) {
    const { account, tunnel, token } = ctx.creds;
    if (!account || !tunnel || !token || !ID.test(account) || !ID.test(tunnel))
      throw new IntegrationError('unreachable');
    const res = await ctx.get(`/client/v4/accounts/${account}/cfd_tunnel/${tunnel}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: parseReply(res, schema).result.status };
  },
};
