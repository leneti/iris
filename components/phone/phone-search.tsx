'use client';

import { Palette, type PaletteProps } from '@/components/palette/palette';

/**
 * Search as a full view: the same palette, rendered in the page instead of a dialog. It has no
 * sidebar action and no key hints, and its field uses a 16 px font so iOS does not zoom.
 */
export function PhoneSearch(props: Omit<PaletteProps, 'mode' | 'open' | 'onOpenChange'>) {
  return (
    <div className="min-h-[calc(100svh-3.5rem)] bg-raised">
      <Palette {...props} mode="page" open onOpenChange={() => {}} />
    </div>
  );
}
