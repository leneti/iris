import 'server-only';
import { z } from 'zod';
import type { Adapter } from './fetcher';
import { parseReply } from './reply';

const SERIES_TTL_MS = 300_000;
const SERIES_MAX_BYTES = 32 * 1024 * 1024;
const wantedSchema = z.object({ totalRecords: z.number().finite().nonnegative() });
const seriesSchema = z.array(z.unknown());

export const adapter: Adapter = {
  type: 'sonarr',
  defaultFields: ['wanted', 'series'],
  extraFields: [],
  labels: { wanted: 'Wanted', series: 'Series' },
  credentials: (env) => (env.sonarrKey ? { key: env.sonarrKey } : null),
  async fetch(ctx) {
    const headers = { 'X-Api-Key': ctx.creds.key! };
    const [wantedRes, series] = await Promise.all([
      ctx.get('/api/v3/wanted/missing?page=1&pageSize=1', { headers }),
      // The series list is large and changes slowly: its own 5 minute cache key.
      ctx.cached('series', SERIES_TTL_MS, async () => {
        const res = await ctx.get('/api/v3/series', { headers, maxBytes: SERIES_MAX_BYTES });
        return parseReply(res, seriesSchema).length;
      }),
    ]);
    return { wanted: parseReply(wantedRes, wantedSchema).totalRecords, series };
  },
};
