import { readFileSync } from 'node:fs';
import { WidgetsResponse } from '@/lib/shared/contract';
import { defaultIrisConfig } from '@/lib/server/config/iris';
import { loadEnv } from '@/lib/server/env';
import { httpRequest } from '@/lib/server/http';
import { stateWith } from '../../helpers/widgets';

vi.mock('@/lib/server/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  registerSecret: vi.fn(),
}));
vi.mock('@/lib/server/http', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/server/http')>();
  return { ...actual, httpRequest: vi.fn() };
});
vi.mock('@/lib/server/config/services', () => ({
  getConfigWatcher: () => ({
    get: () => ({
      iris: {
        config: { streams: { url: 'http://tautulli.example.invalid:8181', showUsers: true } },
      },
    }),
  }),
}));

const activity = readFileSync(
  new URL('../../fixtures/tautulli/activity.json', import.meta.url),
  'utf8',
);
const T0 = new Date('2026-10-16T12:00:00.000Z').getTime();
const KEY = 'tautulli-key-3b9d';
const env = loadEnv({ IRIS_TAUTULLI_KEY: KEY });
const config = defaultIrisConfig();

type Registry = typeof import('@/lib/server/integrations/registry');
type Panel = typeof import('@/lib/server/panels/tautulli');
let reg: Registry;
let panel: Panel;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv('IRIS_TAUTULLI_KEY', KEY);
  vi.resetModules();
  vi.mocked(httpRequest).mockReset();
  vi.mocked(httpRequest).mockResolvedValue({
    status: 200,
    headers: {},
    body: Buffer.from(activity),
    url: 'http://tautulli.example.invalid:8181',
    redirects: 0,
  });
  reg = await import('@/lib/server/integrations/registry');
  panel = await import('@/lib/server/panels/tautulli');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const state = () => stateWith([{ id: 'plex', type: 'tautulli' }]);

describe('Plex tile (tautulli adapter)', () => {
  test('fields and labels', () => {
    const a = reg.getAdapter('tautulli')!;
    expect(a.defaultFields).toEqual(['streams', 'transcodes']);
    expect(a.labels).toEqual({ streams: 'Streams', transcodes: 'Transcoding' });
  });

  test('not configured without a Tautulli key', async () => {
    const res = await reg.getWidgets(state(), config, loadEnv({}), T0);
    expect(res.services.plex).toMatchObject({ type: 'tautulli', state: 'not-configured' });
    expect(httpRequest).not.toHaveBeenCalled();
  });

  test('streams equals the Now playing row count; transcodes the transcoding rows', async () => {
    const res = WidgetsResponse.parse(await reg.getWidgets(state(), config, env, T0));
    const streams = panel.toStreams(await panel.getActivity(), false);
    const stats = res.services.plex!.stats;
    expect(res.services.plex!.state).toBe('ok');
    expect(stats.map((s) => s.key)).toEqual(['streams', 'transcodes']);
    expect(stats[0]).toMatchObject({ label: 'Streams', value: streams.sessions.length });
    expect(stats[1]).toMatchObject({ label: 'Transcoding', value: streams.transcodeCount });
    expect(streams.sessions.length).toBeGreaterThan(0);
  });

  test('two /api/widgets calls plus one /api/streams call within 15 s make one Tautulli request (11.12)', async () => {
    await reg.getWidgets(state(), config, env, T0);
    await vi.advanceTimersByTimeAsync(5000);
    await reg.getWidgets(state(), config, env, Date.now());
    await vi.advanceTimersByTimeAsync(5000);
    const { GET } = await import('@/app/api/streams/route');
    const body = (await (await GET()).json()) as { streamCount: number };
    expect(body.streamCount).toBeGreaterThan(0);
    expect(httpRequest).toHaveBeenCalledTimes(1);
  });

  test('an unreachable Tautulli is an unreachable tile, and a bad key is unauthorized', async () => {
    vi.mocked(httpRequest).mockRejectedValue(new Error('refused'));
    let res = await reg.getWidgets(state(), config, env, T0);
    expect(res.services.plex).toMatchObject({ state: 'unreachable', stats: [] });

    vi.resetModules();
    vi.mocked(httpRequest).mockResolvedValue({
      status: 401,
      headers: {},
      body: Buffer.from(''),
      url: 'x',
      redirects: 0,
    });
    reg = await import('@/lib/server/integrations/registry');
    res = await reg.getWidgets(state(), config, env, T0);
    expect(res.services.plex).toMatchObject({ state: 'unauthorized', stats: [] });
  });
});
