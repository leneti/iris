import 'server-only';
import { z } from 'zod';
import { IntegrationError, LOGIN_PATH, type Adapter, type AdapterContext } from './fetcher';
import { parseReply } from './reply';
import { shared } from '../shared';

// qBittorrent (D1.12). It may answer without a sign-in (the user's does today), so every read
// starts without credentials. Only a 403 triggers `POST /api/v2/auth/login`, and only when both
// the user name and the password are set. The `SID` cookie stays in memory, per service, and is
// sent in a header. It is never logged or returned, and neither is the password.
const torrents = z.array(z.object({ state: z.string() }));
const transfer = z.object({
  dl_info_speed: z.number().finite().nonnegative(),
  up_info_speed: z.number().finite().nonnegative(),
});

const sessions = shared('qbittorrent:sessions', () => new Map<string, string>());
// qBittorrent bans a client address after about 5 failed sign-ins (1 h by default). After a
// refused or ineffective sign-in, none is tried again for this long; the tile says `unauthorized`.
const COOL_DOWN_MS = 5 * 60_000;
const blockedUntil = shared('qbittorrent:blockedUntil', () => new Map<string, number>());
const keyOf = (ctx: AdapterContext): string => ctx.widget?.url ?? ctx.widget?.host ?? '';

/** The value of `SID` in a (possibly joined) Set-Cookie header, or null. */
function sidFrom(setCookie: string | undefined): string | null {
  if (setCookie === undefined) return null;
  const match = /(?:^|[\s,;])SID=([^;,\s]+)/.exec(setCookie);
  return match?.[1] ?? null;
}

async function signIn(ctx: AdapterContext, key: string): Promise<string> {
  const { username, password } = ctx.creds;
  if (!username || !password || ctx.post === undefined) throw new IntegrationError('unauthorized');
  const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const res = await ctx.post(LOGIN_PATH, body, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const sid = sidFrom(res.headers['set-cookie']);
  if (sid === null) throw new IntegrationError('unauthorized'); // "Fails." arrives with status 200
  sessions.set(key, sid);
  return sid;
}

async function read(ctx: AdapterContext, path: string) {
  const key = keyOf(ctx);
  const withCookie = (sid: string | undefined) =>
    ctx.get(path, sid === undefined ? {} : { headers: { Cookie: `SID=${sid}` } });
  const sid = sessions.get(key);
  let res: Awaited<ReturnType<typeof withCookie>>;
  try {
    res = await withCookie(sid);
  } catch (err) {
    if (!(err instanceof IntegrationError) || err.code !== 'unauthorized') throw err;
    if (sid !== undefined) sessions.delete(key);
    if (Date.now() < (blockedUntil.get(key) ?? 0)) throw err;
    const block = () => blockedUntil.set(key, Date.now() + COOL_DOWN_MS);
    let fresh: string;
    try {
      fresh = await signIn(ctx, key);
    } catch (e) {
      if (e instanceof IntegrationError && e.code === 'unauthorized' && ctx.creds.password) block();
      throw e;
    }
    try {
      res = await withCookie(fresh); // one retry; a second 403 is the answer
    } catch (e) {
      sessions.delete(key);
      if (e instanceof IntegrationError && e.code === 'unauthorized') block();
      throw e;
    }
  }
  blockedUntil.delete(key);
  return res;
}

const leeching = (state: string) => state.includes('DL') || state === 'downloading';
const seeding = (state: string) => state.includes('UP') || state === 'uploading';

export const adapter: Adapter = {
  type: 'qbittorrent',
  defaultFields: ['leech', 'download', 'seed', 'upload'],
  extraFields: [],
  labels: { leech: 'Leeching', seed: 'Seeding', download: 'Down', upload: 'Up' },
  // The pair only travels in the sign-in body and the read paths are fixed, so the URL check
  // could only refuse reads by accident (a password such as "info").
  pathCreds: ['username', 'password'],
  units: { download: 'bytes-per-second', upload: 'bytes-per-second' },
  // Credentials are optional, so "not configured" never applies: an empty record means "try
  // without". The pair is passed on only when both are set.
  credentials: (env): Record<string, string> =>
    env.qbittorrentUsername && env.qbittorrentPassword
      ? { username: env.qbittorrentUsername, password: env.qbittorrentPassword }
      : {},
  async fetch(ctx) {
    // In order, so that at most one sign-in happens per read.
    const list = parseReply(await read(ctx, '/api/v2/torrents/info'), torrents);
    const info = parseReply(await read(ctx, '/api/v2/transfer/info'), transfer);
    return {
      leech: list.filter((t) => leeching(t.state)).length,
      seed: list.filter((t) => seeding(t.state)).length,
      download: info.dl_info_speed,
      upload: info.up_info_speed,
    };
  },
};
