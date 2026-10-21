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
  // On wide screens the two panels (620 + up to 1380 px) sit between equal empty margins. The
  // hero reaches 120 px into the left margin, so its haze is not cut at the panel's edge.
  return (
    <div className="h-full lg:grid lg:grid-cols-[minmax(0,1fr)_620px_minmax(0,1380px)_minmax(0,1fr)] lg:overflow-hidden">
      <div
        data-slot="overview-hero"
        className="px-4 pb-6 lg:col-start-2 lg:row-start-1 lg:-ml-[120px] lg:flex lg:min-h-0 lg:flex-col lg:justify-center lg:overflow-x-hidden lg:overflow-y-auto lg:border-r lg:border-line lg:pr-9 lg:pb-4 lg:pl-[164px]"
      >
        <SectionBoundary name="stage">
          <Stage onOpenService={onOpenService} hover={hover} />
        </SectionBoundary>
      </div>
      <div
        data-slot="overview-rest"
        className="@container px-4 lg:col-start-3 lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col lg:overflow-y-auto lg:px-6 xl:pr-11 xl:pl-10"
      >
        <SectionBoundary name="circle">
          <Circle onOpenService={onOpenService} onHover={setHover} />
        </SectionBoundary>
        <div data-slot="overview-two" className="grid gap-x-10 @min-[720px]:grid-cols-2">
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
