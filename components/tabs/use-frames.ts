'use client';

import { useCallback, useState } from 'react';

export type Frames = {
  /** Ids whose frame has fired `load`. */
  loaded: ReadonlySet<string>;
  /** Changes on reload; part of the frame's key, so a reload starts from the start URL. */
  nonce: (id: string) => number;
  markLoaded: (id: string) => void;
  reload: (id: string) => void;
};

/**
 * Load state for the live frames. A frame that leaves `live` (suspended or closed) forgets that
 * it loaded, so it shows its skeleton again when it comes back.
 */
export function useFrames(live: readonly string[]): Frames {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [nonces, setNonces] = useState<Readonly<Record<string, number>>>({});

  if ([...loaded].some((id) => !live.includes(id))) {
    setLoaded(new Set([...loaded].filter((id) => live.includes(id))));
  }

  const markLoaded = useCallback((id: string) => {
    setLoaded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const reload = useCallback((id: string) => {
    setLoaded((prev) => new Set([...prev].filter((x) => x !== id)));
    setNonces((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  }, []);
  const nonce = useCallback((id: string) => nonces[id] ?? 0, [nonces]);

  return { loaded, nonce, markLoaded, reload };
}
