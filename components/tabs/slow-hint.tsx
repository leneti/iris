'use client';

import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Floats over the bottom of a frame that has not fired `load` after 12 s (mockups/03). */
export function SlowHint({
  name,
  url,
  canSignIn,
  onKeepWaiting,
  onSignIn,
}: {
  name: string;
  url: string | null;
  canSignIn: boolean;
  onKeepWaiting: () => void;
  onSignIn: () => void;
}) {
  return (
    <div
      role="status"
      className="absolute inset-x-3 bottom-3 z-20 grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-2 rounded-menu border border-hairline-strong bg-raised px-3 py-2.5 text-[12.5px] shadow-md"
    >
      <TriangleAlert aria-hidden className="size-4 text-status-degraded" />
      <p>
        {name} is taking longer than usual.
        {canSignIn ? ' It may need you to sign in.' : ''}
      </p>
      <div className="col-span-2 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onKeepWaiting}>
          Keep waiting
        </Button>
        {canSignIn && (
          <Button type="button" variant="outline" size="sm" onClick={onSignIn}>
            Sign in and retry
          </Button>
        )}
        {url !== null && (
          <Button asChild size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open in new tab
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
