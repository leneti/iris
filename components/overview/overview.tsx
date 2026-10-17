'use client';

import type { ReactNode } from 'react';
import { useWidgets } from '@/lib/client/api';
import { shownGroups } from '@/lib/client/services';
import { groupIcon, dockerText } from '@/components/shell/sidebar';
import type { DockerState } from '@/components/shell/use-shell';
import type { ServiceStatus, ServicesResponse, StandaloneWidget } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';
import { JobsCard } from './jobs-card';
import { LinksRow } from './links-row';
import { MarketsTile } from './markets-tile';
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

  // Standalone tiles sit in their own group, and a group that only they use is added at the end.
  const names = new Set(groups.map((g) => g.name));
  const extra = [...new Set(standalone.map((w) => w.group))].filter((g) => !names.has(g));
  const sections: {
    name: string;
    icon: string | null;
    services: (typeof groups)[number]['services'];
    tiles: StandaloneWidget[];
  }[] = [
    ...groups.map((g) => ({
      name: g.name,
      icon: g.icon,
      services: g.services,
      tiles: standalone.filter((w) => w.group === g.name),
    })),
    ...extra.map((name) => ({
      name,
      icon: null,
      services: [],
      tiles: standalone.filter((w) => w.group === name),
    })),
  ];

  const withWidget = (id: string) => widgets?.services[id] !== undefined;
  const rich = (s: (typeof sections)[number]) => s.services.filter((x) => withWidget(x.id));
  const plain = (s: (typeof sections)[number]) => s.services.filter((x) => !withWidget(x.id));

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
          {sections.map((section) => {
            const Icon = groupIcon(section.icon);
            return (
              <section key={section.name} aria-label={section.name}>
                <GroupLabel
                  name={section.name}
                  icon={Icon ? <Icon aria-hidden className="size-3.5" /> : null}
                  count={section.services.length + section.tiles.length}
                />
                {/* Cards with figures first, two to a row so four figures fit; then the plain tiles. */}
                {[rich(section), plain(section)].map((list, i) =>
                  list.length === 0 && (i === 1 || section.tiles.length === 0) ? null : (
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
                      {i === 0 && section.tiles.map((w) => <MarketsTile key={w.id} widget={w} />)}
                    </div>
                  ),
                )}
              </section>
            );
          })}
          <LinksRow links={services?.links ?? []} />
        </div>
      </div>
      <aside aria-label="Panels" className="flex w-[360px] shrink-0 flex-col gap-4">
        <SystemPanel />
        <NowPlayingPanel />
        <JobsCard onOpenJobs={onOpenJobs} />
      </aside>
    </div>
  );
}
