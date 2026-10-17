'use client';

import { ExternalLink, LogIn, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { HealthMark } from '@/components/health-mark';
import { ServiceIcon } from '@/components/service-icon';
import { CopyField } from '@/components/tabs/copy-field';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { ServiceEntry, ServiceStatus } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';

export type SheetTab = { id: string; service: ServiceEntry; status: ServiceStatus };

/** What the current service tab offers: its address, and whether signing in makes sense. */
export type CurrentTab = { name: string; url: string | null; canSignIn: boolean };

const LABEL = 'text-[11px] font-semibold tracking-[0.06em] text-text-2 uppercase';
const ACTION =
  'flex min-h-12 w-full items-center gap-4 rounded-row px-2 text-left text-[15px] text-text outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

function Action({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <>
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-text-2">
        {icon}
      </span>
      {children}
    </>
  );
}

/**
 * The tabs button's sheet: the open tabs with close buttons, then what the current tab can do.
 * A shadcn Sheet with `side="top"`, dropping from the edge the tabs button sits on: Firefox for
 * Android lays fixed elements out past the bottom of the screen while its toolbar shows, so a
 * bottom sheet can open out of sight there. Nothing here depends on hover.
 */
export function TabSheet({
  open,
  onOpenChange,
  tabs,
  activeId,
  current,
  onFocus,
  onClose,
  onCloseAll,
  onSignIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: SheetTab[];
  activeId: string | null;
  current: CurrentTab | null;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  onSignIn: () => void;
}) {
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="top"
        showCloseButton={false}
        className="max-h-[80svh] gap-0 overflow-y-auto overscroll-contain rounded-b-sheet pt-[env(safe-area-inset-top)] pb-2"
      >
        <SheetDescription className="sr-only">
          Switch between the open services, or act on the current one.
        </SheetDescription>
        <div className="flex h-11 items-end justify-between px-4 pb-1">
          <SheetTitle className={LABEL}>Open tabs</SheetTitle>
          <span className={cn(LABEL, 'tabular-nums')}>{tabs.length}</span>
        </div>
        {tabs.length === 0 ? (
          <p className="px-4 py-3 text-text-2">No open tabs</p>
        ) : (
          <ul className="px-1.5">
            {tabs.map(({ id, service, status }) => {
              const active = id === activeId;
              return (
                <li
                  key={id}
                  aria-current={active ? 'true' : undefined}
                  className={cn('flex items-center rounded-row', active && 'bg-selected')}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onFocus(id);
                      close();
                    }}
                    className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-row px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <ServiceIcon service={service} size={28} />
                    <span
                      data-slot="tab-name"
                      className={cn(
                        'min-w-0 flex-1 truncate text-[15px]',
                        active && 'font-semibold',
                      )}
                    >
                      {service.name}
                    </span>
                    <HealthMark status={status} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${service.name}`}
                    onClick={() => onClose(id)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-row text-text-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <X aria-hidden className="size-[18px]" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {(current !== null || tabs.length > 0) && (
          <div className="mx-1.5 mt-1 border-t border-hairline-raised px-0 pt-1">
            {current !== null && (
              <>
                <h3 className={cn(LABEL, 'flex h-9 items-end px-2 pb-1')}>{current.name}</h3>
                {current.url !== null && (
                  <a
                    href={current.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={ACTION}
                  >
                    <Action icon={<ExternalLink className="size-[18px]" />}>Open in browser</Action>
                  </a>
                )}
                {current.canSignIn && (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      onSignIn();
                    }}
                    className={ACTION}
                  >
                    <Action icon={<LogIn className="size-[18px]" />}>Sign in and retry</Action>
                  </button>
                )}
                {current.url !== null && (
                  <div className="flex flex-wrap">
                    <CopyField
                      value={current.url}
                      className="h-12 w-full justify-start gap-4 px-2 text-[15px] font-normal text-text hover:bg-transparent [&_svg]:size-[18px] [&_svg]:text-text-2"
                    />
                  </div>
                )}
              </>
            )}
            {tabs.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onCloseAll();
                  close();
                }}
                className={ACTION}
              >
                <Action icon={<X className="size-[18px]" />}>Close all tabs</Action>
              </button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
