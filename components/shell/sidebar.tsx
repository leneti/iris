'use client';

import {
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Clock,
  Download,
  House,
  PanelLeft,
  Search,
  Server,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useModKey } from '@/lib/client/shortcuts';
import { usePref } from '@/lib/client/use-client';
import { HealthMark } from '@/components/health-mark';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDuration } from '@/lib/client/format';
import { worstStatus } from '@/lib/client/health';
import { prefs } from '@/lib/client/prefs';
import { BUILTIN_JOBS, BUILTIN_OVERVIEW } from '@/lib/client/tabs';
import type { GroupEntry, ServiceStatus } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';
import { ActiveBar, rowState, SidebarRow } from './sidebar-row';

export type JobsBadge = { failed: number; overdue: number };
export type DockerFooter = {
  state: 'ok' | 'unreachable' | 'pending';
  ageSeconds: number | null;
  count: number;
};

export type SidebarProps = {
  groups: GroupEntry[];
  statusById: Record<string, ServiceStatus>;
  openIds: string[];
  activeId: string | null;
  onOpenService: (id: string) => void;
  onOpenBuiltin: (id: typeof BUILTIN_OVERVIEW | typeof BUILTIN_JOBS) => void;
  onSearch: () => void;
  onToggleCollapsed: () => void;
  jobs: JobsBadge;
  docker: DockerFooter;
};

const GROUP_ICONS: Record<string, LucideIcon> = {
  clapperboard: Clapperboard,
  workflow: Workflow,
  download: Download,
  server: Server,
  house: House,
};

export function groupIcon(icon: string | null): LucideIcon | null {
  return GROUP_ICONS[icon?.replace(/^lucide:/, '') ?? ''] ?? null;
}

export const COLLAPSED_GROUPS_PREF = 'sidebar.collapsedGroups';

export function dockerText(d: Pick<DockerFooter, 'state' | 'ageSeconds'>): string {
  if (d.state === 'pending') return 'Docker · checking…';
  if (d.state === 'ok') return 'Docker · live';
  return d.ageSeconds === null
    ? 'Docker unreachable'
    : `Docker unreachable · ${formatDuration(d.ageSeconds)}`;
}

export function JobsCount({ jobs, className }: { jobs: JobsBadge; className?: string }) {
  const count = jobs.failed + jobs.overdue;
  if (count === 0) return null;
  return (
    <span
      aria-label={`${count} jobs need attention`}
      className={cn(
        'flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums text-status-on-solid',
        jobs.failed > 0 ? 'bg-status-unhealthy' : 'bg-status-degraded',
        className,
      )}
    >
      {count}
    </span>
  );
}

export function Sidebar(props: SidebarProps) {
  const modKey = useModKey();
  const { groups, statusById, openIds, activeId, onOpenService, onOpenBuiltin } = props;
  const collapsedGroups = usePref<string[]>(COLLAPSED_GROUPS_PREF, []);

  function setGroupOpen(name: string, open: boolean) {
    const next = open ? collapsedGroups.filter((n) => n !== name) : [...collapsedGroups, name];
    prefs.set(COLLAPSED_GROUPS_PREF, next);
  }

  const overviewActive = activeId === null || activeId === BUILTIN_OVERVIEW;
  const jobsActive = activeId === BUILTIN_JOBS;

  return (
    <nav
      aria-label="Services"
      className="flex h-full w-64 flex-col border-r border-hairline bg-chrome"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-tile bg-text text-[11px] font-bold text-page"
        >
          I
        </span>
        <span className="text-sm font-semibold">Iris</span>
      </div>
      <div className="shrink-0 px-2">
        <button
          type="button"
          onClick={props.onSearch}
          className="flex h-8 w-full items-center gap-2 rounded-row border border-control px-2 text-left text-[13px] text-text-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Search className="size-4" />
          <span className="flex-1">Search services…</span>
          <kbd className="rounded-row border border-hairline-strong px-1 text-[10px] text-text-3">
            {modKey === '⌘' ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
        <button
          type="button"
          data-active={overviewActive}
          onClick={() => onOpenBuiltin(BUILTIN_OVERVIEW)}
          className={cn(
            'mt-1.5 flex h-8 w-full items-center gap-2 rounded-row px-2 text-left text-[13px]',
            rowState(overviewActive, false),
          )}
        >
          {overviewActive && <ActiveBar className="-left-2" />}
          <House className="size-[22px] p-0.5 text-text-2" />
          <span className="flex-1">Overview</span>
        </button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 px-2 pb-2 pt-1">
          {groups.map((g) => {
            const open = !collapsedGroups.includes(g.name);
            const Icon = groupIcon(g.icon);
            const worst = worstStatus(g.services.map((s) => statusById[s.id] ?? 'unknown'));
            return (
              <Collapsible key={g.name} open={open} onOpenChange={(o) => setGroupOpen(g.name, o)}>
                <CollapsibleTrigger className="flex h-7 w-full items-center gap-1.5 rounded-row px-1 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-text-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  {Icon && <Icon className="size-3.5" />}
                  <span className="flex-1 truncate">{g.name}</span>
                  <span className="font-medium tabular-nums">{g.services.length}</span>
                  <HealthMark status={worst} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {g.services.map((s) => (
                    <SidebarRow
                      key={s.id}
                      service={s}
                      status={statusById[s.id] ?? 'unknown'}
                      open={openIds.includes(s.id)}
                      active={activeId === s.id}
                      onOpen={onOpenService}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>
      <div className="shrink-0 space-y-1 border-t border-hairline p-2">
        <button
          type="button"
          data-active={jobsActive}
          onClick={() => onOpenBuiltin(BUILTIN_JOBS)}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-row px-2 text-left text-[13px]',
            rowState(jobsActive, false),
          )}
        >
          {jobsActive && <ActiveBar className="-left-2" />}
          <Clock className="size-[22px] p-0.5 text-text-2" />
          <span className="flex-1">Scheduled jobs</span>
          <JobsCount jobs={props.jobs} />
        </button>
        <div
          className={cn(
            'flex items-center justify-between px-2 text-[11px]',
            props.docker.state === 'unreachable' ? 'text-status-degraded-text' : 'text-text-2',
          )}
        >
          <span>{dockerText(props.docker)}</span>
          <span className="tabular-nums">{props.docker.count} services</span>
        </div>
        <div className="flex items-center justify-end px-1 pt-1">
          <button
            type="button"
            aria-label="Collapse sidebar"
            onClick={props.onToggleCollapsed}
            className="flex size-8 items-center justify-center rounded-row text-text-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <PanelLeft className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );
}
