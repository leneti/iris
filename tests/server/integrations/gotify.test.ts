import { adapter } from '@/lib/server/integrations/gotify';
import { KEY, codeOf, envWith, fixture, harness } from '../../helpers/adapter';

const routes = (message: string) => ({
  '/application': fixture('gotify/application.json'),
  '/client': fixture('gotify/client.json'),
  '/message?limit=100': fixture(message),
});
const open: Awaited<ReturnType<typeof harness>>[] = [];
const start = async (r: Parameters<typeof harness>[1]) => {
  const h = await harness(adapter, r);
  open.push(h);
  return h;
};
afterEach(() => Promise.all(open.splice(0).map((h) => h.close())));

describe('gotify adapter', () => {
  test('counts apps and clients, and reads messages as 100+ when a next page exists', async () => {
    const h = await start(routes('gotify/message-page.json'));
    expect(await adapter.fetch(h.ctx)).toEqual({
      apps: 5,
      clients: 3,
      messages: { value: 100, atLeast: true },
    });
    expect(h.seen.map((s) => s.url).sort()).toEqual(
      ['/application', '/client', '/message?limit=100'].sort(),
    );
    for (const s of h.seen) expect(s.headers['x-gotify-key']).toBe(KEY);
  });

  test('without a next page messages is the plain count', async () => {
    const h = await start(routes('gotify/message-short.json'));
    expect(await adapter.fetch(h.ctx)).toMatchObject({ messages: 7 });
  });

  test('fields, labels and credentials', () => {
    expect(adapter.type).toBe('gotify');
    expect(adapter.defaultFields).toEqual(['apps', 'clients', 'messages']);
    expect(adapter.labels).toEqual({ apps: 'Apps', clients: 'Clients', messages: 'Messages' });
    expect(adapter.credentials(envWith('IRIS_GOTIFY_TOKEN', ''))).toBeNull();
    expect(adapter.credentials(envWith('IRIS_GOTIFY_TOKEN', KEY))).toEqual({ key: KEY });
  });

  test.each(['not json', '{}', '{"messages":"x"}'])(
    'a malformed message reply (%s) is unreachable',
    async (body) => {
      const h = await start({ ...routes('gotify/message-short.json'), '/message?limit=100': body });
      expect(await codeOf(adapter.fetch(h.ctx))).toBe('unreachable');
    },
  );

  test('401 is unauthorized', async () => {
    const h = await start({ '/application': { status: 401 }, '/client': { status: 401 } });
    expect(await codeOf(adapter.fetch(h.ctx))).toBe('unauthorized');
  });
});
