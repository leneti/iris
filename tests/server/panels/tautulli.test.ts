import { readFileSync } from 'node:fs';
import { StreamsResponse } from '@/lib/shared/contract';
import { httpRequest } from '@/lib/server/http';

vi.mock('@/lib/server/http', () => ({ httpRequest: vi.fn() }));

const BASE = 'http://tautulli.example.invalid:8181';
const KEY = 'test-key-7f3a91c2d4e8b605';
const fixture = readFileSync(
  new URL('../../fixtures/tautulli/activity.json', import.meta.url),
  'utf8',
);

let streamsCfg: { url: string; showUsers: boolean } | undefined;
vi.mock('@/lib/server/config/services', () => ({
  getConfigWatcher: () => ({ get: () => ({ dashboard: { config: { streams: streamsCfg } } }) }),
}));

function reply(body: string | object, status = 200) {
  vi.mocked(httpRequest).mockResolvedValue({
    status,
    headers: {},
    body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
    url: BASE,
    redirects: 0,
  });
}

async function load(key: string | undefined = KEY) {
  vi.resetModules();
  vi.stubEnv('DASHBOARD_TAUTULLI_KEY', key ?? '');
  const log = await import('@/lib/server/log');
  const mod = await import('@/lib/server/panels/tautulli');
  return { ...mod, log };
}

const out: string[] = [];

