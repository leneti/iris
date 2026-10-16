'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useCron, useServices, useStatus } from '@/lib/client/api';
import type { AddressMode } from '@/lib/client/address';
import { isDiscoveryReady } from '@/lib/client/services';
import {
  BUILTIN_JOBS,
  BUILTIN_OVERVIEW,
  DEFAULT_MAX_LIVE,
  emptyTabs,
  isBuiltin,
  loadTabs,
  saveTabs,
  tabHash,
  tabsReducer,
  type TabsAction,
  type TabsState,
} from '@/lib/client/tabs';
import type { ServiceStatus, ServicesResponse } from '@/lib/shared/contract';

type ShellAction = TabsAction | { type: 'replace'; state: TabsState };
type ShellState = { tabs: TabsState; hydrated: boolean };

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** `pending` is the time before the first status poll has answered. */
export type DockerState = { state: 'ok' | 'unreachable' | 'pending'; ageSeconds: number | null };

export type Shell = {
  mode: AddressMode;
  tabs: TabsState;
  dispatch: (action: TabsAction) => void;
  services: ServicesResponse | undefined;
  statusById: Record<string, ServiceStatus>;
  openService: (id: string) => void;
  openBuiltin: (id: typeof BUILTIN_OVERVIEW | typeof BUILTIN_JOBS) => void;
  /** Re-fetches /api/services ("Check again"). No endpoint mutates anything. */
  recheck: () => void;
  status: ReturnType<typeof useStatus>['data'];
  cron: ReturnType<typeof useCron>['data'];
  docker: DockerState;
};

/**
 * Owns the open tabs. The live-frame cap goes in once, through the reducer wrapper. Stored tabs
 * are loaded on the first complete services response (see `isDiscoveryReady`) and never saved
 * before it, so a slow first poll, a restarting server or an unreadable Docker cannot wipe them.
 */
export function useShell(mode: AddressMode, maxLive: number = DEFAULT_MAX_LIVE): Shell {
  const reducer = useCallback(
    (state: ShellState, action: ShellAction): ShellState =>
      action.type === 'replace'
        ? { tabs: action.state, hydrated: true }
        : { ...state, tabs: tabsReducer(state.tabs, { ...action, max: maxLive }) },
    [maxLive],
  );
  const [{ tabs, hydrated }, dispatch] = useReducer(reducer, { tabs: emptyTabs, hydrated: false });
  const { data: latest, mutate: mutateServices } = useServices();
  const { data: status } = useStatus();
  const { data: cron } = useCron();

  // Only a complete answer replaces the list: a server that is starting, or that cannot read
  // Docker, answers with a near-empty one. Until the first complete answer, show what came.
  const [ready, setReady] = useState<ServicesResponse | undefined>(undefined);
  if (latest && isDiscoveryReady(latest) && latest !== ready) setReady(latest);
  const services = ready ?? latest;

  const knownIds = useMemo(
    () => new Set(ready?.groups.flatMap((g) => g.services.map((s) => s.id)) ?? []),
    [ready],
  );

  // A lower cap (a phone) suspends the least recently used frames at once.
  useEffect(() => {
    dispatch({ type: 'setMaxLive' });
  }, [maxLive]);

  // First complete services response: restore tabs. `hydrated` flips in the same render.
  useEffect(() => {
    if (hydrated || !ready) return;
    dispatch({ type: 'replace', state: loadTabs(storage(), window.location.hash, knownIds) });
  }, [hydrated, ready, knownIds]);

  // A service that left the list closes its tab.
  useEffect(() => {
    if (!hydrated) return;
    for (const id of tabs.open) {
      if (!isBuiltin(id) && !knownIds.has(id)) dispatch({ type: 'close', id });
    }
  }, [hydrated, tabs.open, knownIds]);

  useEffect(() => {
    if (!hydrated) return;
    saveTabs(storage(), tabs);
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}${tabHash(tabs.active)}`);
  }, [hydrated, tabs]);

  const statusById = useMemo(() => {
    const out: Record<string, ServiceStatus> = {};
    for (const [id, entry] of Object.entries(status?.services ?? {})) out[id] = entry.status;
    return out;
  }, [status]);

  // The contract carries no "last good data" time, so the age is measured between server
  // timestamps: the last poll that saw Docker ok, and the newest poll that did not. It is null
  // when this page has only ever seen Docker unreachable.
  const [lastOk, setLastOk] = useState<string | null>(null);
  if (status?.docker === 'ok' && status.generatedAt !== lastOk) setLastOk(status.generatedAt);
  const docker: DockerState =
    status?.docker === 'unreachable'
      ? {
          state: 'unreachable',
          ageSeconds:
            lastOk === null
              ? null
              : Math.max(
                  0,
                  Math.round((Date.parse(status.generatedAt) - Date.parse(lastOk)) / 1000),
                ),
        }
      : { state: status ? 'ok' : 'pending', ageSeconds: null };

  const recheck = useCallback(() => {
    void mutateServices();
  }, [mutateServices]);
  const open = useCallback((id: string) => dispatch({ type: 'open', id }), []);

  return {
    mode,
    tabs,
    dispatch,
    services,
    statusById,
    openService: open,
    openBuiltin: open,
    recheck,
    status,
    cron,
    docker,
  };
}
