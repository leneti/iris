'use client';

import { useState } from 'react';
import { Weather } from '@/components/overview/weather';
import type { JobsBadge } from '@/components/shell/sidebar';
import type { Shell } from '@/components/shell/use-shell';
import { Canvas } from '@/components/tabs/canvas';
import type { FrameModel } from '@/components/tabs/frame-model';
import type { Frames } from '@/components/tabs/use-frames';
import { useWidgets } from '@/lib/client/api';
import { useBottomInset } from '@/lib/client/use-client';
import { isPublicAddress, type AddressMode } from '@/lib/client/address';
import { setAlwaysNewTab } from '@/lib/client/new-tab';
import { shownGroups } from '@/lib/client/services';
import { BUILTIN_JOBS, BUILTIN_OVERVIEW, isBuiltin } from '@/lib/client/tabs';
import type { ServiceEntry } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';
import { BottomNav, type PhoneView } from './bottom-nav';
import { PhoneJobs } from './phone-jobs';
import { PhoneOverview } from './phone-overview';
import { PhoneSearch } from './phone-search';
import { PhoneServices } from './phone-services';
import { ServiceBar } from './service-view';
import { TabSheet, type CurrentTab, type SheetTab } from './tab-sheet';
import { TabsButton, ViewBar } from './top-bar';

export type PhoneShellProps = {
  shell: Shell;
  byId: ReadonlyMap<string, ServiceEntry>;
  models: ReadonlyMap<string, FrameModel>;
  frames: Frames;
  alwaysNewTab: Readonly<Record<string, boolean>>;
  address: { mode: AddressMode; hostname: string; protocol: string };
  /** The sidebar's Scheduled jobs count, from the same source. */
  jobs: JobsBadge;
  /** AppShell's wrapper, so a service this device always opens in a browser tab still does. */
  openService: (id: string) => void;
  signIn: (url: string, onClosed: () => void) => void;
};

const TITLE: Record<Exclude<PhoneView, 'search'>, string> = {
  overview: 'Iris',
  services: 'Services',
  jobs: 'Scheduled jobs',
};

/**
 * The phone layout below 640 px (handoff 7.7): a top bar, the content, and a bottom navigation
 * bar. A built-in view scrolls the page itself, under a sticky top bar and above the fixed bottom
 * navigation, so the browser sizes it, hides its toolbar on scroll, and pulls to refresh at the
 * top. An open service fills the screen and hides the bottom navigation; the frame scrolls
 * inside. The Canvas holds every frame in one place whichever view shows, so no frame is ever
 * moved or reloaded.
 */
export function PhoneShell({
  shell,
  byId,
  models,
  frames,
  alwaysNewTab,
  address,
  jobs,
  openService,
  signIn,
}: PhoneShellProps) {
  const { tabs } = shell;
  const { data: widgets } = useWidgets();
  const inset = useBottomInset();
  // The last built-in view; Back from a service returns to it.
  const [view, setView] = useState<PhoneView>('overview');
  const [sheetOpen, setSheetOpen] = useState(false);

  const serviceTabs: SheetTab[] = tabs.open.flatMap((id) => {
    const service = byId.get(id);
    return service ? [{ id, service, status: shell.statusById[id] ?? 'unknown' }] : [];
  });
  const activeId = tabs.active;
  const activeService = activeId !== null && !isBuiltin(activeId) ? byId.get(activeId) : undefined;
  const activeModel = activeId === null ? undefined : models.get(activeId);
  const activeUrl = activeModel?.url ?? null;
  const groups = shell.services?.groups ?? [];

  const tabsButton = <TabsButton count={serviceTabs.length} onClick={() => setSheetOpen(true)} />;
  const current: CurrentTab | null =
    activeService === undefined
      ? null
      : {
          name: activeService.name,
          url: activeUrl,
          canSignIn: activeUrl !== null && isPublicAddress(activeUrl),
        };

  function show(next: PhoneView) {
    // The page scrolls, so a new view starts at its top.
    if (next !== view) window.scrollTo?.(0, 0);
    setView(next);
  }
  function focusTab(id: string) {
    if (id === BUILTIN_JOBS) show('jobs');
    else if (id === BUILTIN_OVERVIEW) show('overview');
    shell.dispatch({ type: 'focus', id });
  }

  let content = null;
  if (activeService === undefined) {
    if (view === 'overview') {
      content = (
        <PhoneOverview
          services={shell.services}
          status={shell.status}
          openIds={tabs.open}
          onOpenService={openService}
          onOpenJobs={() => show('jobs')}
        />
      );
    } else if (view === 'services') {
      content = (
        <PhoneServices
          groups={shownGroups(groups)}
          statusById={shell.statusById}
          openIds={tabs.open}
          onOpenService={openService}
        />
      );
    } else if (view === 'search') {
      content = (
        <PhoneSearch
          groups={groups}
          links={shell.services?.links ?? []}
          statusById={shell.statusById}
          openIds={serviceTabs.map((t) => t.id)}
          address={address}
          onOpenService={openService}
          onFocusTab={focusTab}
          onOpenBuiltin={(id) => show(id === BUILTIN_JOBS ? 'jobs' : 'overview')}
          jobsFailed={jobs.failed}
          onCancel={() => show('overview')}
        />
      );
    } else {
      content = <PhoneJobs />;
    }
  }

  return (
    <div
      data-slot="phone-shell"
      className={cn(
        'flex flex-col bg-page text-[15px] text-text',
        activeService === undefined
          ? cn('min-h-svh', inset ? 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]' : 'pb-14')
          : 'fixed inset-0 overflow-hidden overscroll-contain',
      )}
    >
      {activeService !== undefined && activeId !== null ? (
        <ServiceBar
          service={activeService}
          status={shell.statusById[activeId] ?? 'unknown'}
          hasUrl={activeUrl !== null}
          tabCount={serviceTabs.length}
          // Back leaves the tab open: a built-in tab takes the focus instead.
          onBack={() => shell.openBuiltin(BUILTIN_OVERVIEW)}
          onReload={() => frames.reload(activeId)}
          onTabs={() => setSheetOpen(true)}
        />
      ) : view === 'search' ? null : (
        <div className="sticky top-0 z-20">
          <ViewBar
            title={TITLE[view]}
            mark={view === 'overview'}
            weather={
              view === 'overview' ? <Weather compact weather={widgets?.weather} /> : undefined
            }
            tabs={tabsButton}
          />
        </div>
      )}
      <Canvas
        tabs={tabs}
        models={models}
        statusById={shell.statusById}
        alwaysNewTab={alwaysNewTab}
        frames={frames}
        onCheckAgain={shell.recheck}
        onAlwaysNewTab={setAlwaysNewTab}
        flow
      >
        {content}
      </Canvas>
      {activeService === undefined && (
        <BottomNav view={view} jobs={jobs} onSelect={show} inset={inset} />
      )}
      <TabSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        tabs={serviceTabs}
        activeId={activeService === undefined ? null : activeId}
        current={current}
        onFocus={focusTab}
        onClose={(id) => shell.dispatch({ type: 'close', id })}
        onCloseAll={() => shell.dispatch({ type: 'closeAll' })}
        onSignIn={() => {
          if (activeId !== null && activeUrl !== null) {
            signIn(activeUrl, () => frames.reload(activeId));
          }
        }}
      />
    </div>
  );
}
