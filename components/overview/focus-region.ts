export type Anchor = 'circle' | 'hours' | 'host' | 'sky';

/** Scrolls an Overview region into view and focuses it. Never touches `location.hash`. */
export function focusRegion(anchor: Anchor): void {
  const el = document.getElementById(`ov-${anchor}`);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest' });
  el.focus({ preventScroll: true });
}

/** What every anchored region needs so `focusRegion` can land on it. */
export const REGION =
  'scroll-mt-16 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pink-soft';
