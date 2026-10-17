'use client';

import { useEffect, useRef, useState } from 'react';
import { useHostname, useMedia, usePref, useProtocol } from '@/lib/client/use-client';
import { frameUrl, isPublicAddress, type AddressMode } from '@/lib/client/address';
import { NEW_TAB_PREF, openInBrowserTab, setAlwaysNewTab } from '@/lib/client/new-tab';
import { prefs } from '@/lib/client/prefs';
import { BUILTIN_JOBS, BUILTIN_OVERVIEW, DEFAULT_MAX_LIVE, isBuiltin } from '@/lib/client/tabs';
import type { ServiceEntry } from '@/lib/shared/contract';
import { shouldOpenPalette } from '@/lib/client/shortcuts';
import { Palette } from '@/components/palette/palette';
import { Canvas } from '@/components/tabs/canvas';
import { frameModel, tabMark, type FrameModel } from '@/components/tabs/frame-model';
import { MoreMenu } from '@/components/tabs/more-menu';
import { useSignIn } from '@/components/tabs/sign-in';
import { TabControls } from '@/components/tabs/tab-controls';
import { useFrames } from '@/components/tabs/use-frames';
import { PhoneShell } from '@/components/phone/phone-shell';
import { Sidebar } from './sidebar';
import { SidebarRail } from './sidebar-rail';
import { JobsView } from '@/components/jobs/jobs-view';
import { Overview } from '@/components/overview/overview';
import { StatusStrip, type StripView } from './status-strip';
import { TabBar, builtinName, type TabItem } from './tab-bar';
import { useShell } from './use-shell';

const PHONE_QUERY = '(max-width: 639px)';
const NARROW_QUERY = '(max-width: 1023px)';
export const SIDEBAR_PREF = 'sidebar.collapsed';
const DEFAULT_PHONE_MAX_LIVE = 3;

/** True below 640 px. False on the server, so the first client render matches it. */
export function useIsPhone(): boolean {
  return useMedia(PHONE_QUERY);
}

