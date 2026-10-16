import { prefs } from './prefs';

/** Per-device record of services that always open in a browser tab: `{ [serviceId]: true }`. */
export const NEW_TAB_PREF = 'tabs.alwaysNewTab';

export function setAlwaysNewTab(id: string, on: boolean): void {
  const current = prefs.get<Record<string, boolean>>(NEW_TAB_PREF, {});
  const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== id));
  prefs.set(NEW_TAB_PREF, on ? { ...rest, [id]: true } : rest);
}

/** Opens an address in a browser tab that cannot reach back into Iris. */
export function openInBrowserTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
