import 'server-only';
import { z } from 'zod';
import { createTtlCache } from '../cache';
import { getConfigWatcher } from '../config/services';
import { loadEnv, type ServerEnv } from '../env';
import { httpRequest } from '../http';
import { log } from '../log';
import type { StreamsResponse } from '@/lib/shared/contract';

// The Now playing panel (D1.11, §8.5) and the Plex tile's source (Task 15). One
// GET {url}/api/v2?cmd=get_activity with the key in the X-Api-Key header, at most once per 15 s
// through the TTL cache, however many places ask (criterion 11.12). The key is never in a URL,
// a log line or a response.

export type ActivityState = StreamsResponse['source']['state'];

const TTL_MS = 15_000;
/** D1.11: when Tautulli is unreachable the last values are kept this long. */
const KEEP_MS = 60_000;
const TIMEOUT_MS = 5000;
const MAX_BYTES = 1024 * 1024;

// Tautulli sends most numbers as strings. Anything missing or odd becomes null or a default.
const text = z.union([z.string(), z.number()]).transform(String).nullable().catch(null);
const numeric = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'string' && v.trim() === '' ? NaN : Number(v)))
  .pipe(z.number().finite())
  .nullable()
  .catch(null);

const SessionSchema = z.object({
  media_type: text,
  title: text,
  grandparent_title: text,
  parent_media_index: numeric,
  media_index: numeric,
  full_title: text,
  year: text,
  friendly_name: text,
  user: text,
  player: text,
  product: text,
  state: text,
  progress_percent: numeric,
  transcode_decision: text,
  location: text,
});
export type TautulliSession = z.infer<typeof SessionSchema>;

const ActivitySchema = z.object({
  response: z.object({
    result: z.string(),
    message: z.string().nullish(),
    data: z
      .object({
        stream_count: numeric,
        total_bandwidth: numeric,
        sessions: z.array(SessionSchema.catch(null as never)).catch([]),
      })
      .nullish(),
  }),
});

export type TautulliActivity = {
  streamCount: number;
  /** kbit/s as Tautulli reports it, or null. */
  totalBandwidthKbps: number | null;
  sessions: TautulliSession[];
};

class UnauthorizedError extends Error {
  constructor() {
    super('Tautulli refused the key');
    this.name = 'UnauthorizedError';
  }
}

async function fetchActivity(base: string, key: string): Promise<TautulliActivity> {
  const res = await httpRequest({
    url: `${base}/api/v2?cmd=get_activity`,
    headers: { accept: 'application/json', 'x-api-key': key },
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
  });
  if (res.status === 401 || res.status === 403) throw new UnauthorizedError();
  if (res.status !== 200) throw new Error(`Tautulli answered ${res.status}`);
  const { response } = ActivitySchema.parse(JSON.parse(res.body.toString('utf8')));
  if (response.result !== 'success') {
    // Older Tautulli answers a bad key with 200 and an error body.
    if (/api ?key/i.test(response.message ?? '')) throw new UnauthorizedError();
    throw new Error('Tautulli reported an error');
  }
  const sessions = (response.data?.sessions ?? []).filter((s) => s !== null);
  return {
    streamCount: sessions.length,
    totalBandwidthKbps: response.data?.total_bandwidth ?? null,
    sessions,
  };
}

export type Activity = {
  state: ActivityState;
  /** Epoch ms of the last successful read, or null. */
  fetchedAt: number | null;
  raw: TautulliActivity | null;
};

const cache = createTtlCache();
let env: ServerEnv | undefined;
let lastState: ActivityState | undefined;

function logChange(state: ActivityState): void {
  if (state === lastState) return;
  if (state === 'unreachable' || state === 'unauthorized') log.warn(`tautulli ${state}`);
  else if (lastState === 'unreachable' || lastState === 'unauthorized')
    log.info('tautulli recovered');
  lastState = state;
}

export async function getActivity(): Promise<Activity> {
  env ??= loadEnv();
  const url = getConfigWatcher().get().iris.config.streams?.url.trim();
  const key = env.tautulliKey;
  if (!url || key === undefined) return { state: 'not-configured', fetchedAt: null, raw: null };

  const base = url.replace(/\/+$/, '');
  const r = await cache.get(`tautulli:${base}`, TTL_MS, () => fetchActivity(base, key));
  if (r.error === null) {
    logChange('ok');
    return { state: 'ok', fetchedAt: r.fetchedAt, raw: r.value };
  }
  if (r.error instanceof UnauthorizedError) {
    logChange('unauthorized');
    return { state: 'unauthorized', fetchedAt: null, raw: null };
  }
  logChange('unreachable');
  const fresh = r.fetchedAt !== null && Date.now() - r.fetchedAt <= KEEP_MS;
  return {
    state: 'unreachable',
    fetchedAt: r.fetchedAt,
    raw: fresh ? r.value : null,
  };
}

// ---- activity to response ----

const cut = (v: string | null, n: number): string =>
  (v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const pad = (n: number): string => String(Math.trunc(n)).padStart(2, '0');

function titleOf(s: TautulliSession): string {
  let t: string;
  if (s.media_type === 'episode' && s.grandparent_title) {
    const ep =
      s.parent_media_index !== null && s.media_index !== null
        ? ` · S${pad(s.parent_media_index)} E${pad(s.media_index)}`
        : s.title
          ? ` · ${s.title}`
          : '';
    t = `${s.grandparent_title}${ep}`;
  } else if (s.title) {
    t = s.year ? `${s.title} (${s.year})` : s.title;
  } else {
    t = s.full_title ?? '';
  }
  return cut(t, 120) || 'Unknown title';
}

function toSession(
  s: TautulliSession,
  i: number,
  showUsers: boolean,
): StreamsResponse['sessions'][number] {
  const kind = /^[a-z]{1,20}$/.exec((s.media_type ?? '').toLowerCase())?.[0] ?? 'unknown';
  const state = s.state === 'paused' || s.state === 'buffering' ? s.state : 'playing';
  const decision =
    s.transcode_decision === 'transcode'
      ? 'transcode'
      : s.transcode_decision === 'copy'
        ? 'copy'
        : 'direct-play';
  return {
    id: String(i + 1),
    title: titleOf(s),
    mediaType: kind,
    user: showUsers ? cut(s.friendly_name ?? s.user, 60) || null : null,
    player: cut(s.player ?? s.product, 60) || 'Unknown player',
    state,
    progressPercent: Math.min(100, Math.max(0, Math.round(s.progress_percent ?? 0))),
    decision,
    location: s.location === 'lan' ? 'lan' : 'wan',
  };
}

export function toStreams(
  a: Activity,
  showUsers: boolean,
  now: Date = new Date(),
): StreamsResponse {
  const sessions = (a.raw?.sessions ?? []).map((s, i) => toSession(s, i, showUsers));
  const kbps = a.raw?.totalBandwidthKbps ?? null;
  return {
    generatedAt: now.toISOString(),
    source: {
      state: a.state,
      fetchedAt: a.fetchedAt === null ? null : new Date(a.fetchedAt).toISOString(),
    },
    streamCount: sessions.length,
    transcodeCount: sessions.filter((s) => s.decision === 'transcode').length,
    totalBitsPerSec: kbps === null ? null : Math.round(kbps * 1000),
    sessions,
  };
}
