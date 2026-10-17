'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { HealthMark } from '@/components/health-mark';
import { formatStat, isFailed } from '@/lib/client/stats';
import { groupIcon, COLLAPSED_GROUPS_PREF } from '@/components/shell/sidebar';
import { ServiceIcon } from '@/components/service-icon';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useWidgets } from '@/lib/client/api';
import { worstStatus } from '@/lib/client/health';
import { prefs } from '@/lib/client/prefs';
import { usePref } from '@/lib/client/use-client';
import type {
  GroupEntry,
  ServiceEntry,
  ServiceStatus,
  ServiceWidget,
  Stat,
} from '@/lib/shared/contract';
import { cn } from '@/lib/utils';

const MAX_FIGURES = 3;

function figure(stat: Stat): string {
  // A rate reads "↓ 12.4 MB/s"; every other figure is its value then its label.
  if (stat.unit === 'bytes-per-second') {
    return `${stat.key === 'upload' ? '↑' : '↓'} ${formatStat(stat)}`;
  }
  return `${formatStat(stat)} ${stat.label.charAt(0).toLowerCase()}${stat.label.slice(1)}`;
}

/** The second line of a row: up to three figures, or why there are none. Null: no second line. */
export function figureLine(widget: ServiceWidget | undefined): string | null {
  if (widget === undefined) return null;
  if (isFailed(widget.state)) return 'Data unavailable';
  if (widget.state !== 'ok' || widget.stats.length === 0) return null;
  return widget.stats.slice(0, MAX_FIGURES).map(figure).join(' · ');
}

function ServiceRow({
  service,
  status,
  open,
  line,
  onOpen,
}: {
  service: ServiceEntry;
  status: ServiceStatus;
  open: boolean;
  line: string | null;
  onOpen: (id: string) => void;
}) {
  const muted = status === 'stopped';
  return (
    <button
      type="button"
      data-muted={muted}
      onClick={() => onOpen(service.id)}
      className={cn(
        'flex w-full items-center gap-3 border-b border-hairline px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        line === null ? 'min-h-12' : 'min-h-[60px]',
        muted && 'text-text-2',
      )}
    >
      <span className={cn('flex', muted && 'opacity-50')}>
        <ServiceIcon service={service} size={28} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{service.name}</span>
        {line !== null && <span className="block truncate text-[12.5px] text-text-2">{line}</span>}
      </span>
      <HealthMark status={status} />
      <span className="flex w-1.5 shrink-0 justify-center">
        {open && (
          <span aria-label="Open in a tab" className="size-1.5 rounded-full bg-accent-mark" />
        )}
      </span>
    </button>
  );
}

/**
 * The grouped list (handoff 7.7): collapsible groups, 48 px rows, and 60 px rows for services with
 * an integration, which show up to three figures. Standalone tiles and links are on the Overview.
 */
export function PhoneServices({
  groups,
  statusById,
  openIds,
  onOpenService,
}: {
  groups: GroupEntry[];
  statusById: Record<string, ServiceStatus>;
  openIds: string[];
  onOpenService: (id: string) => void;
}) {
  const { data: widgets } = useWidgets();
  // The same remembered choice as the desktop sidebar's groups.
  const collapsedGroups = usePref<string[]>(COLLAPSED_GROUPS_PREF, []);

  function setGroupOpen(name: string, open: boolean) {
    const next = open ? collapsedGroups.filter((n) => n !== name) : [...collapsedGroups, name];
    prefs.set(COLLAPSED_GROUPS_PREF, next);
  }

  return (
    <div className="px-3 pb-3">
      {groups.map((g) => {
        const open = !collapsedGroups.includes(g.name);
        const Icon = groupIcon(g.icon);
        const worst = worstStatus(g.services.map((s) => statusById[s.id] ?? 'unknown'));
        return (
          <Collapsible key={g.name} open={open} onOpenChange={(o) => setGroupOpen(g.name, o)}>
            <CollapsibleTrigger className="flex h-11 w-full items-center gap-2 border-b border-hairline px-1 text-left text-[12px] font-semibold tracking-[0.06em] text-text-2 uppercase outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              {open ? (
                <ChevronDown aria-hidden className="size-4" />
              ) : (
                <ChevronRight aria-hidden className="size-4" />
              )}
              {Icon && <Icon aria-hidden className="size-4" />}
              <span className="flex-1 truncate">{g.name}</span>
              <span className="font-medium tabular-nums">{g.services.length}</span>
              <HealthMark status={worst} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {g.services.map((s) => (
                <ServiceRow
                  key={s.id}
                  service={s}
                  status={statusById[s.id] ?? 'unknown'}
                  open={openIds.includes(s.id)}
                  line={figureLine(widgets?.services[s.id])}
                  onOpen={onOpenService}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
