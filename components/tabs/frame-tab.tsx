'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { isPublicAddress } from '@/lib/client/address';
import type { FrameModel } from './frame-model';
import { frameWatch } from './frame-watch';
import { clickStillActive, SignInPanel, type SignInStep } from './sign-in-panel';
import { SlowHint } from './slow-hint';
import { useSignIn } from './sign-in';

export const SLOW_LOAD_MS = 12_000;
const ALLOW = 'fullscreen; clipboard-write; picture-in-picture; autoplay';

function FrameSkeleton({ name }: { name: string }) {
  return (
    <div className="absolute inset-0 z-10 bg-raised p-3">
      <div aria-hidden className="flex gap-3">
        <Skeleton className="h-6 w-6" />
        <Skeleton className="h-6 flex-1" />
        <Skeleton className="h-6 w-32" />
      </div>
      <div aria-hidden className="mt-3 flex gap-3">
        <div className="flex w-40 flex-col gap-2 max-sm:hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-4" />
          ))}
        </div>
        <div className="grid flex-1 grid-cols-4 gap-3 max-sm:grid-cols-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
      <span
        role="status"
        className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-menu border border-hairline-strong bg-raised px-3 py-1.5 text-[12.5px] shadow-md"
      >
        <Loader2 aria-hidden className="size-3.5 animate-spin text-accent-mark" />
        Loading {name}…
      </span>
    </div>
  );
}

/**
 * One live tab: the iframe (never re-parented: it only gets `hidden`), a skeleton until `load`,
 * the slow-load hint after 12 s, and the sign-in panel when the app sends the frame to a sign-in
 * page Iris can't show. The parent keys it by service id and reload count, so a reload starts
 * everything, including the 12 s timer and the sign-in watch, again.
 */
export function FrameTab({
  model,
  active,
  loaded,
  onLoad,
  onSignedIn,
}: {
  model: FrameModel & { url: string };
  active: boolean;
  loaded: boolean;
  onLoad: () => void;
  onSignedIn: () => void;
}) {
  const { service, url } = model;
  const [slow, setSlow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [signInStep, setSignInStep] = useState<SignInStep | null>(null);
  const settle = useRef<() => void>(() => {});
  const signIn = useSignIn();
  const startSignIn = () => setSignInStep(signIn(url, onSignedIn) ? 'waiting' : 'blocked');
  const needsSignIn = signInStep !== null;

  // A layout effect runs in the same task that creates the iframe, before its navigation can
  // answer, so a violation it causes always finds it registered.
  useLayoutEffect(() => {
    const done = frameWatch().track(url, () => {
      // Straight to the sign-in window while the click that opened the tab still counts.
      if (clickStillActive()) setSignInStep(signIn(url, onSignedIn) ? 'waiting' : 'blocked');
      else setSignInStep('ask');
    });
    settle.current = done;
    return done;
    // Only a new address starts a new watch; the callbacks are read when it fires.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, [loaded]);

  return (
    <div hidden={!active} data-frame={service.id} className="absolute inset-0">
      <iframe
        src={url}
        title={`${service.name} (${service.group})`}
        allow={ALLOW}
        onLoad={() => {
          settle.current();
          onLoad();
        }}
        className="size-full border-0 bg-raised"
      />
      {!loaded && !needsSignIn && <FrameSkeleton name={service.name} />}
      {signInStep !== null && (
        <SignInPanel service={service} url={url} step={signInStep} onStart={startSignIn} />
      )}
      {!loaded && !needsSignIn && slow && !dismissed && (
        <SlowHint
          name={service.name}
          url={url}
          canSignIn={isPublicAddress(url)}
          onKeepWaiting={() => setDismissed(true)}
          onSignIn={() => signIn(url, onSignedIn)}
        />
      )}
    </div>
  );
}
