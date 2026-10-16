'use client';

import { ChevronLeft, RotateCw } from 'lucide-react';
import { HealthMark } from '@/components/health-mark';
import { ServiceIcon } from '@/components/shell/sidebar-row';
import type { ServiceEntry, ServiceStatus } from '@/lib/shared/contract';
import { TabsButton, TopBar } from './top-bar';

const ICON_BUTTON =
  'flex size-11 shrink-0 items-center justify-center rounded-row text-text-2 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/**
 * The bar above an open service: Back, the service's icon, name and health, Reload and the tabs
 * button. The frame itself lives in the shell's Canvas, which never moves it; this is only the
 * chrome. The bottom navigation is hidden while it shows (handoff 7.7).
 */
export function ServiceBar({
  service,
  status,
  hasUrl,
  tabCount,
  onBack,
  onReload,
  onTabs,
}: {
  service: ServiceEntry;
  status: ServiceStatus;
  hasUrl: boolean;
  tabCount: number;
  onBack: () => void;
  onReload: () => void;
  onTabs: () => void;
}) {
  return (
    <TopBar className="pl-0">
      <button type="button" aria-label="Back" onClick={onBack} className={ICON_BUTTON}>
        <ChevronLeft aria-hidden className="size-6" />
      </button>
      <ServiceIcon service={service} size={24} />
      <span className="ml-2.5 min-w-0 truncate text-base font-semibold tracking-[-0.01em]">
        {service.name}
      </span>
      <span className="mx-2 flex flex-1 items-center">
        <HealthMark status={status} />
      </span>
      <button
        type="button"
        aria-label="Reload"
        disabled={!hasUrl}
        onClick={onReload}
        className={ICON_BUTTON}
      >
        <RotateCw aria-hidden className="size-5" />
      </button>
      <TabsButton count={tabCount} onClick={onTabs} />
    </TopBar>
  );
}
