'use client';

import { lazy, Suspense, useState } from 'react';
import type { BallState } from '@/lib/client/reading';
import { useHydrated } from '@/lib/client/use-client';
import { StaticBall } from './static-ball';
import { hasWebGL2 } from './webgl';

export type BallProps = BallState & { hoverStrength: number; variant: 'desktop' | 'phone' };

// Its own chunk. Only ever rendered after hydration, so it never runs on the server.
const CrystalBall = lazy(() => import('./crystal-ball'));

/** The crystal ball, or its static stand-in when WebGL2 is missing, still loading or lost. */
export function Ball(props: BallProps) {
  const hydrated = useHydrated();
  const [lost, setLost] = useState(false);

  const fallback = <StaticBall color={props.color} />;
  if (!hydrated || lost || !hasWebGL2()) return fallback;
  return (
    <Suspense fallback={fallback}>
      <CrystalBall {...props} onContextLost={() => setLost(true)} />
    </Suspense>
  );
}
