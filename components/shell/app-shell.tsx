'use client';

import { useEffect, useRef, useState } from 'react';
import { useHostname, useMedia, usePref, useProtocol } from '@/lib/client/use-client';
import { frameUrl, isPublicAddress, type AddressMode } from '@/lib/client/address';
import { NEW_TAB_PREF, openInBrowserTab, setAlwaysNewTab } from '@/lib/client/new-tab';
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
import { JobsView } from '@/components/jobs/jobs-view';
import { Overview } from '@/components/overview/overview';
import { ReadingProvider } from '@/components/reading/reading-context';
import { DesktopTopBar } from './top-bar';
import { TabBar, builtinName, type TabItem } from './tab-bar';
import { useShell } from './use-shell';

const PHONE_QUERY = '(max-width: 639px)';
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

  // The Overview is pinned first, whether or not it is in `tabs.open`.
  const overviewTab: TabItem = {
    id: BUILTIN_OVERVIEW,
    name: builtinName(BUILTIN_OVERVIEW),
    service: null,
    status: null,
    pinned: true,
  };
  const items: TabItem[] = [overviewTab].concat(
    tabs.open.flatMap<TabItem>((id) => {
      if (id === BUILTIN_OVERVIEW) return [];
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
    }),
  );

  const activeId = tabs.active;
  const builtinActive = activeId === null || isBuiltin(activeId);
  const activeService = activeId && !isBuiltin(activeId) ? byId.get(activeId) : undefined;
  const activeUrl = activeService ? frameUrl(activeService, mode, hostname) : null;

  // A service this device always opens elsewhere never becomes a tab.
  function openService(id: string) {
    const service = byId.get(id);
    const url = service ? frameUrl(service, mode, hostname) : null;
    if (url !== null && alwaysNewTab[id] === true) openInBrowserTab(url);
    else shell.openService(id);
  }

  const phone = (
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

  const tabBar = (
    <TabBar
      tabs={items}
      activeId={activeId ?? BUILTIN_OVERVIEW}
      onFocus={(id) =>
        id === BUILTIN_OVERVIEW
          ? shell.openBuiltin(BUILTIN_OVERVIEW)
          : shell.dispatch({ type: 'focus', id })
      }
      onClose={(id) => shell.dispatch({ type: 'close', id })}
      onCloseOthers={() => shell.dispatch({ type: 'closeOthers' })}
      onCloseAll={() => shell.dispatch({ type: 'closeAll' })}
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
  );

  return (
    <ReadingProvider services={shell.services}>
      {isPhone ? (
        phone
      ) : (
        <div className="flex h-dvh flex-col bg-bg text-text">
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
          />
          <DesktopTopBar
            tabBar={tabBar}
            cron={shell.cron}
            onOpenJobs={() => shell.openBuiltin(BUILTIN_JOBS)}
            onSearch={() => setPaletteOpen(true)}
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
      )}
    </ReadingProvider>
  );
}
