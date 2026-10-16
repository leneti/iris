import 'server-only';
import { z } from 'zod';
import type { Adapter } from './fetcher';
import { parseReply } from './reply';

const count = z.number().finite().nonnegative().default(0);
const schema = z.object({
  indexers: z.array(
    z.object({
      numberOfGrabs: count,
      numberOfQueries: count,
      numberOfFailedGrabs: count,
      numberOfFailedQueries: count,
    }),
  ),
});

export const adapter: Adapter = {
  type: 'prowlarr',
  defaultFields: ['numberOfGrabs', 'numberOfQueries'],
  extraFields: ['failedGrabs', 'failedQueries'],
  labels: {
    numberOfGrabs: 'Grabs',
    numberOfQueries: 'Queries',
    failedGrabs: 'Failed grabs',
    failedQueries: 'Failed queries',
  },
  credentials: (env) => (env.prowlarrKey ? { key: env.prowlarrKey } : null),
  async fetch(ctx) {
    const res = await ctx.get('/api/v1/indexerstats', { headers: { 'X-Api-Key': ctx.creds.key! } });
    const { indexers } = parseReply(res, schema);
    const sum = (pick: (i: (typeof indexers)[number]) => number) =>
      indexers.reduce((total, i) => total + pick(i), 0);
    return {
      numberOfGrabs: sum((i) => i.numberOfGrabs),
      numberOfQueries: sum((i) => i.numberOfQueries),
      failedGrabs: sum((i) => i.numberOfFailedGrabs),
      failedQueries: sum((i) => i.numberOfFailedQueries),
    };
  },
};
