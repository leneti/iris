'use client';

import { Ban, ExternalLink, LogIn } from 'lucide-react';
import { useId } from 'react';
import { Address } from '@/components/shell/status-strip';
import { ServiceIcon } from '@/components/service-icon';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { isPublicAddress } from '@/lib/client/address';
import { formatAge } from '@/lib/client/format';
import { useNow } from '@/lib/client/use-client';
import type { ServiceStatus } from '@/lib/shared/contract';
import { CopyField } from './copy-field';
import type { CardKind, FrameModel } from './frame-model';
import { useSignIn } from './sign-in';

const REFUSES = 'tells browsers not to display it inside another site, so it can’t open as a tab.';

const DETECTED: Record<CardKind, string> = {
  'x-frame-options': 'X-Frame-Options',
  'csp-frame-ancestors': 'Content-Security-Policy: frame-ancestors',
  'mixed-content': 'Mixed content: an http:// address on an https:// page',
  label: 'iris.embed=false',
  'no-url': 'No address',
  'probe-failed': 'The check could not read the response headers',
  'home-only': 'No public address',
  device: 'Device setting: always open in a new tab',
};

function body(kind: CardKind, name: string, healthy: boolean): string {
  switch (kind) {
    case 'x-frame-options':
    case 'csp-frame-ancestors':
      return `This service ${REFUSES} ${
        healthy
          ? 'It is running normally and opens fine on its own.'
          : 'Open it on its own instead.'
      }`;
    case 'mixed-content':
      return `Iris is open over HTTPS and ${name} only answers over plain HTTP, which a browser will not show inside an HTTPS page. Open it in its own tab instead.`;
    case 'label':
      return `The configuration says ${name} should open in its own tab, not inside Iris.`;
    case 'no-url':
      return `${name} has no web address, so there is nothing to open.`;
    case 'probe-failed':
      return `The check of ${name} could not finish, so Iris cannot tell whether it allows framing. Open it on its own instead.`;
    case 'home-only':
      return 'Home network only: this service has no public address. Open Iris from the home network to use it.';
    case 'device':
      return `You chose to open ${name} in a new tab on this device.`;
  }
}

function title(kind: CardKind, name: string): string {
  if (kind === 'home-only') return `${name} is on the home network only`;
  if (kind === 'device') return `${name} opens in a new tab`;
  if (kind === 'no-url') return `${name} has no address`;
  return `${name} can’t be shown here`;
}

const LABEL: Record<ServiceStatus, string> = {
  healthy: 'Healthy',
  starting: 'Starting',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  stopped: 'Stopped',
  unknown: 'Unknown',
};

/**
 * Shown instead of an iframe (handoff 7.3, mockups/02). 588 px wide, 24 px padding. On a phone it
 * is full width with its buttons stacked (handoff 7.7).
 */
export function FallbackCard({
  model,
  status,
  alwaysNewTab,
  onAlwaysNewTab,
  onCheckAgain,
  onSignedIn,
}: {
  model: FrameModel;
  status: ServiceStatus;
  alwaysNewTab: boolean;
  onAlwaysNewTab: (on: boolean) => void;
  onCheckAgain: () => void;
  onSignedIn: () => void;
}) {
  const { service, url, embed, card } = model;
  const now = useNow();
  const switchId = useId();
  const signIn = useSignIn();
  const checkedAt = embed.checkedAt ? Date.parse(embed.checkedAt) : Number.NaN;
  const checked = Number.isNaN(checkedAt)
    ? 'Not checked yet'
    : `Checked ${formatAge(Math.max(0, (now - checkedAt) / 1000))}`;

  if (card === null) return null;

  return (
    <article className="w-full max-w-[588px] rounded-panel border border-hairline-raised bg-raised p-6 max-sm:p-4">
      <header className="flex items-center gap-4">
        <span className="relative flex shrink-0">
          <ServiceIcon service={service} size={44} />
          <span
            aria-hidden
            className="absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full bg-status-unhealthy text-status-on-solid"
          >
            <Ban className="size-3" />
          </span>
        </span>
        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-semibold tracking-[-0.015em]">
            {title(card, service.name)}
          </h2>
          <p className="text-text-2">
            {service.group} · {LABEL[status]}
          </p>
        </div>
      </header>
      <p className="mt-4 text-text-2">{body(card, service.name, status === 'healthy')}</p>
      <dl className="mt-4 flex gap-4 rounded-row bg-hover-raised px-4 py-3 text-xs">
        <dt className="shrink-0 text-text-3">Detected</dt>
        <dd className="min-w-0 font-mono break-words">{DETECTED[card]}</dd>
      </dl>
      {url !== null && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
            <Button asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Open in new tab
              </a>
            </Button>
            {isPublicAddress(url) && (
              <Button type="button" variant="outline" onClick={() => signIn(url, onSignedIn)}>
                <LogIn />
                Sign in and retry
              </Button>
            )}
            <CopyField value={url} />
          </div>
          <div className="mt-4 border-t border-hairline-raised pt-4">
            {/* The whole line is the target, so a thumb finds it on a phone. */}
            <label htmlFor={switchId} className="flex items-center gap-2 max-sm:min-h-11">
              <Switch id={switchId} checked={alwaysNewTab} onCheckedChange={onAlwaysNewTab} />
              Always open {service.name} in a new tab on this device
            </label>
          </div>
        </>
      )}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 text-xs text-text-3">
        {url !== null ? <Address url={url} /> : <span>No public address</span>}
        <span className="flex shrink-0 items-baseline gap-2">
          {checked}
          <button
            type="button"
            onClick={onCheckAgain}
            className="rounded-row text-accent-text underline outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11 max-sm:px-2"
          >
            Check again
          </button>
        </span>
      </div>
    </article>
  );
}
