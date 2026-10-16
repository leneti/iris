import 'server-only';
import { getState, type AppState } from '../state';

// The icon route's allowlist (criterion 11.8): `di` slugs are served only when the current
// discovery result points at them, so a browser cannot make the server fetch or store an icon
// of its own choosing. At most three slugs per service: the icon and its two theme variants.

const DI_PREFIX = '/api/icons/di/';

export function referencedSlugs(state: AppState): Set<string> {
  const slugs = new Set<string>();
  for (const group of state.discovery?.groups ?? [])
    for (const { icon } of group.services) {
      if (icon.kind !== 'dashboard-icons') continue;
      slugs.add(icon.slug);
      for (const src of [icon.variants?.light, icon.variants?.dark])
        if (src?.startsWith(DI_PREFIX)) slugs.add(src.slice(DI_PREFIX.length));
    }
  return slugs;
}

export function isReferencedSlug(slug: string): boolean {
  return referencedSlugs(getState()).has(slug);
}
