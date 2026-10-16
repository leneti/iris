'use client';

import { CornerDownLeft } from 'lucide-react';
import { useModKey } from '@/lib/client/shortcuts';
import { useRef, useState, type ReactNode } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { scoreEntry } from './score';
import { cn } from '@/lib/utils';

export type PaletteSection = 'Services' | 'Links' | 'Open tabs' | 'Actions';
export const SECTION_ORDER: PaletteSection[] = ['Services', 'Links', 'Open tabs', 'Actions'];

export type PaletteEntry = {
  /** Unique across the list (kind and id). It is never searched: see scoreEntry. */
  value: string;
  section: PaletteSection;
  label: string;
  /** Extra search text: group, description, keywords, hostnames. */
  keywords: string[];
  icon: ReactNode;
  /** Small grey text after the name (the group, "Tab 2", a hostname). */
  note?: string;
  /** Right-hand side: health mark, chip. */
  meta?: ReactNode;
  /** `newWindow` is true for Ctrl or Cmd with Enter. */
  onSelect: (newWindow: boolean) => void;
};

/** The query's first occurrence in `text` in the accent colour; no match, plain text. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q === '' ? -1 : text.toLowerCase().indexOf(q);
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-semibold text-accent-text">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded-row border border-hairline-strong bg-chrome px-[5px] text-[10.5px] font-medium text-text-2',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * The search field, the sections and (in a dialog) the key hints. Results are not animated.
 * It owns the query, so it must be unmounted when the palette closes to start empty next time.
 */
export function PaletteList({
  entries,
  page,
  onDone,
  onCancel,
}: {
  entries: PaletteEntry[];
  /** True when rendered as the phone's Search view instead of a dialog. */
  page: boolean;
  /** Called after an entry ran, so a dialog can close. */
  onDone: () => void;
  /** Page mode only: shows a Cancel button beside the field. */
  onCancel?: () => void;
}) {
  const modKey = useModKey();
  const [query, setQuery] = useState('');
  // cmdk runs onSelect for Enter without telling us the modifiers, so remember the last Enter.
  const newWindow = useRef(false);

  return (
    <Command
      filter={scoreEntry}
      className={cn(
        'bg-raised **:data-[slot=command-input-wrapper]:h-[52px] **:data-[slot=command-input-wrapper]:gap-2.5 **:data-[slot=command-input-wrapper]:border-hairline-raised **:data-[slot=command-input-wrapper]:px-3.5 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-text-3 [&_[cmdk-group-heading]]:uppercase',
        page ? 'h-full rounded-none' : 'rounded-panel',
      )}
      onKeyDown={(e) => {
        newWindow.current = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
      }}
      onPointerDown={() => {
        newWindow.current = false;
      }}
    >
      <CommandInput
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder="Search services, links and actions…"
        aria-label="Search"
        className={cn('h-[52px] py-0', page ? 'text-base' : 'text-[15px]')}
        trailing={
          page ? (
            onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="-mr-2 flex h-11 shrink-0 items-center rounded-row px-2 text-base font-medium text-accent-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </button>
            )
          ) : (
            <Kbd>esc</Kbd>
          )
        }
      />
      <CommandList
        className={cn(
          'pb-2',
          page ? 'max-h-none min-h-0 flex-1' : 'max-h-[min(420px,calc(100dvh-340px))]',
        )}
      >
        <CommandEmpty>No results</CommandEmpty>
        {SECTION_ORDER.map((section) => {
          const rows = entries.filter((e) => e.section === section);
          if (rows.length === 0) return null;
          return (
            <CommandGroup key={section} heading={section} className="p-0">
              {rows.map((e) => (
                <CommandItem
                  key={e.value}
                  value={e.value}
                  keywords={[e.label, ...e.keywords]}
                  onSelect={() => {
                    const alone = newWindow.current;
                    newWindow.current = false;
                    e.onSelect(alone);
                    onDone();
                  }}
                  className={cn(
                    'group mx-1.5 gap-2.5 px-2.5 py-0',
                    page ? 'h-12 text-[15px]' : 'h-10 text-[13.5px]',
                  )}
                >
                  {e.icon}
                  <span className="truncate">
                    <Highlight text={e.label} query={query} />
                  </span>
                  {e.note && (
                    <span className="truncate text-xs text-text-3 group-data-[selected=true]:text-text-2">
                      {e.note}
                    </span>
                  )}
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-text-2">
                    {e.meta}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
      {!page && (
        <div className="flex h-10 shrink-0 items-center gap-[18px] border-t border-hairline-raised px-3.5 text-[11.5px] text-text-3">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> Move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>
              <CornerDownLeft className="size-[11px]" aria-hidden />
            </Kbd>{' '}
            Open
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>{modKey}</Kbd>
            <Kbd>
              <CornerDownLeft className="size-[11px]" aria-hidden />
            </Kbd>{' '}
            New window
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Kbd>esc</Kbd> Close
          </span>
        </div>
      )}
    </Command>
  );
}
