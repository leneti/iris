import 'server-only';
import { z } from 'zod';
import type { Adapter } from './fetcher';
import { parseReply } from './reply';

// Gotify with a client token in `X-Gotify-Key` (D1.12). `/message` returns one page, at most 100
// here, so a next page means "100+" (shown as such) rather than the page size read as a total.
const list = z.array(z.unknown());
const messages = z.object({
  messages: z.array(z.unknown()),
  paging: z.object({ next: z.string().optional() }).optional(),
});

export const adapter: Adapter = {
  type: 'gotify',
  defaultFields: ['apps', 'clients', 'messages'],
  extraFields: [],
  labels: { apps: 'Apps', clients: 'Clients', messages: 'Messages' },
  credentials: (env) => (env.gotifyToken ? { key: env.gotifyToken } : null),
  async fetch(ctx) {
    const headers = { 'X-Gotify-Key': ctx.creds.key! };
    const [apps, clients, page] = await Promise.all([
      ctx.get('/application', { headers }),
      ctx.get('/client', { headers }),
      ctx.get('/message?limit=100', { headers }),
    ]);
    const m = parseReply(page, messages);
    const count = m.messages.length;
    return {
      apps: parseReply(apps, list).length,
      clients: parseReply(clients, list).length,
      messages: m.paging?.next ? { value: count, atLeast: true } : count,
    };
  },
};
