'use client';

import type { ReactNode, Ref } from 'react';
import { isBuiltin, type TabsState } from '@/lib/client/tabs';
import type { ServiceStatus } from '@/lib/shared/contract';
import { FallbackCard } from './fallback-card';
import type { FrameModel } from './frame-model';
import { FrameTab } from './frame-tab';
import type { Frames } from './use-frames';

/**
 * Every open service tab in one stable container, in the order the tabs were opened. A live tab
 * gets an iframe, a blocked one gets the card, and a suspended one gets nothing. Inactive panes
 * are `hidden`, never removed or moved: moving an iframe in the DOM reloads it. React keeps each
 * keyed pane where it is, and a tab that returns from suspension is inserted, not reordered.
 * Built-in views (`children`) share the canvas and show when no service tab is active. With
 * `flow` (the phone) they sit in the page's flow and the page itself scrolls; otherwise they fill
 * the canvas and scroll inside it.
 */
export function Canvas({
  tabs,
  models,
  statusById,
  alwaysNewTab,
  frames,
  onCheckAgain,
  onAlwaysNewTab,
  children,
  flow = false,
  ref,
}: {
  tabs: TabsState;
  models: ReadonlyMap<string, FrameModel>;
  statusById: Readonly<Record<string, ServiceStatus>>;
  /** Services this device always opens in a browser tab. */
  alwaysNewTab: Readonly<Record<string, boolean>>;
  frames: Frames;
  onCheckAgain: () => void;
  onAlwaysNewTab: (id: string, on: boolean) => void;
  children?: ReactNode;
  flow?: boolean;
  ref?: Ref<HTMLElement>;
}) {
  const builtinActive = tabs.active === null || isBuiltin(tabs.active);
  return (
    <main ref={ref} data-slot="canvas" className="relative min-h-0 flex-1 bg-page">
      {tabs.open.map((id) => {
        const model = models.get(id);
        if (!model) return null;
        const active = tabs.active === id;
        if (model.card !== null) {
          return (
            <div
              key={`card:${id}`}
              hidden={!active}
              className="absolute inset-0 flex items-center justify-center overflow-auto p-4"
            >
              <FallbackCard
                model={model}
                status={statusById[id] ?? 'unknown'}
                alwaysNewTab={alwaysNewTab[id] === true}
                onAlwaysNewTab={(on) => onAlwaysNewTab(id, on)}
                onCheckAgain={onCheckAgain}
                onSignedIn={() => frames.reload(id)}
              />
            </div>
          );
        }
        if (model.url === null || !tabs.live.includes(id)) return null;
        return (
          <FrameTab
            key={`${id}:${frames.nonce(id)}`}
            model={{ ...model, url: model.url }}
            active={active}
            loaded={frames.loaded.has(id)}
            onLoad={() => frames.markLoaded(id)}
            onSignedIn={() => frames.reload(id)}
          />
        );
      })}
      {children !== undefined && (
        <div
          hidden={!builtinActive}
          className={flow ? 'relative' : 'absolute inset-0 overflow-auto overscroll-contain'}
        >
          {children}
        </div>
      )}
    </main>
  );
}
