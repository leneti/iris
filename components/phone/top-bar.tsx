'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** 48 px bar plus the top safe-area inset (`viewport-fit=cover`). */
export function TopBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center border-b border-hairline bg-chrome pt-[env(safe-area-inset-top)] pr-1 pl-3',
        className,
      )}
    >
      {children}
    </header>
  );
}

/** The tabs button on every top bar: a 44 px target around a 28 px box with the tab count. */
export function TabsButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Tabs (${count} open)`}
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center rounded-row outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className="flex size-7 items-center justify-center rounded-tile border-2 border-text-2 text-[13px] font-semibold text-text tabular-nums"
      >
        {count}
      </span>
    </button>
  );
}

/**
 * The bar of a built-in view: the menu button, the title (with the Iris mark on the Overview),
 * then the extras.
 */
export function ViewBar({
  menu,
  title,
  mark = false,
  weather,
  tabs,
}: {
  menu: ReactNode;
  title: string;
  /** The Overview shows the Iris mark beside its title. */
  mark?: boolean;
  weather?: ReactNode;
  tabs: ReactNode;
}) {
  return (
    <TopBar>
      {menu}
      {mark && (
        <span
          aria-hidden
          className="mr-3 flex size-7 shrink-0 items-center justify-center rounded-tile bg-text text-[13px] font-bold text-page"
        >
          I
        </span>
      )}
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-[-0.01em]">
        {title}
      </h1>
      {weather !== undefined && <div className="mr-1 shrink-0">{weather}</div>}
      {tabs}
    </TopBar>
  );
}
