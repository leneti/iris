import { resolveIcon } from '@/lib/server/icons/resolve';
import { IconRef } from '@/lib/shared/contract';

const cat = (entries: Record<string, 'svg' | 'png'>) => ({
  has: (slug: string) => entries[slug] ?? null,
});
const input = (over: Partial<Parameters<typeof resolveIcon>[0]> = {}) => ({
  serviceName: 'plex',
  containerName: 'plex-1',
  groupIcon: 'lucide:film',
  ...over,
});
const none = new Set<string>();

describe('resolveIcon chain (D1.3)', () => {
  test('label beats the service name', () => {
    const r = resolveIcon(input({ label: 'sonarr' }), cat({ sonarr: 'svg', plex: 'svg' }), none);
    expect(r).toEqual({ kind: 'dashboard-icons', slug: 'sonarr', src: '/api/icons/di/sonarr' });
  });
  test('compose name comes before container name', () => {
    const r = resolveIcon(
      input({ serviceName: 'radarr', containerName: 'plex' }),
      cat({ radarr: 'png', plex: 'svg' }),
      none,
    );
    expect(r).toMatchObject({ kind: 'dashboard-icons', slug: 'radarr' });
  });
  test('container name is used when the compose name misses', () => {
    const r = resolveIcon(
      input({ serviceName: 'unknown', containerName: 'plex' }),
      cat({ plex: 'svg' }),
      none,
    );
    expect(r).toMatchObject({ kind: 'dashboard-icons', slug: 'plex' });
  });
  test('local folder when the catalogue misses', () => {
    const r = resolveIcon(input({ serviceName: 'seerr' }), cat({}), new Set(['seerr.webp']));
    expect(r).toEqual({ kind: 'local', file: 'seerr.webp', src: '/api/icons/local/seerr.webp' });
  });
  test('catalogue beats the local folder', () => {
    const r = resolveIcon(input(), cat({ plex: 'svg' }), new Set(['plex.svg']));
    expect(r.kind).toBe('dashboard-icons');
  });
  test('group Lucide icon is last', () => {
    expect(resolveIcon(input(), cat({}), none)).toEqual({ kind: 'lucide', name: 'film' });
  });
  test('an unusable group icon falls back to layout-grid', () => {
    expect(resolveIcon(input({ groupIcon: 'nonsense/../x' }), cat({}), none)).toEqual({
      kind: 'lucide',
      name: 'layout-grid',
    });
  });
  test('names are matched in lower case', () => {
    const r = resolveIcon(input({ serviceName: 'Plex' }), cat({ plex: 'svg' }), none);
    expect(r).toMatchObject({ slug: 'plex' });
  });
});

describe('label syntax', () => {
  test('local: prefix uses the override folder', () => {
    const r = resolveIcon(
      input({ label: 'local:mine.png' }),
      cat({ plex: 'svg' }),
      new Set(['mine.png']),
    );
    expect(r).toEqual({ kind: 'local', file: 'mine.png', src: '/api/icons/local/mine.png' });
  });
  test('local: with a missing file falls through the chain', () => {
    const r = resolveIcon(input({ label: 'local:gone.png' }), cat({ plex: 'svg' }), none);
    expect(r).toMatchObject({ kind: 'dashboard-icons', slug: 'plex' });
  });
  test('local: with a traversal name is ignored', () => {
    const r = resolveIcon(input({ label: 'local:../x.png' }), cat({}), new Set(['../x.png']));
    expect(r.kind).toBe('lucide');
  });
  test('lucide: prefix gives a Lucide icon', () => {
    const r = resolveIcon(input({ label: 'lucide:clock' }), cat({ plex: 'svg' }), none);
    expect(r).toEqual({ kind: 'lucide', name: 'clock' });
  });
  test.each(['https://evil.example.invalid/x.svg', 'http://x/y.png', '//x/y.svg', 'a/b'])(
    'remote or odd label %s is rejected',
    (label) => {
      const r = resolveIcon(input({ label }), cat({}), none);
      expect(r).toEqual({ kind: 'lucide', name: 'film' });
    },
  );
  test('a label slug missing from the catalogue falls through', () => {
    const r = resolveIcon(input({ label: 'nope' }), cat({ plex: 'svg' }), none);
    expect(r).toMatchObject({ slug: 'plex' });
  });
});

describe('theme variants (R15)', () => {
  test('light and dark variants are present only when the catalogue has them', () => {
    const r = resolveIcon(
      input({ serviceName: 'sonarr' }),
      cat({ sonarr: 'svg', 'sonarr-dark': 'svg', 'sonarr-light': 'png' }),
      none,
    );
    expect(r).toEqual({
      kind: 'dashboard-icons',
      slug: 'sonarr',
      src: '/api/icons/di/sonarr',
      variants: { light: '/api/icons/di/sonarr-dark', dark: '/api/icons/di/sonarr-light' },
    });
    expect(IconRef.safeParse(r).success).toBe(true);
  });
  test('only one variant', () => {
    const r = resolveIcon(input(), cat({ plex: 'svg', 'plex-light': 'svg' }), none);
    expect(r).toMatchObject({ variants: { dark: '/api/icons/di/plex-light' } });
    expect((r as { variants: object }).variants).not.toHaveProperty('light');
  });
  test('no variants key when there are none', () => {
    expect(resolveIcon(input(), cat({ plex: 'svg' }), none)).not.toHaveProperty('variants');
  });
});
