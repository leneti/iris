'use client';

import { Clock, House, LayoutGrid, Menu, Search, type LucideIcon } from 'lucide-react';
import { JobsCount, type JobsBadge } from '@/components/shell/sidebar';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export type PhoneView = 'overview' | 'services' | 'search' | 'jobs';

const ITEMS: readonly { view: PhoneView; label: string; Icon: LucideIcon }[] = [
  { view: 'overview', label: 'Overview', Icon: House },
  { view: 'services', label: 'Services', Icon: LayoutGrid },
  { view: 'search', label: 'Search', Icon: Search },
  { view: 'jobs', label: 'Jobs', Icon: Clock },
];

/**
 * The menu button, first on a built-in view's top bar: a 44 px target around the burger icon. A
 * dot on it says a job needs attention, so the count is not hidden behind the menu.
 */
export function MenuButton({ jobs, onClick }: { jobs: JobsBadge; onClick: () => void }) {
  const count = jobs.failed + jobs.overdue;
  return (
    <button
      type="button"
      aria-label={count > 0 ? `Menu, ${count} jobs need attention` : 'Menu'}
      onClick={onClick}
      className="relative -ml-2 mr-1 flex size-11 shrink-0 items-center justify-center rounded-row text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Menu aria-hidden className="size-6" />
      {count > 0 && (
        <span
          aria-hidden
          className={cn(
            'absolute top-2 right-2 size-2.5 rounded-full ring-2 ring-chrome',
            jobs.failed > 0 ? 'bg-status-unhealthy' : 'bg-status-degraded',
          )}
        />
      )}
    </button>
  );
}

/**
 * The menu button's sheet: the four built-in views, the current one marked, Jobs with the
 * sidebar's own count. It drops from the top, like the tabs sheet: Firefox for Android does not
 * keep fixed elements on the bottom edge of the screen, so nothing on a phone sits there.
 */
export function NavMenu({
  open,
  onOpenChange,
  view,
  jobs,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: PhoneView;
  jobs: JobsBadge;
  onSelect: (view: PhoneView) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="top"
        showCloseButton={false}
        className="max-h-[80svh] gap-0 overflow-y-auto overscroll-contain rounded-b-sheet pt-[env(safe-area-inset-top)] pb-2"
      >
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SheetDescription className="sr-only">Go to another view.</SheetDescription>
        <nav aria-label="Main" className="px-1.5 pt-1.5">
          {ITEMS.map(({ view: id, label, Icon }) => {
            const current = id === view;
            const count = jobs.failed + jobs.overdue;
            return (
              <button
                key={id}
                type="button"
                aria-label={id === 'jobs' && count > 0 ? `Jobs, ${count} need attention` : label}
                aria-current={current ? 'page' : undefined}
                onClick={() => {
                  onSelect(id);
                  onOpenChange(false);
                }}
                className={cn(
                  'flex min-h-12 w-full items-center gap-4 rounded-row px-3 text-left text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  current ? 'bg-selected font-semibold text-accent-text' : 'text-text',
                )}
              >
                <Icon aria-hidden className={cn('size-5', !current && 'text-text-2')} />
                <span className="flex-1">{label}</span>
                {id === 'jobs' && <JobsCount jobs={jobs} />}
              </button>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
