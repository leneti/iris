'use client';

import { useCallback, useEffect, useRef } from 'react';

const POLL_MS = 500;

/**
 * Opens `url` in a popup and calls `onClosed` once the popup is closed (polling `popup.closed`).
 * The popup is cut off from Iris with `opener = null`; `noopener` would hide `closed` too.
 * Returns a function that stops the polling, or null when the browser blocked the popup.
 */
export function startSignIn(url: string, onClosed: () => void): (() => void) | null {
  const popup = window.open(url, '_blank', 'popup,width=520,height=720');
  if (!popup) return null;
  try {
    popup.opener = null;
  } catch {
    // A browser that refuses the write still gets the popup.
  }
  const timer = setInterval(() => {
    if (popup.closed) {
      clearInterval(timer);
      onClosed();
    }
  }, POLL_MS);
  return () => clearInterval(timer);
}

/** `signIn(url, onClosed)`; one sign-in at a time, and none left running after unmount. */
export function useSignIn(): (url: string, onClosed: () => void) => void {
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  return useCallback((url, onClosed) => {
    stop.current?.();
    stop.current = startSignIn(url, onClosed);
  }, []);
}
