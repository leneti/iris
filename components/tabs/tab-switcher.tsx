'use client';

import { AppWindow, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { TabGlyph, TabStatus, type TabItem } from './tab-item';

/** Lists every open tab with its state and a close button. Opens below the status strip. */
export function TabSwitcher({
  tabs,
  activeId,
  onFocus,
  onClose,
  onCloseOthers,
  onCloseAll,
}: {
  tabs: TabItem[];
  activeId: string | null;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}) {
  const closable = tabs.filter((t) => !t.pinned).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Open tabs (${tabs.length})`}
        className="flex size-7 shrink-0 items-center justify-center rounded-row text-text-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AppWindow className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={42} className="w-70">
        <DropdownMenuLabel className="flex justify-between text-[11px] uppercase tracking-[0.06em] text-text-2">
          Open tabs <span className="tabular-nums">{tabs.length}</span>
        </DropdownMenuLabel>
        {tabs.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => onFocus(t.id)}
            className={cn(t.id === activeId && 'bg-selected-raised font-medium')}
          >
            <TabGlyph tab={t} />
            <span className="flex-1 truncate">{t.name}</span>
            <TabStatus tab={t} />
            {!t.pinned && (
              <button
                type="button"
                aria-label={`Close ${t.name} tab`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
                className="flex size-5 items-center justify-center rounded-row text-text-3 hover:bg-hover-raised hover:text-text"
              >
                <X className="size-3.5" />
              </button>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={closable < 2} onSelect={onCloseOthers}>
          Close other tabs
        </DropdownMenuItem>
        <DropdownMenuItem disabled={closable === 0} onSelect={onCloseAll}>
          Close all tabs
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