beforeEach(() => {
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => (out.push(String(s)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => (out.push(String(s)), true));
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
  vi.mocked(httpRequest).mockReset();
  streamsCfg = { url: BASE, showUsers: true };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getActivity', () => {
  test('GETs get_activity with the key in X-Api-Key only', async () => {
    reply(fixture);
    const { getActivity } = await load();
    const a = await getActivity();
    expect(a.state).toBe('ok');
    expect(a.fetchedAt).toBe(Date.now());
    const o = vi.mocked(httpRequest).mock.calls[0]![0];
    expect(o.url).toBe(`${BASE}/api/v2?cmd=get_activity`);
    expect(o.headers).toMatchObject({ 'x-api-key': KEY });
    expect(o.url).not.toContain(KEY);
    expect(o.method ?? 'GET').toBe('GET');
    expect(o.timeoutMs).toBeGreaterThan(0);
    expect(o.maxBytes).toBeGreaterThan(0);
  });

  test('one upstream call per 15 s however many callers (11.12)', async () => {
    reply(fixture);
    const { getActivity } = await load();
    await Promise.all([getActivity(), getActivity(), getActivity()]);
    await getActivity();
    expect(httpRequest).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    await getActivity();
    expect(httpRequest).toHaveBeenCalledTimes(2);
  });

  test('empty key: not-configured, nothing fetched (10.4)', async () => {
    reply(fixture);
    const { getActivity } = await load('');
    expect(await getActivity()).toEqual({ state: 'not-configured', fetchedAt: null, raw: null });
    expect(httpRequest).not.toHaveBeenCalled();
  });

  test('no streams block or empty url: not-configured', async () => {
    reply(fixture);
    const { getActivity } = await load();
    streamsCfg = undefined;
    expect((await getActivity()).state).toBe('not-configured');
    streamsCfg = { url: '', showUsers: true };
    expect((await getActivity()).state).toBe('not-configured');
    expect(httpRequest).not.toHaveBeenCalled();
  });

  test('401 and 403 are unauthorized, and an apikey error body too (10.4)', async () => {
    const { getActivity } = await load();
    reply('', 401);
    expect(await getActivity()).toEqual({ state: 'unauthorized', fetchedAt: null, raw: null });
    const again = await load();
    reply('', 403);
    expect((await again.getActivity()).state).toBe('unauthorized');
    const third = await load();
    reply({ response: { result: 'error', message: 'Invalid apikey', data: {} } });
    expect((await third.getActivity()).state).toBe('unauthorized');
  });

  test('other failures are unreachable', async () => {
    const { getActivity } = await load();
    vi.mocked(httpRequest).mockRejectedValue(new Error('connect ECONNREFUSED'));
    expect(await getActivity()).toEqual({ state: 'unreachable', fetchedAt: null, raw: null });
    const b = await load();
    reply('', 500);
    expect((await b.getActivity()).state).toBe('unreachable');
    const c = await load();
    reply('not json');
    expect((await c.getActivity()).state).toBe('unreachable');
  });

  test('last activity is kept for 60 s after Tautulli goes down, then dropped', async () => {
    reply(fixture);
    const { getActivity } = await load();
    await getActivity();
    vi.mocked(httpRequest).mockRejectedValue(new Error('down'));
    vi.advanceTimersByTime(15_000);
    let a = await getActivity();
    expect(a.state).toBe('unreachable');
    expect(a.raw?.sessions).toHaveLength(2);
    expect(a.fetchedAt).toBe(Date.parse('2026-10-16T12:00:00.000Z'));
    vi.advanceTimersByTime(45_000);
    a = await getActivity();
    expect(a.raw?.sessions).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    a = await getActivity();
    expect(a.state).toBe('unreachable');
    expect(a.raw).toBeNull();
  });

  test('the key never reaches a log line or the output, even from a failing upstream (10.3)', async () => {
    const { getActivity, toStreams, log } = await load();
    vi.mocked(httpRequest).mockRejectedValue(new Error(`GET ${BASE}?apikey=${KEY} failed`));
    const a = await getActivity();
    log.log.warn(`x ${KEY}`, { detail: KEY });
    reply(fixture);
    vi.advanceTimersByTime(60_000);
    const b = await getActivity();
    const text = JSON.stringify([a, b, toStreams(a, true), toStreams(b, true)]);
    expect(text).not.toContain(KEY);
    expect(out.join('')).not.toContain(KEY);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('toStreams', () => {
  async function ok(showUsers = true) {
    reply(fixture);
    const m = await load();
    return { ...m, streams: m.toStreams(await m.getActivity(), showUsers, new Date()) };
  }

  test('maps the placeholder streams (§12.1), parses with the contract, ids are positions', async () => {
    const { streams } = await ok();
    const body = StreamsResponse.parse(streams);
    expect(body.source).toEqual({ state: 'ok', fetchedAt: '2026-10-16T12:00:00.000Z' });
    expect(body.streamCount).toBe(2);
    expect(body.transcodeCount).toBe(1);
    expect(body.totalBitsPerSec).toBe(14_200_000);
    expect(body.sessions).toEqual([
      {
        id: '1',
        title: 'Example Show · S02 E05',
        mediaType: 'episode',
        user: 'alex',
        player: 'Living room TV',
        state: 'playing',
        progressPercent: 42,
        decision: 'direct-play',
        location: 'lan',
      },
      {
        id: '2',
        title: 'Example Film (2021)',
        mediaType: 'movie',
        user: 'sam',
        player: 'Phone',
        state: 'paused',
        progressPercent: 68,
        decision: 'transcode',
        location: 'wan',
      },
    ]);
  });

  test('user is null when showUsers is false', async () => {
    const { streams } = await ok(false);
    expect(streams.sessions.map((s) => s.user)).toEqual([null, null]);
    expect(JSON.stringify(streams)).not.toMatch(/alex|sam/);
  });

  test('nothing private leaves: no ip, session id, user id, email or path', async () => {
    const { streams } = await ok();
    const text = JSON.stringify(streams);
    for (const leak of [
      '192.0.2',
      '198.51.100',
      '203.0.113',
      'example-session',
      'example.invalid',
      '/example/media',
      'alex-login',
      '"101"',
    ])
      expect(text).not.toContain(leak);
  });

  test('decision maps direct play, copy, transcode; unknown states and decisions get safe values', async () => {
    const mk = (over: object) => ({
      response: {
        result: 'success',
        data: {
          stream_count: '1',
          total_bandwidth: 0,
          sessions: [
            {
              media_type: 'movie',
              title: 'T',
              year: '',
              friendly_name: 'u',
              player: 'P',
              state: 'playing',
              progress_percent: '5',
              transcode_decision: 'direct play',
              location: 'lan',
              ...over,
            },
          ],
        },
      },
    });
    const decisions: Array<[string, string]> = [
      ['direct play', 'direct-play'],
      ['copy', 'copy'],
      ['transcode', 'transcode'],
      ['weird', 'direct-play'],
    ];
    for (const [raw, want] of decisions) {
      reply(mk({ transcode_decision: raw }));
      const m = await load();
      expect(m.toStreams(await m.getActivity(), true).sessions[0]!.decision).toBe(want);
    }
    reply(mk({ state: 'buffering', progress_percent: '250', title: 'T'.repeat(300) }));
    const m = await load();
    const s = m.toStreams(await m.getActivity(), true).sessions[0]!;
    expect(s.state).toBe('buffering');
    expect(s.progressPercent).toBe(100);
    expect(s.title.length).toBeLessThanOrEqual(120);
  });

  test('no sessions: Nothing is playing, counts zero', async () => {
    reply({
      response: {
        result: 'success',
        data: { stream_count: '0', total_bandwidth: 0, sessions: [] },
      },
    });
    const m = await load();
    const body = StreamsResponse.parse(m.toStreams(await m.getActivity(), true));
    expect(body).toMatchObject({ streamCount: 0, transcodeCount: 0, sessions: [] });
  });

  test('not-configured, unauthorized and unreachable carry their state and no sessions', async () => {
    const m = await load('');
    for (const state of ['not-configured', 'unauthorized', 'unreachable'] as const) {
      const body = StreamsResponse.parse(m.toStreams({ state, fetchedAt: null, raw: null }, true));
      expect(body.source).toEqual({ state, fetchedAt: null });
      expect(body).toMatchObject({
        streamCount: 0,
        transcodeCount: 0,
        totalBitsPerSec: null,
        sessions: [],
      });
    }
  });

  test('stale values within 60 s still show with an unreachable source', async () => {
    reply(fixture);
    const m = await load();
    await m.getActivity();
    vi.mocked(httpRequest).mockRejectedValue(new Error('down'));
    vi.advanceTimersByTime(20_000);
    const body = StreamsResponse.parse(m.toStreams(await m.getActivity(), true));
    expect(body.source).toEqual({ state: 'unreachable', fetchedAt: '2026-10-16T12:00:00.000Z' });
    expect(body.sessions).toHaveLength(2);
  });
});
