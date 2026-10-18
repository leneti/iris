import { ImageResponse } from 'next/og';
import { markSvg } from '@/lib/shared/mark';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  const src = `data:image/svg+xml;base64,${Buffer.from(markSvg({ rounded: false })).toString('base64')}`;
  // eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain elements only
  return new ImageResponse(<img src={src} width={size.width} height={size.height} alt="" />, size);
}
