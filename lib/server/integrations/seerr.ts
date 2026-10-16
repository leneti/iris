import 'server-only';
import { z } from 'zod';
import type { Adapter } from './fetcher';
import { parseReply } from './reply';

const count = z.number().finite().nonnegative();
const schema = z.object({
  pending: count,
  available: count,
  approved: count.default(0),
  processing: count.default(0),
});

export const adapter: Adapter = {
  type: 'seerr',
  defaultFields: ['pending', 'available'],
  extraFields: ['approved', 'processing'],
  labels: {
    pending: 'Pending',
    available: 'Available',
    approved: 'Approved',
    processing: 'Processing',
  },
  credentials: (env) => (env.seerrKey ? { key: env.seerrKey } : null),
  async fetch(ctx) {
    const res = await ctx.get('/api/v1/request/count', {
      headers: { 'X-Api-Key': ctx.creds.key! },
    });
    const { pending, available, approved, processing } = parseReply(res, schema);
    return { pending, available, approved, processing };
  },
};