export function AppShell({
  mode,
  phoneMaxLive = DEFAULT_PHONE_MAX_LIVE,
}: {
  mode: AddressMode;
  /** `phone.maxLiveFrames` from iris.yaml: the live-frame limit below 640 px. */
  phoneMaxLive?: number;
}) {
  const isPhone = useIsPhone();
  const shell = useShell(mode, isPhone ? phoneMaxLive : DEFAULT_MAX_LIVE);
  const hostname = useHostname();
  const protocol = useProtocol();
  const alwaysNewTab = usePref<Record<string, boolean>>(NEW_TAB_PREF, {});
  const frames = useFrames(shell.tabs.live);
  const signIn = useSignIn();
  const canvasRef = useRef<HTMLElement | null>(null);
  // 640-1023 px starts collapsed unless this device has chosen.
  const narrow = useMedia(NARROW_QUERY);
  const chosen = usePref<'collapsed' | 'expanded' | ''>(SIDEBAR_PREF, '');
  const collapsed = chosen === '' ? narrow : chosen === 'collapsed';
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Cmd/Ctrl+K toggles the palette; "/" opens it outside text fields. Not on phones (no keyboard).
  useEffect(() => {
    if (isPhone) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!shouldOpenPalette(e, document.activeElement)) return;
      e.preventDefault();
      setPaletteOpen((open) => (e.key === '/' ? true : !open));
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isPhone]);

  const groups = shell.services?.groups ?? [];
  const byId = new Map<string, ServiceEntry>(
    groups.flatMap((g) => g.services.map((s) => [s.id, s])),
  );
  const { tabs, statusById } = shell;
  const jobsSummary = shell.cron?.summary;
  const jobs = { failed: jobsSummary?.failed ?? 0, overdue: jobsSummary?.overdue ?? 0 };

  const models = new Map<string, FrameModel>();
  for (const id of tabs.open) {
    const service = byId.get(id);
    if (service) {
      models.set(
        id,
        frameModel(service, { mode, hostname, protocol, alwaysNewTab: alwaysNewTab[id] === true }),
      );
    }
  }

  const items: TabItem[] = tabs.open.flatMap<TabItem>((id) => {
    if (isBuiltin(id)) return [{ id, name: builtinName(id), service: null, status: null }];
    const service = byId.get(id);
    const model = models.get(id);
    return service && model
      ? [
          {
            id,
            name: service.name,
            service,
            status: statusById[id] ?? 'unknown',
            mark: tabMark(model, tabs.live.includes(id), frames.loaded.has(id)),
          },
        ]
      : [];
  });

  const activeId = tabs.active;
  const builtinActive = activeId === null || isBuiltin(activeId);
  const activeService = activeId && !isBuiltin(activeId) ? byId.get(activeId) : undefined;
  const activeUrl = activeService ? frameUrl(activeService, mode, hostname) : null;
  const view: StripView = activeService
    ? {
        kind: 'service',
        url: activeUrl,
        homeOnly: mode === 'zone' && activeService.url === null,
      }
    : { kind: 'builtin', name: builtinName(activeId ?? BUILTIN_OVERVIEW) };

  // A service this device always opens elsewhere never becomes a tab.
  function openService(id: string) {
    const service = byId.get(id);
    const url = service ? frameUrl(service, mode, hostname) : null;
    if (url !== null && alwaysNewTab[id] === true) openInBrowserTab(url);
    else shell.openService(id);
  }

  if (isPhone) {
    return (
      <PhoneShell
        shell={shell}
        byId={byId}
        models={models}
        frames={frames}
        alwaysNewTab={alwaysNewTab}
        address={{ mode, hostname, protocol }}
        jobs={jobs}
        openService={openService}
        signIn={signIn}
      />
    );
  }

  function toggleCollapsed() {
    prefs.set(SIDEBAR_PREF, collapsed ? 'expanded' : 'collapsed');
  }

  const sidebarProps = {
    groups,
    statusById,
    openIds: tabs.open,
    activeId,
    onOpenService: openService,
    onOpenBuiltin: shell.openBuiltin,
    onSearch: () => setPaletteOpen(true),
    onToggleCollapsed: toggleCollapsed,
    jobs,
    docker: { ...shell.docker, count: groups.reduce((n, g) => n + g.services.length, 0) },
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-page text-text">
      <Palette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        mode="dialog"
        groups={groups}
        links={shell.services?.links ?? []}
        statusById={statusById}
        openIds={tabs.open}
        address={{ mode, hostname, protocol }}
        onOpenService={openService}
        onFocusTab={(id) => shell.dispatch({ type: 'focus', id })}
        onOpenBuiltin={shell.openBuiltin}
        jobsFailed={jobs.failed}
        sidebarCollapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      {collapsed ? <SidebarRail {...sidebarProps} /> : <Sidebar {...sidebarProps} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar
          tabs={items}
          activeId={activeId}
          onFocus={(id) => shell.dispatch({ type: 'focus', id })}
          onClose={(id) => shell.dispatch({ type: 'close', id })}
          onCloseOthers={() => shell.dispatch({ type: 'closeOthers' })}
          onCloseAll={() => shell.dispatch({ type: 'closeAll' })}
          onNew={() => shell.openBuiltin(BUILTIN_OVERVIEW)}
          controls={
            activeService && activeId ? (
              <TabControls
                hasUrl={activeUrl !== null}
                onReload={() => frames.reload(activeId)}
                onPopOut={() => activeUrl !== null && openInBrowserTab(activeUrl)}
                onFullscreen={() => {
                  // The browser may refuse (no user gesture, policy); nothing to do then.
                  canvasRef.current?.requestFullscreen?.()?.catch(() => undefined);
                }}
              />
            ) : undefined
          }
          more={
            activeService && activeId ? (
              <MoreMenu
                name={activeService.name}
                url={activeUrl}
                canSignIn={activeUrl !== null && isPublicAddress(activeUrl)}
                onSignIn={() => {
                  if (activeUrl !== null) signIn(activeUrl, () => frames.reload(activeId));
                }}
                onCloseTab={() => shell.dispatch({ type: 'close', id: activeId })}
              />
            ) : undefined
          }
        />
        <StatusStrip
          view={view}
          summary={shell.status?.summary}
          cron={shell.cron}
          onOpenJobs={() => shell.openBuiltin(BUILTIN_JOBS)}
        />
        <Canvas
          ref={canvasRef}
          tabs={tabs}
          models={models}
          statusById={statusById}
          alwaysNewTab={alwaysNewTab}
          frames={frames}
          onCheckAgain={shell.recheck}
          onAlwaysNewTab={setAlwaysNewTab}
        >
          {builtinActive &&
            (activeId === BUILTIN_JOBS ? (
              <JobsView />
            ) : (
              <Overview
                services={shell.services}
                statusById={statusById}
                openIds={tabs.open}
                docker={shell.docker}
                onOpenService={openService}
                onOpenJobs={() => shell.openBuiltin(BUILTIN_JOBS)}
              />
            ))}
        </Canvas>
      </div>
    </div>
  );
}
