import { createState } from '@/lib/server/state';
import { isReferencedSlug, referencedSlugs } from '@/lib/server/icons/referenced';
import type { AppState } from '@/lib/server/state';

function stateWith(...icons: unknown[]): AppState {
  const state = createState();
  state.discovery = {
    groups: [{ name: 'G', icon: 'lucide:x', services: icons.map((icon) => ({ icon })) }],
    links: [],
    warnings: [],
    sources: { docker: 'ok', manual: 'ok' },
  } as unknown as AppState['discovery'];
  return state;
}

const di = (slug: string, variants?: { light?: string; dark?: string }) => ({
  kind: 'dashboard-icons',
  slug,
  src: `/api/icons/di/${slug}`,
  ...(variants ? { variants } : {}),
});

describe('referenced icon slugs', () => {
  test('nothing is referenced before discovery has run', () => {
    expect(referencedSlugs(createState()).size).toBe(0);
  });
  test('collects each dashboard-icons slug and its theme variants', () => {
    const set = referencedSlugs(
      stateWith(
        di('plex', { light: '/api/icons/di/plex-dark', dark: '/api/icons/di/plex-light' }),
        di('radarr'),
        { kind: 'lucide', name: 'film' },
        { kind: 'local', file: 'mine.png', src: '/api/icons/local/mine.png' },
      ),
    );
    expect([...set].sort()).toEqual(['plex', 'plex-dark', 'plex-light', 'radarr']);
  });
  test('reads the live process state', () => {
    globalThis.__iris = stateWith(di('plex'));
    try {
      expect(isReferencedSlug('plex')).toBe(true);
      expect(isReferencedSlug('sonarr')).toBe(false);
    } finally {
      globalThis.__iris = undefined;
    }
  });
});
