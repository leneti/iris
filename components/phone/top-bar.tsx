'use client';

import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/shell/wordmark';
import { cn } from '@/lib/utils';

/** 48 px bar plus the top safe-area inset (`viewport-fit=cover`). */
export function TopBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center border-b border-line bg-bg pt-[env(safe-area-inset-top)] pr-1 pl-3',
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
      className="flex size-11 shrink-0 items-center justify-center rounded-row focus-visible:outline-2 focus-visible:outline-offset-[-2px] outline-pink-soft"
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
 * The bar of a built-in view: the menu button, then the title (the wordmark on the Overview),
 * the Search button and the tabs button.
 */
export function ViewBar({
  menu,
  title,
  wordmark = false,
  onSearch,
  tabs,
}: {
  menu: ReactNode;
  title: string;
  /** The Overview shows the wordmark in place of a title. */
  wordmark?: boolean;
  onSearch: () => void;
  tabs: ReactNode;
}) {
  return (
    <TopBar>
      {menu}
      {wordmark ? (
        <h1 className="min-w-0 flex-1 text-center">
          <Wordmark />
        </h1>
      ) : (
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-[-0.01em]">
          {title}
        </h1>
      )}
      <button
        type="button"
        aria-label="Search"
        onClick={onSearch}
        className="flex size-11 shrink-0 items-center justify-center rounded-row text-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] outline-pink-soft"
      >
        <Search aria-hidden className="size-5" />
      </button>
      {tabs}
    </TopBar>
  );
}
