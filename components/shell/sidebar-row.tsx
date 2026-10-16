'use client';

import { useTheme } from 'next-themes';
import { useState } from 'react';
import { HealthMark } from '@/components/health-mark';
import { cn } from '@/lib/utils';
import type { ServiceEntry, ServiceStatus } from '@/lib/shared/contract';

/** Service artwork from /api/icons, or a neutral lettered tile when there is none to load. */
export function ServiceIcon({ service, size = 22 }: { service: ServiceEntry; size?: number }) {
  const { resolvedTheme } = useTheme();
  const icon = service.icon;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const variants = icon.kind === 'dashboard-icons' ? icon.variants : undefined;
  const src =
    icon.kind === 'lucide'
      ? null
      : ((resolvedTheme === 'dark' ? variants?.dark : variants?.light) ?? icon.src);
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

/** Row styles shared by the expanded rows and the rail cells. */
export function rowState(active: boolean, muted: boolean): string {
  return cn(
    'relative text-text outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
    active ? 'bg-selected font-medium' : 'hover:bg-hover',
    muted && 'text-text-2',
  );
}

export function ActiveBar({ className }: { className?: string }) {
  return <span aria-hidden className={cn('absolute inset-y-0 w-0.5 bg-accent-mark', className)} />;
}

export type SidebarRowProps = {
  service: ServiceEntry;
  status: ServiceStatus;
  open: boolean;
  active: boolean;
  onOpen: (id: string) => void;
};

/** One 32 px row: icon, name, health mark, open-tab dot, and an accent bar when active. */
export function SidebarRow({ service, status, open, active, onOpen }: SidebarRowProps) {
  const muted = status === 'stopped';
  return (
    <button
      type="button"
      data-muted={muted}
      data-active={active}
      onClick={() => onOpen(service.id)}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-row px-2 text-left text-[13px]',
        rowState(active, muted),
      )}
    >
      {active && <ActiveBar className="-left-2" />}
      <span className={cn('flex', muted && 'opacity-50')}>
        <ServiceIcon service={service} />
      </span>
      <span className="min-w-0 flex-1 truncate">{service.name}</span>
      {open && (
        <span
          aria-label="Open in a tab"
          className="size-1.5 shrink-0 rounded-full bg-accent-mark"
        />
      )}
      <HealthMark status={status} />
    </button>
  );
}
