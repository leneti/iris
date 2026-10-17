'use client';

import { ExternalLink, Loader2, LogIn } from 'lucide-react';
import { ServiceIcon } from '@/components/service-icon';
import { Button } from '@/components/ui/button';
import type { ServiceEntry } from '@/lib/shared/contract';

export type SignInStep = 'ask' | 'waiting' | 'blocked';

/** Whether the click that opened the tab still counts, so a popup would not be blocked. */
export function clickStillActive(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  return activation?.isActive === true;
}

/**
 * Covers a frame whose app sent it to a sign-in page Iris can't show. Signing in happens in a
 * small window; Iris closes it once the app answers and reloads the tab.
 */
export function SignInPanel({
  service,
  url,
  step,
  onStart,
}: {
  service: ServiceEntry;
  url: string;
  step: SignInStep;
  onStart: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-auto bg-page p-4">
      <article
        role="status"
        className="w-full max-w-[520px] rounded-panel border border-hairline-raised bg-raised p-6 max-sm:p-4"
      >
        <header className="flex items-center gap-4">
          <ServiceIcon service={service} size={44} />
          <h2 className="min-w-0 text-lg leading-tight font-semibold tracking-[-0.015em]">
            {step === 'waiting'
              ? `Signing in to ${service.name}…`
              : `${service.name} needs you to sign in`}
          </h2>
        </header>
        <p className="mt-4 text-text-2">
          {step === 'waiting'
            ? `Finish signing in in the window that opened. Iris closes it and shows ${service.name} here when you’re done.`
            : step === 'blocked'
              ? `Your browser blocked the sign-in window. Allow pop-ups for this site and try again, or open ${service.name} in a new tab.`
              : `${service.name} sent this tab to a sign-in page, which can’t be shown inside Iris. Sign in once in a small window and Iris brings you back here.`}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
          {step === 'waiting' ? (
            <span className="flex items-center gap-2 text-text-2">
              <Loader2 aria-hidden className="size-4 animate-spin text-accent-mark" />
              Waiting for the sign-in window
            </span>
          ) : (
            <Button type="button" onClick={onStart}>
              <LogIn />
              {step === 'blocked' ? 'Try again' : 'Sign in'}
            </Button>
          )}
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              Open in new tab
            </a>
          </Button>
        </div>
      </article>
    </div>
  );
}
