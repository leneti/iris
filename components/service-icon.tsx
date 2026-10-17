'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ServiceEntry } from '@/lib/shared/contract';

/** Service artwork from /api/icons, or a neutral lettered tile when there is none to load. */
export function ServiceIcon({ service, size = 22 }: { service: ServiceEntry; size?: number }) {
  const icon = service.icon;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const variants = icon.kind === 'dashboard-icons' ? icon.variants : undefined;
  // The variant meant for a dark background.
  const src = icon.kind === 'lucide' ? null : (variants?.dark ?? icon.src);
  const tile = (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-tile bg-selected text-[11px] font-semibold text-text-2"
    >
      {service.name.slice(0, 1).toUpperCase()}
    </span>
  );
  if (src === null || src === failedSrc) return tile;
  const loaded = src === loadedSrc;
  // The icon store fetches artwork on first use, so the letter tile shows until it has loaded.
  return (
    <span className="relative flex shrink-0" style={{ width: size, height: size }}>
      {!loaded && tile}
      {/* oxlint-disable-next-line next/no-img-element -- artwork is served by our own /api/icons */}
      <img
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0) setLoadedSrc(src);
        }}
        src={src}
        alt=""
        width={size}
        height={size}
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrc(src)}
        className={cn('object-contain', !loaded && 'absolute inset-0 opacity-0')}
      />
    </span>
  );
}
