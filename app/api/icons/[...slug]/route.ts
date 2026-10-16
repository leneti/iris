import { isReferencedSlug } from '@/lib/server/icons/referenced';
import { LOCAL_FILE, SLUG } from '@/lib/server/icons/resolve';
import { getIconStore } from '@/lib/server/icons/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug: segments } = await ctx.params;
  if (!Array.isArray(segments) || segments.length !== 2) return notFound();
  const [kind, name] = segments;
  if (name === undefined) return notFound();
  let icon;
  // Criterion 11.8: a `di` slug reaches the store (and so the CDN and the disk) only when the
  // current discovery result references it.
  if (kind === 'di' && SLUG.test(name) && isReferencedSlug(name))
    icon = await getIconStore().get('di', name);
  else if (kind === 'local' && LOCAL_FILE.test(name))
    icon = await getIconStore().get('local', name);
  else return notFound();
  if (!icon) return notFound();
  return new Response(new Uint8Array(icon.body), {
    status: 200,
    headers: {
      'Content-Type': icon.type,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=604800, immutable',
    },
  });
}
