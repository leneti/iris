'use client';

import { Clock, House, LayoutGrid, Search, type LucideIcon } from 'lucide-react';
import { JobsCount, type JobsBadge } from '@/components/shell/sidebar';
import { cn } from '@/lib/utils';

export type PhoneView = 'overview' | 'services' | 'search' | 'jobs';

const ITEMS: readonly { view: PhoneView; label: string; Icon: LucideIcon }[] = [
  { view: 'overview', label: 'Overview', Icon: House },
  { view: 'services', label: 'Services', Icon: LayoutGrid },
  { view: 'search', label: 'Search', Icon: Search },
  { view: 'jobs', label: 'Jobs', Icon: Clock },
];

/**
 * Four items, 56 px plus the bottom safe-area inset, fixed to the bottom of the screen (the page
 * scrolls under it, and the browser keeps a fixed bar clear of its own toolbars). The current one
 * has the accent colour and a 2 px bar on top. The Jobs badge is the sidebar's own count.
 * `inset` is false where the browser reports a gesture-bar inset it does not draw under.
 */
export function BottomNav({
  view,
  jobs,
  onSelect,
  inset = true,
}: {
  view: PhoneView;
  inset?: boolean;
  jobs: JobsBadge;
  onSelect: (view: PhoneView) => void;
}) {
  return (
    <nav
      aria-label="Main"
      className={cn(
        'fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-hairline bg-chrome',
        inset && 'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {ITEMS.map(({ view: id, label, Icon }) => {
        const current = id === view;
        const count = jobs.failed + jobs.overdue;
        return (
          <button
            key={id}
            type="button"
            aria-label={id === 'jobs' && count > 0 ? `Jobs, ${count} need attention` : label}
            aria-current={current ? 'page' : undefined}
            onClick={() => onSelect(id)}
            className={cn(
              'relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              current ? 'text-accent-text' : 'text-text-2',
            )}
          >
            {current && <span aria-hidden className="absolute top-0 h-0.5 w-8 bg-accent-mark" />}
            <span className="relative flex">
              <Icon aria-hidden className="size-6" />
              {id === 'jobs' && <JobsCount jobs={jobs} className="absolute -top-1 -right-2.5" />}
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}
