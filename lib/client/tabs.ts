import { z } from 'zod';

export const BUILTIN_OVERVIEW = 'builtin:overview';
export const BUILTIN_JOBS = 'builtin:jobs';
const BUILTINS: readonly string[] = [BUILTIN_OVERVIEW, BUILTIN_JOBS];
export const DEFAULT_MAX_LIVE = 8;
const STORAGE_KEY = 'iris.tabs';

/**
 * open: tab ids in strip order. active: the focused tab. lru: open ids, most recently used
 * first. live: ids that currently hold an iframe, most recently used first; every other open
 * service tab is suspended. Built-in views are never iframes, so they never take a live slot.
 */
export type TabsState = { open: string[]; active: string | null; lru: string[]; live: string[] };

export type TabsAction = {
  type: 'open' | 'focus' | 'close' | 'closeOthers' | 'closeAll' | 'setMaxLive';
  id?: string;
  /** Live-frame limit: 8 on desktop, `phone.maxLiveFrames` on phone. Default 8. */
  max?: number;
};

export const emptyTabs: TabsState = { open: [], active: null, lru: [], live: [] };

export const isBuiltin = (id: string) => BUILTINS.includes(id);

// Make `id` the active, most recently used tab, and live if it is a service tab.
function touch(state: TabsState, id: string, max: number): TabsState {
  const lru = [id, ...state.lru.filter((x) => x !== id)];
  const live = isBuiltin(id)
    ? state.live
    : [id, ...state.live.filter((x) => x !== id)].slice(0, max);
  return { ...state, active: id, lru, live };
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  const max = Math.max(1, action.max ?? DEFAULT_MAX_LIVE);
  const { id } = action;
  switch (action.type) {
    case 'open': {
      if (!id) return state;
      const open = state.open.includes(id) ? state.open : [...state.open, id];
      return touch({ ...state, open }, id, max);
    }
    case 'focus':
      return id && state.open.includes(id) ? touch(state, id, max) : state;
    case 'close': {
      // The Overview is pinned: closing it is a no-op.
      if (!id || id === BUILTIN_OVERVIEW || !state.open.includes(id)) return state;
      const next: TabsState = {
        open: state.open.filter((x) => x !== id),
        active: state.active,
        lru: state.lru.filter((x) => x !== id),
        live: state.live.filter((x) => x !== id),
      };
      if (state.active !== id) return next;
      const heir = next.lru[0];
      return heir === undefined ? emptyTabs : touch(next, heir, max);
    }
    case 'closeOthers': {
      const keep = id ?? state.active;
      if (!keep || !state.open.includes(keep)) return state;
      return touch(
        { open: [keep], active: keep, lru: [keep], live: state.live.filter((x) => x === keep) },
        keep,
        max,
      );
    }
    case 'closeAll':
      return emptyTabs;
    case 'setMaxLive':
      return { ...state, live: state.live.slice(0, max) };
  }
}

const Stored = z.object({
  v: z.literal(1),
  open: z.array(z.string()),
  active: z.string().nullable().optional(),
});

function readStored(storage: Storage | null): z.infer<typeof Stored> | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = Stored.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function hashTab(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('tab');
}

/**
 * Restore tabs from storage and the URL hash (`#tab=<id>`, which wins for the active tab).
 * Unreadable or outdated storage gives the defaults; ids not in `knownIds` (and not built in)
 * are dropped silently. Only the active service tab starts live, so a reload never opens
 * every frame at once. Call it once the service list is known, or every id looks unknown.
 */
export function loadTabs(storage: Storage | null, hash: string, knownIds: Set<string>): TabsState {
  const known = (id: string) => isBuiltin(id) || knownIds.has(id);
  const stored = readStored(storage);
  const open = [...new Set(stored?.open ?? [])].filter(known);

  const fromHash = hashTab(hash);
  let active: string | null = null;
  if (fromHash !== null && known(fromHash)) {
    active = fromHash;
    if (!open.includes(active)) open.push(active);
  } else if (stored?.active && open.includes(stored.active)) {
    active = stored.active;
  } else {
    active = open.at(-1) ?? null;
  }
  if (active === null) return { open: [], active: null, lru: [], live: [] };
  return {
    open,
    active,
    lru: [active, ...open.filter((x) => x !== active)],
    live: isBuiltin(active) ? [] : [active],
  };
}

export function saveTabs(storage: Storage | null, state: TabsState): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ v: 1, open: state.open, active: state.active }));
  } catch {
    // Storage unavailable or full: tabs are simply not remembered.
  }
}

/** The URL hash for the active tab; empty when none. */
export function tabHash(active: string | null): string {
  return active === null ? '' : `#tab=${encodeURIComponent(active)}`;
}
