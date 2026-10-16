// Palette shortcuts (handoff 7.6, criterion 4.1).
import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};
const clientKey = (): '⌘' | 'Ctrl' =>
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

/**
 * The modifier key's label: ⌘ on Apple platforms, Ctrl elsewhere. The server snapshot is ⌘, so the
 * server render and the first client render agree; React then switches to the real value.
 */
export function useModKey(): '⌘' | 'Ctrl' {
  return useSyncExternalStore(noSubscription, clientKey, () => '⌘');
}

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // jsdom has no isContentEditable, so read the attribute: "", "true" and "plaintext-only" edit.
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/** ⌘K and Ctrl+K always open. "/" opens only when focus is not in a text-entry element. */
export function shouldOpenPalette(e: KeyboardEvent, active: Element | null): boolean {
  if (e.isComposing) return false;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') return true;
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) return !isTextEntry(active);
  return false;
}
