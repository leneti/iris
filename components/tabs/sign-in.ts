'use client';

import { useCallback, useEffect, useRef } from 'react';
import { frameWatch } from './frame-watch';

const POLL_MS = 500;
const CHECK_MS = 2_000;

/** Whether `url` can be framed now; by default the frame watcher probes it. */
export type SignedInCheck = () => Promise<boolean>;

function defaultCheck(url: string): SignedInCheck {
  return () =>
    frameWatch()
      .check(url)
      .then((r) => r === 'ok');
}

/**
 * Opens `url` in a popup and calls `onClosed` once the popup is closed (polling `popup.closed`).
 * While it is open, `check` runs every 2 s; once it passes, Iris closes the popup itself, so a
 * finished sign-in needs no extra click. The popup keeps its `opener`: Chromium lets a page close
 * a popup only while the popup still has it, and `noopener` would hide `closed` too. The pages
 * that see it are the app's own and its sign-in page, which a frame in Iris shows anyway.
 * Returns a function that stops the polling, or null when the browser blocked the popup.
 */
export function startSignIn(
  url: string,
  onClosed: () => void,
  check: SignedInCheck | undefined = defaultCheck(url),
): (() => void) | null {
  const popup = window.open(url, '_blank', 'popup,width=520,height=720');
  if (!popup) return null;
  let checking = false;
  let lastCheck = Date.now();
  const timer = setInterval(() => {
    if (popup.closed) {
      clearInterval(timer);
      onClosed();
      return;
    }
    if (!check || checking || Date.now() - lastCheck < CHECK_MS) return;
    checking = true;
    void check()
      .then((ok) => {
        if (ok && !popup.closed) popup.close();
      })
      .catch(() => {})
      .finally(() => {
        checking = false;
        lastCheck = Date.now();
      });
  }, POLL_MS);
  return () => clearInterval(timer);
}

/**
 * `signIn(url, onClosed)`; one sign-in at a time, and none left running after unmount. Returns
 * false when the browser blocked the popup.
 */
export function useSignIn(): (url: string, onClosed: () => void) => boolean {
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  return useCallback((url, onClosed) => {
    stop.current?.();
    stop.current = startSignIn(url, onClosed);
    return stop.current !== null;
  }, []);
}
