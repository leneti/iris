import 'server-only';
import { z } from 'zod';
import { httpRequest } from '../http';

// GET <cron-status>/cron-status (handoff D1.5): a list of jobs with name, status, lastRun,
// message and optionally url, plus two presentation fields (`dot`, `details`) that Iris
// ignores. One read-only GET with a 3 s timeout; the cache above it makes it one per minute.

export const CRON_STATUS_TIMEOUT_MS = 3000;
const MAX_BYTES = 1024 * 1024;

export type CronStatusJob = {
  name: string;
  status: 'success' | 'warning' | 'failed' | 'unknown';
  lastRun: Date | null;
  /** As the job wrote it. `buildCronResponse` makes it plain text and cuts it. */
  message: string | null;
  /** As the job wrote it. `buildCronResponse` keeps only http and https. */
  url: string | null;
};

// zod objects drop keys they do not name, which is how `details` and `dot` go.
const JobSchema = z.object({
  name: z.string().min(1),
  status: z.string(),
  lastRun: z.string().nullish(),
  message: z.string().nullish(),
  url: z.string().nullish(),
});
const ListSchema = z.array(JobSchema);

function parseDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export async function fetchCronStatus(url: string): Promise<CronStatusJob[]> {
  const res = await httpRequest({
    url,
    headers: { accept: 'application/json' },
    timeoutMs: CRON_STATUS_TIMEOUT_MS,
    maxBytes: MAX_BYTES,
  });
  if (res.status !== 200) throw new Error(`cron-status answered ${res.status}`);
  const list = ListSchema.parse(JSON.parse(res.body.toString('utf8')));
  return list.map((job) => ({
    name: job.name,
    status:
      job.status === 'success' || job.status === 'warning' || job.status === 'failed'
        ? job.status
        : 'unknown',
    lastRun: parseDate(job.lastRun),
    message: job.message ?? null,
    url: job.url ?? null,
  }));
}
