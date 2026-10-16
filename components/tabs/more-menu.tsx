'use client';

import { Ellipsis } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CopyField } from './copy-field';

/** The "more" menu: sign in and retry (public addresses only), copy link, close tab. */
export function MoreMenu({
  name,
  url,
  canSignIn,
  onSignIn,
  onCloseTab,
}: {
  name: string;
  url: string | null;
  canSignIn: boolean;
  onSignIn: () => void;
  onCloseTab: () => void;
}) {
  const [copying, setCopying] = useState(false);
  // Set synchronously: the menu's close handler runs before React re-renders.
  const fieldWrap = useRef<HTMLDivElement | null>(null);
  const copyRequested = useRef(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More"
          className="flex size-7 shrink-0 items-center justify-center rounded-row text-text-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={42}
          className="w-56"
          // Closing the menu would otherwise return focus to the trigger and unselect the link.
          onCloseAutoFocus={(e) => {
            if (copyRequested.current) e.preventDefault();
            copyRequested.current = false;
          }}
        >
          {canSignIn && <DropdownMenuItem onSelect={onSignIn}>Sign in and retry</DropdownMenuItem>}
          {url !== null && (
            <DropdownMenuItem
              onSelect={() => {
                copyRequested.current = true;
                setCopying(true);
              }}
            >
              Copy link
            </DropdownMenuItem>
          )}
          {(canSignIn || url !== null) && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={onCloseTab}>Close tab</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {url !== null && (
        <Dialog open={copying} onOpenChange={setCopying}>
          <DialogContent
            className="sm:max-w-[480px]"
            onOpenAutoFocus={(e) => {
              // Focus the link rather than the first control, so Ctrl+C copies it at once.
              e.preventDefault();
              const field = fieldWrap.current?.querySelector('input');
              field?.focus();
              field?.select();
            }}
          >
            <DialogHeader>
              <DialogTitle>Link to {name}</DialogTitle>
              <DialogDescription>
                Browsers do not allow copying from a plain HTTP page, so the link is selected for
                you.
              </DialogDescription>
            </DialogHeader>
            <div ref={fieldWrap} className="flex flex-wrap">
              <CopyField value={url} defaultShown />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
