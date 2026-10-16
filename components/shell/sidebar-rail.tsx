'use client';

import { Clock, House, PanelLeft, Search } from 'lucide-react';
import { HealthMark } from '@/components/health-mark';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BUILTIN_JOBS, BUILTIN_OVERVIEW } from '@/lib/client/tabs';
import { cn } from '@/lib/utils';
import { JobsCount, dockerText, type SidebarProps } from './sidebar';
import { ActiveBar, rowState, ServiceIcon } from './sidebar-row';
import { useModKey } from '@/lib/client/shortcuts';
import { ThemeSwitch } from './theme-switch';

const DOCKER_MARK = { ok: 'healthy', unreachable: 'degraded', pending: 'unknown' } as const;

function RailButton({
  label,
  tip,
  onClick,
  active = false,
  muted = false,
  children,
}: {
  label: string;
  tip?: string;
  onClick: () => void;
  active?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-muted={muted}
          data-active={active}
          onClick={onClick}
          className={cn(
            'relative flex h-8 w-10 items-center justify-center rounded-row',
            rowState(active, muted),
          )}
        >
          {active && <ActiveBar className="-left-2 inset-y-0.5" />}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{tip ?? label}</TooltipContent>
    </Tooltip>
  );
}

/** The collapsed sidebar: 56 px of icons with tooltips. */
export function SidebarRail(props: SidebarProps) {
  const modKey = useModKey();
  const { groups, statusById, openIds, activeId } = props;
  const overviewActive = activeId === null || activeId === BUILTIN_OVERVIEW;
  const jobsCount = props.jobs.failed + props.jobs.overdue;
  return (
    <nav
      aria-label="Services"
      className="flex h-full w-14 flex-col items-center border-r border-hairline bg-chrome"
    >
      <div className="flex h-10 shrink-0 items-center">
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-tile bg-text text-[11px] font-bold text-page"
        >
          I
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <RailButton
          label="Search"
          tip={`Search ${modKey === '⌘' ? '⌘K' : 'Ctrl+K'}`}
          onClick={props.onSearch}
        >
          <Search className="size-4 text-text-2" />
        </RailButton>
        <RailButton
          label="Overview"
          active={overviewActive}
          onClick={() => props.onOpenBuiltin(BUILTIN_OVERVIEW)}
        >
          <House className="size-4 text-text-2" />
        </RailButton>
      </div>
      <div className="mt-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-2">
        {groups.map((g) => (
          <div key={g.name} className="flex flex-col gap-1 border-t border-hairline pt-1">
            {g.services.map((s) => {
              const status = statusById[s.id] ?? 'unknown';
              const open = openIds.includes(s.id);
              return (
                <RailButton
                  key={s.id}
                  label={`${s.name}, ${status}`}
                  active={activeId === s.id}
                  muted={status === 'stopped'}
                  onClick={() => props.onOpenService(s.id)}
                >
                  {open && activeId !== s.id && <ActiveBar className="-left-2 inset-y-2.5" />}
                  <span className={cn('relative flex', status === 'stopped' && 'opacity-50')}>
                    <ServiceIcon service={s} size={24} />
                    <HealthMark
                      status={status}
                      className="absolute -bottom-0.5 -right-1 rounded-full bg-chrome"
                    />
                  </span>
                </RailButton>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-hairline py-2">
        <RailButton
          label={jobsCount > 0 ? `Scheduled jobs, ${jobsCount} need attention` : 'Scheduled jobs'}
          tip="Scheduled jobs"
          active={activeId === BUILTIN_JOBS}
          onClick={() => props.onOpenBuiltin(BUILTIN_JOBS)}
        >
          <Clock className="size-4 text-text-2" />
          <JobsCount
            jobs={props.jobs}
            className="absolute -right-0.5 -top-0.5 h-4 min-w-4 text-[10px]"
          />
        </RailButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              role="img"
              aria-label={dockerText(props.docker)}
              className="flex rounded-row p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <HealthMark status={DOCKER_MARK[props.docker.state]} size={11} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">{dockerText(props.docker)}</TooltipContent>
        </Tooltip>
        <ThemeSwitch compact />
        <RailButton label="Expand sidebar" onClick={props.onToggleCollapsed}>
          <PanelLeft className="size-4 text-text-2" />
        </RailButton>
      </div>
    </nav>
  );
}
