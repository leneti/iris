'use client';

import { HealthMark } from '@/components/health-mark';
import { ServiceIcon } from '@/components/service-icon';
import { cn } from '@/lib/utils';
import type { ServiceEntry, ServiceStatus } from '@/lib/shared/contract';

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
