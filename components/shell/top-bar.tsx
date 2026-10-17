'use client';

import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { JobsPill } from '@/components/jobs/jobs-pill';
import { useModKey } from '@/lib/client/shortcuts';
import type { CronResponse } from '@/lib/shared/contract';
import { Wordmark } from './wordmark';

/** 56 px bar: wordmark, the tab bar, the Jobs pill and the search button. */
export function DesktopTopBar({
  tabBar,
  cron,
  onOpenJobs,
  onSearch,
}: {
  tabBar: ReactNode;
  cron: CronResponse | undefined;
  onOpenJobs: () => void;
  onSearch: () => void;
}) {
  const modKey = useModKey();
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-6">
      <Wordmark />
      <div className="h-full min-w-0 flex-1">{tabBar}</div>
      <JobsPill cron={cron} onOpen={onOpenJobs} />
      <button
        type="button"
        aria-label="Search"
        onClick={onSearch}
        className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-line-strong px-3 text-[13px] text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search aria-hidden className="size-4" />
        <span>Search</span>
        <kbd className="rounded-row border border-line-strong px-1 font-mono text-[10px] text-faint">
          {modKey === '⌘' ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>
    </header>
  );
}
