'use client';

import { Circle } from '@/components/overview/circle';
import { Foot } from '@/components/overview/foot';
import { Hours } from '@/components/overview/hours';
import { Omens } from '@/components/overview/omens';
import { Stage } from '@/components/overview/stage';
import { SectionBoundary } from '@/components/section-boundary';

const NO_HOVER = () => {};

/**
 * The phone's Overview: one column of the same regions as the desktop, in the order the phone
 * reads them: the ball and the reading, the omens, the circle, the hours and the footer. Each
 * region fails on its own. A tap is not a hover, so the ball never rises for a chip.
 */
export function PhoneOverview({ onOpenService }: { onOpenService: (id: string) => void }) {
  return (
    <div data-slot="phone-overview" className="px-4 pb-6">
      <SectionBoundary name="stage">
        <Stage onOpenService={onOpenService} hover={false} touch variant="phone" />
      </SectionBoundary>
      <SectionBoundary name="omens">
        <Omens touch />
      </SectionBoundary>
      <SectionBoundary name="circle">
        <Circle onOpenService={onOpenService} onHover={NO_HOVER} touch />
      </SectionBoundary>
      <SectionBoundary name="hours">
        <Hours touch />
      </SectionBoundary>
      <SectionBoundary name="foot">
        <Foot touch />
      </SectionBoundary>
    </div>
  );
}
