import { markSvg } from '@/lib/shared/mark';

export const contentType = 'image/svg+xml';

export default function Icon() {
  return new Response(markSvg({ rounded: true }), { headers: { 'Content-Type': contentType } });
}
