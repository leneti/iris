import 'server-only';
import { z } from 'zod';
import type { Adapter } from './fetcher';
import { parseReply } from './reply';

// The whole movie list, reduced to counts (no lighter call exists). 32 MiB cap; over it the
// fetcher rejects with "unreachable".
const MAX_BYTES = 32 * 1024 * 1024;
const schema = z.array(
  z.object({
    monitored: z.boolean().default(false),
    hasFile: z.boolean().default(false),
    isAvailable: z.boolean().default(false),
  }),
);

export const adapter: Adapter = {
  type: 'radarr',
  defaultFields: ['wanted', 'movies'],
  extraFields: ['missing'],
  labels: { wanted: 'Wanted', movies: 'Movies', missing: 'Missing' },
  credentials: (env) => (env.radarrKey ? { key: env.radarrKey } : null),
  async fetch(ctx) {
    const res = await ctx.get('/api/v3/movie', {
      headers: { 'X-Api-Key': ctx.creds.key! },
      maxBytes: MAX_BYTES,
    });
    const movies = parseReply(res, schema);
    let wanted = 0;
    let missing = 0;
    for (const m of movies) {
      if (!m.monitored || m.hasFile) continue;
      missing += 1;
      if (m.isAvailable) wanted += 1;
    }
    return { wanted, movies: movies.length, missing };
  },
};
