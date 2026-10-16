'use client';

import { Plus, X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { TabGlyph, TabStatus, type TabItem } from '@/components/tabs/tab-item';
import { TabSwitcher } from '@/components/tabs/tab-switcher';
import { cn } from '@/lib/utils';

export { builtinName, type TabItem } from '@/components/tabs/tab-item';

export type TabBarProps = {
  tabs: TabItem[];
  activeId: string | null;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onNew: () => void;
  /** Reload, pop-out and fullscreen for the active service tab. */
  controls?: ReactNode;
  /** The "more" menu, last in the strip. */
  more?: ReactNode;
};

/**
 * 40 px strip of 28 px tabs, "+" (opens the Overview), the active tab's controls, the tab
 * switcher and the "more" menu.
 */
export function TabBar({
  tabs,
  activeId,
  onFocus,
  onClose,
  onCloseOthers,
  onCloseAll,
  onNew,
  controls,
  more,
}: TabBarProps) {
  const list = useRef<HTMLDivElement>(null);
  // With many tabs the strip scrolls; keep the active one in view.
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number, id: string) => {
    if (e.key === 'Delete') {
      onClose(id);
      return;
    }
    const last = tabs.length - 1;
    const to =
      e.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (to < 0) return;
    e.preventDefault();
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 bg-chrome px-2">
      <div
        ref={list}
        role="tablist"
        aria-label="Open tabs"
        className="flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {tabs.map((t, i) => {
          const active = t.id === activeId;
          // One tab stop for the strip (the active tab, or the first); arrows move within it.
          const stop = active || (i === 0 && !tabs.some((x) => x.id === activeId));
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={stop ? 0 : -1}
              onClick={() => onFocus(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(t.id);
              }}
              onKeyDown={(e) => onKey(e, i, t.id)}
              className={cn(
                'flex h-7 max-w-48 shrink-0 items-center gap-2 rounded-row pl-2 pr-1 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active ? 'bg-selected font-medium' : 'hover:bg-hover',
              )}
            >
              <TabGlyph tab={t} />
              <span className="truncate">{t.name}</span>
              <TabStatus tab={t} />
              {/* A mouse affordance only: a button inside a tab is invalid ARIA. Keyboard users press Delete, or use the tab switcher. */}
              <span
                aria-hidden
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
                className="flex size-5 shrink-0 items-center justify-center rounded-row text-text-3 hover:bg-hover-raised hover:text-text"
              >
                <X className="size-3.5" />
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New tab: open the Overview"
        onClick={onNew}
        className="flex size-7 shrink-0 items-center justify-center rounded-row text-text-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-4" />
      </button>
      <div className="flex-1" />
      {controls}
      {controls && <span aria-hidden className="mx-1 h-4 w-px bg-hairline-strong" />}
      <TabSwitcher
        tabs={tabs}
        activeId={activeId}
        onFocus={onFocus}
        onClose={onClose}
        onCloseOthers={onCloseOthers}
        onCloseAll={onCloseAll}
      />
      {more}
    </div>
  );
}
