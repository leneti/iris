'use client';

import { ExternalLink, Maximize, RotateCw } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useHydrated } from '@/lib/client/use-client';

const BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-row text-text-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

function Control({
  label,
  Icon,
  onClick,
  disabled,
}: {
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={BUTTON}
    >
      <Icon className="size-4" />
    </button>
  );
}

/**
 * Reload, pop-out and fullscreen for the active service tab. Fullscreen is hidden where the
 * Fullscreen API is off, which includes iPhone; the check waits for hydration so the server
 * and first client render agree.
 */
export function TabControls({
  hasUrl,
  onReload,
  onPopOut,
  onFullscreen,
}: {
  hasUrl: boolean;
  onReload: () => void;
  onPopOut: () => void;
  onFullscreen: () => void;
}) {
  const hydrated = useHydrated();
  const canFullscreen = hydrated && document.fullscreenEnabled === true;
  return (
    <div className="flex items-center gap-0.5">
      <Control label="Reload" Icon={RotateCw} onClick={onReload} disabled={!hasUrl} />
      <Control
        label="Open in new browser tab"
        Icon={ExternalLink}
        onClick={onPopOut}
        disabled={!hasUrl}
      />
      {canFullscreen && <Control label="Full screen" Icon={Maximize} onClick={onFullscreen} />}
    </div>
  );
}
