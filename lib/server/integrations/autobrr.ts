import 'server-only';
import { z } from 'zod';
import type { Adapter } from './fetcher';
import { parseReply } from './reply';

const count = z.number().finite().nonnegative();
const schema = z.object({
  push_approved_count: count,
  push_rejected_count: count,
  filtered_count: count.default(0),
});

export const adapter: Adapter = {
  type: 'autobrr',
  defaultFields: ['approvedPushes', 'rejectedPushes'],
  extraFields: ['filtered'],
  labels: { approvedPushes: 'Approved', rejectedPushes: 'Rejected', filtered: 'Filtered' },
  credentials: (env) => (env.autobrrKey ? { key: env.autobrrKey } : null),
  async fetch(ctx) {
    const res = await ctx.get('/api/release/stats', { headers: { 'X-API-Token': ctx.creds.key! } });
    const s = parseReply(res, schema);
    return {
      approvedPushes: s.push_approved_count,
      rejectedPushes: s.push_rejected_count,
      filtered: s.filtered_count,
    };
  },
};
