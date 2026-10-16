import { GET, dynamic, runtime } from '@/app/api/icons/[...slug]/route';

const get = vi.fn();
vi.mock('@/lib/server/icons/store', () => ({ getIconStore: () => ({ get }) }));

// The route serves only slugs that the current discovery result references.
const referenced = new Set(['plex', 'nothing', 'a'.repeat(64)]);
vi.mock('@/lib/server/icons/referenced', () => ({
  isReferencedSlug: (slug: string) => referenced.has(slug),
}));

const call = (...segments: string[]) =>
  GET(new Request(`http://localhost/api/icons/${segments.join('/')}`), {
    params: Promise.resolve({ slug: segments }),
  });

beforeEach(() => get.mockReset());

describe('icons route', () => {
  test('exports', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });
  test('serves an icon with the required headers', async () => {
    const body = Buffer.from('<svg/>');
    get.mockResolvedValue({ body, type: 'image/svg+xml' });
    const res = await call('di', 'plex');
    expect(res.status).toBe(200);
    expect(get).toHaveBeenCalledWith('di', 'plex');
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800, immutable');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(body);
  });
  test('serves local files', async () => {
    get.mockResolvedValue({ body: Buffer.from('x'), type: 'image/png' });
    expect((await call('local', 'mine.png')).status).toBe(200);
    expect(get).toHaveBeenCalledWith('local', 'mine.png');
  });
  test('an unknown icon is 404 and is not cached by the browser', async () => {
    get.mockResolvedValue(null);
    const res = await call('di', 'nothing');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).not.toContain('immutable');
  });
  test('a well-formed slug that nothing references is 404 without reaching the store', async () => {
    const res = await call('di', 'sonarr');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(get).not.toHaveBeenCalled();
  });
  test('slugs are capped at 64 characters', async () => {
    get.mockResolvedValue({ body: Buffer.from('<svg/>'), type: 'image/svg+xml' });
    expect((await call('di', 'a'.repeat(64))).status).toBe(200);
    referenced.add('a'.repeat(65));
    try {
      expect((await call('di', 'a'.repeat(65))).status).toBe(404);
      expect((await call('di', 'a'.repeat(300))).status).toBe(404);
    } finally {
      referenced.delete('a'.repeat(65));
    }
    expect(get).toHaveBeenCalledTimes(1);
  });
  test.each([
    ['di', '..'],
    ['di', 'Plex'],
    ['di', 'a.svg'],
    ['local', '../x.svg'],
    ['local', 'x.txt'],
    ['local', '.svg'],
    ['other', 'plex'],
  ])('%s/%s is 404 without reaching the store', async (k, n) => {
    expect((await call(k, n)).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
  test('wrong segment counts are 404', async () => {
    expect((await call('di')).status).toBe(404);
    expect((await call('di', 'a', 'b')).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
  test('a path escaping through encoded segments is 404', async () => {
    expect((await call('di', '..%2Fx')).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
});
