'use client';

import { lazy, Suspense, useState } from 'react';
import type { BallState } from '@/lib/client/reading';
import { useHydrated } from '@/lib/client/use-client';
import { cn } from '@/lib/utils';
import type { BallVariant } from './size';
import { StaticBall } from './static-ball';
import { hasWebGL2 } from './webgl';

export type BallProps = BallState & { hoverStrength: number; variant: BallVariant };

// Its own chunk. Only ever rendered after hydration, so it never runs on the server.
const CrystalBall = lazy(() => import('./crystal-ball'));

/**
 * The crystal ball over its static stand-in. The static ball is the server's, the pre-hydration
 * and the lazy-loading picture; once the canvas has drawn its first frame it fades in over it
 * (300 ms, none with reduced motion) while the static ball fades out under the intro. The box
 * never changes size. Without WebGL2, or after a lost context, only the static ball remains.
 */
export function Ball(props: BallProps) {
  const hydrated = useHydrated();
  const [lost, setLost] = useState(false);
  const [framed, setFramed] = useState(false);

  const live = hydrated && !lost && hasWebGL2();
  const shown = live && framed;
  return (
    <div className="relative size-full">
      <StaticBall
        color={props.color}
        variant={props.variant}
        className={cn(
          'absolute inset-0 transition-opacity duration-[900ms] delay-300 motion-reduce:transition-none motion-reduce:delay-0',
          shown && 'opacity-0',
        )}
      />
      {live && (
        <div
          data-slot="ball-canvas"
          data-framed={framed}
          className={cn(
            'absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none',
            framed ? 'opacity-100' : 'opacity-0',
          )}
        >
          <Suspense fallback={null}>
            <CrystalBall
              {...props}
              onContextLost={() => setLost(true)}
              onFirstFrame={() => setFramed(true)}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
