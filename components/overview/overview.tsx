'use client';

import type { ReactNode } from 'react';
import { useWidgets } from '@/lib/client/api';
import { shownGroups } from '@/lib/client/services';
import { groupIcon, dockerText } from '@/components/shell/sidebar';
import type { DockerState } from '@/components/shell/use-shell';
import type { ServiceStatus, ServicesResponse } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';
import { JobsCard } from './jobs-card';
import { LinksCard } from './links';
import { MarketsCard } from './markets';
import { NowPlayingPanel } from './now-playing-panel';
import { ServiceTile } from './service-tile';
import { SystemPanel } from './system-panel';
import { Weather } from './weather';

export type OverviewProps = {
  services: ServicesResponse | undefined;
  statusById: Record<string, ServiceStatus>;
  openIds: string[];
  docker: Pick<DockerState, 'state' | 'ageSeconds'>;
  /** AppShell's wrapper, so a service this device always opens in a browser tab still does. */
  onOpenService: (id: string) => void;
  onOpenJobs: () => void;
};

function GroupLabel({ name, icon, count }: { name: string; icon: ReactNode; count: number }) {
  return (
    <h2 className="flex h-[22px] items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-text-2 uppercase">
      {icon}
      {name}
      <span className="font-normal tabular-nums">{count}</span>
      <span aria-hidden className="ml-2 h-px flex-1 bg-hairline-strong" />
    </h2>
  );
}

/** The built-in Overview, and what the canvas shows when no tab is open (handoff 7.6). */
export function Overview({
  services,
  statusById,
  openIds,
  docker,
  onOpenService,
  onOpenJobs,
}: OverviewProps) {
  const { data: widgets } = useWidgets();
  const groups = shownGroups(services?.groups ?? []);
  const standalone = widgets?.standalone ?? [];
  const serviceCount = groups.reduce((n, g) => n + g.services.length, 0);
  const tabCount = openIds.filter((id) => !id.startsWith('builtin:')).length;

  const withWidget = (id: string) => widgets?.services[id] !== undefined;
  const rich = (g: (typeof groups)[number]) => g.services.filter((x) => withWidget(x.id));
  const plain = (g: (typeof groups)[number]) => g.services.filter((x) => !withWidget(x.id));

  return (
    <div className="flex items-start gap-5 px-6 py-5">
      <div className="min-w-0 flex-1">
        <header className="mb-3 flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-[-0.015em]">Overview</h1>
          <span className="text-xs text-text-2">
            {serviceCount} services · {tabCount} open {tabCount === 1 ? 'tab' : 'tabs'}
          </span>
          <div className="ml-auto flex items-center gap-4">
            <Weather weather={widgets?.weather} />
            <p
              className={cn(
                'flex items-center gap-1.5 text-xs',
                docker.state === 'unreachable' ? 'text-status-degraded-text' : 'text-text-2',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  docker.state === 'ok'
                    ? 'bg-status-healthy'
                    : docker.state === 'pending'
                      ? 'bg-status-unknown'
                      : 'bg-status-degraded',
                )}
              />
              {dockerText(docker)}
            </p>
          </div>
        </header>
        <div className="flex flex-col gap-5">
          {groups.map((group) => {
            const Icon = groupIcon(group.icon);
            return (
              <section key={group.name} aria-label={group.name}>
                <GroupLabel
                  name={group.name}
                  icon={Icon ? <Icon aria-hidden className="size-3.5" /> : null}
                  count={group.services.length}
                />
                {/* Cards with figures first, two to a row so four figures fit; then the plain tiles. */}
                {[rich(group), plain(group)].map((list, i) =>
                  list.length === 0 ? null : (
                    <div
                      key={i}
                      className={cn('mt-2 grid gap-2.5', i === 0 ? 'grid-cols-2' : 'grid-cols-3')}
                    >
                      {list.map((s) => (
                        <ServiceTile
                          key={s.id}
                          service={s}
                          status={statusById[s.id] ?? 'unknown'}
                          open={openIds.includes(s.id)}
                          widget={widgets?.services[s.id]}
                          onOpen={onOpenService}
                        />
                      ))}
                    </div>
                  ),
                )}
              </section>
            );
          })}
        </div>
      </div>
      <aside aria-label="Panels" className="flex w-[360px] shrink-0 flex-col gap-4">
        <SystemPanel />
        <NowPlayingPanel />
        {standalone.map((w) => (
          <MarketsCard key={w.id} widget={w} />
        ))}
        <LinksCard links={services?.links ?? []} />
        <JobsCard onOpenJobs={onOpenJobs} />
      </aside>
    </div>
  );
}
