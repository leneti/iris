'use client';

import { useState } from 'react';
import { SectionBoundary } from '@/components/section-boundary';
import { Circle } from './circle';
import { Foot } from './foot';
import { Hours } from './hours';
import { Omens } from './omens';
import { Stage } from './stage';

export { focusRegion } from './focus-region';

/**
 * The built-in Overview, and what the canvas shows when no tab is open. Everything it draws comes
 * from the shell's Reading; each region fails on its own.
 */
export function Overview({ onOpenService }: { onOpenService: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="h-full lg:grid lg:grid-cols-[620px_minmax(0,1fr)] lg:overflow-hidden">
      <div
        data-slot="overview-hero"
        className="px-4 pb-6 lg:flex lg:min-h-0 lg:flex-col lg:justify-center lg:overflow-x-hidden lg:overflow-y-auto lg:border-r lg:border-line lg:pr-9 lg:pb-4 lg:pl-11"
      >
        <SectionBoundary name="stage">
          <Stage onOpenService={onOpenService} hover={hover} />
        </SectionBoundary>
      </div>
      <div
        data-slot="overview-rest"
        className="px-4 lg:flex lg:min-h-0 lg:flex-col lg:overflow-y-auto lg:pr-11 lg:pl-10"
      >
        <SectionBoundary name="circle">
          <Circle onOpenService={onOpenService} onHover={setHover} />
        </SectionBoundary>
        <div data-slot="overview-two" className="grid gap-x-10 md:grid-cols-2">
          <SectionBoundary name="hours">
            <Hours />
          </SectionBoundary>
          <SectionBoundary name="omens">
            <Omens />
          </SectionBoundary>
        </div>
        <SectionBoundary name="foot">
          <Foot />
        </SectionBoundary>
      </div>
    </div>
  );
}
