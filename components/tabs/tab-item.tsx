'use client';

import { Ban, Clock, House, Loader2, Pause } from 'lucide-react';
import { HealthMark } from '@/components/health-mark';
import { ServiceIcon } from '@/components/service-icon';
import { BUILTIN_JOBS, BUILTIN_OVERVIEW } from '@/lib/client/tabs';
import type { ServiceEntry, ServiceStatus } from '@/lib/shared/contract';
import type { TabMark } from './frame-model';

export type TabItem = {
  id: string;
  name: string;
  service: ServiceEntry | null;
  status: ServiceStatus | null;
  /** Replaces the health mark while the frame loads, the card shows or the tab is suspended. */
  mark?: TabMark | null;
  /** The Overview: always first in the strip, with no way to close it. */
  pinned?: boolean;
};

export function builtinName(id: string): string {
  return id === BUILTIN_JOBS ? 'Scheduled jobs' : id === BUILTIN_OVERVIEW ? 'Overview' : id;
}

export function TabGlyph({ tab }: { tab: TabItem }) {
  if (tab.service) return <ServiceIcon service={tab.service} size={16} />;
  const Icon = tab.id === BUILTIN_JOBS ? Clock : House;
  return <Icon className="size-4 text-text-2" />;
}

const MARKS = {
  loading: { Icon: Loader2, className: 'animate-spin text-accent-mark' },
  blocked: { Icon: Ban, className: 'text-text-3' },
  suspended: { Icon: Pause, className: 'text-text-3' },
} as const;

/** A tab's state: spinner while loading, "blocked" when the card shows, pause when suspended. */
export function TabStatus({ tab }: { tab: TabItem }) {
  if (tab.mark) {
    const { Icon, className } = MARKS[tab.mark];
    return (
      <span role="img" aria-label={tab.mark} className="flex size-3 shrink-0">
        <Icon aria-hidden className={`size-3 ${className}`} />
      </span>
    );
  }
  return tab.status ? <HealthMark status={tab.status} /> : null;
}
