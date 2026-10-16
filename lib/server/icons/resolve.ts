import 'server-only';
import type { IconRef } from '@/lib/shared/contract';
import type { IconInput } from '../discovery/discover';

// Handoff D1.3: label, then exact name (Compose service, then container), then the local
// override folder, then the group's Lucide icon.

/** A dashboard-icons slug, or a Lucide icon name. 64 characters is far past any real one. */
export const SLUG = /^[a-z0-9-]{1,64}$/;
export const LOCAL_FILE = /^[A-Za-z0-9._-]+\.(svg|png|webp)$/;
const LOCAL_EXTENSIONS = ['svg', 'png', 'webp'];
const FALLBACK_LUCIDE = 'layout-grid';

export type IconCatalogue = { has(slug: string): 'svg' | 'png' | null };

const diSrc = (slug: string) => `/api/icons/di/${slug}`;
const localRef = (file: string): IconRef => ({
  kind: 'local',
  file,
  src: `/api/icons/local/${file}`,
});

function catalogueRef(slug: string, catalogue: IconCatalogue): IconRef | null {
  if (!SLUG.test(slug) || !catalogue.has(slug)) return null;
  const variants: { light?: string; dark?: string } = {};
  if (catalogue.has(`${slug}-dark`)) variants.light = diSrc(`${slug}-dark`);
  if (catalogue.has(`${slug}-light`)) variants.dark = diSrc(`${slug}-light`);
  return {
    kind: 'dashboard-icons',
    slug,
    src: diSrc(slug),
    ...(Object.keys(variants).length > 0 ? { variants } : {}),
  };
}

function localFor(slug: string, localFiles: Set<string>): IconRef | null {
  if (!SLUG.test(slug)) return null;
  for (const ext of LOCAL_EXTENSIONS) {
    const file = `${slug}.${ext}`;
    if (localFiles.has(file)) return localRef(file);
  }
  return null;
}

function fromLabel(
  label: string,
  catalogue: IconCatalogue,
  localFiles: Set<string>,
): IconRef | null {
  const text = label.trim();
  if (text.startsWith('local:')) {
    const file = text.slice('local:'.length);
    return LOCAL_FILE.test(file) && localFiles.has(file) ? localRef(file) : null;
  }
  if (text.startsWith('lucide:')) {
    const name = text.slice('lucide:'.length);
    return SLUG.test(name) ? { kind: 'lucide', name } : null;
  }
  // A bare slug means dashboard-icons. Anything else (URLs, paths) is not accepted.
  return catalogueRef(text.toLowerCase(), catalogue);
}

export function resolveIcon(
  input: IconInput,
  catalogue: IconCatalogue,
  localFiles: Set<string>,
): IconRef {
  if (input.label) {
    const hit = fromLabel(input.label, catalogue, localFiles);
    if (hit) return hit;
  }
  const names = [input.serviceName, input.containerName]
    .filter((n): n is string => !!n)
    .map((n) => n.toLowerCase());
  for (const name of names) {
    const hit = catalogueRef(name, catalogue);
    if (hit) return hit;
  }
  for (const name of names) {
    const hit = localFor(name, localFiles);
    if (hit) return hit;
  }
  const group = input.groupIcon.startsWith('lucide:')
    ? input.groupIcon.slice('lucide:'.length)
    : input.groupIcon;
  return { kind: 'lucide', name: SLUG.test(group) ? group : FALLBACK_LUCIDE };
}
