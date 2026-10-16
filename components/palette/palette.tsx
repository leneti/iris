'use client';

import { Clock, Moon, PanelLeft, PanelLeftOpen, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { HealthMark } from '@/components/health-mark';
import { ServiceIcon } from '@/components/shell/sidebar-row';
import { builtinName } from '@/components/tabs/tab-item';
import { frameModel } from '@/components/tabs/frame-model';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { openInBrowserTab } from '@/lib/client/new-tab';
import { BUILTIN_JOBS, BUILTIN_OVERVIEW, isBuiltin } from '@/lib/client/tabs';
import type { AddressMode } from '@/lib/client/address';
import type { GroupEntry, LinkEntry, ServiceStatus } from '@/lib/shared/contract';
import { PaletteList, type PaletteEntry } from './palette-list';

type Builtin = typeof BUILTIN_OVERVIEW | typeof BUILTIN_JOBS;

export type PaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "dialog" over the page, or "page" for the phone's Search view. */
  mode: 'dialog' | 'page';
  groups: GroupEntry[];
  links: LinkEntry[];
  statusById: Record<string, ServiceStatus>;
  openIds: string[];
  /** The address mode and page origin, to decide which services can open as a tab. */
  address: { mode: AddressMode; hostname: string; protocol: string };
  /** Opens or focuses a service tab (the caller applies the "always open in a new tab" choice). */
  onOpenService: (id: string) => void;
  onFocusTab: (id: string) => void;
  onOpenBuiltin: (id: Builtin) => void;
  jobsFailed: number;
  /** The sidebar actions are left out when there is no sidebar (the phone). */
  sidebarCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Page mode: a Cancel button beside the field. */
  onCancel?: () => void;
};

const STATUS_WORD: Record<ServiceStatus, string | null> = {
  healthy: null,
  starting: 'Starting',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  stopped: 'Stopped',
  unknown: 'Unknown',
};

function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function openInNewWindow(url: string | null): void {
  if (url !== null) window.open(url, '_blank', 'noopener,noreferrer,popup');
}

function ActionIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="flex size-[22px] shrink-0 items-center justify-center rounded-tile border border-hairline-strong text-text-2"
    >
      <Icon className="size-[13px]" />
    </span>
  );
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex h-5 items-center rounded-row border border-hairline-strong px-1.5 text-[11px] font-medium text-text-2">
    {children}
  </span>
);

export function Palette(props: PaletteProps) {
  const { groups, links, statusById, openIds, address, onOpenService, onOpenBuiltin } = props;
  const { theme, resolvedTheme, setTheme } = useTheme();
  const dark = (resolvedTheme ?? theme) === 'dark';

  const serviceById = new Map(groups.flatMap((g) => g.services.map((s) => [s.id, s] as const)));
  const urlOf = (id: string) => {
    const s = serviceById.get(id);
    return s ? frameModel(s, { ...address, alwaysNewTab: false }).url : null;
  };

  const iconSize = props.mode === 'page' ? 28 : 20;
  const entries: PaletteEntry[] = [];
  for (const g of groups) {
    for (const s of g.services) {
      const status = statusById[s.id] ?? 'unknown';
      const word = STATUS_WORD[status];
      const model = frameModel(s, { ...address, alwaysNewTab: false });
      entries.push({
        value: `service:${s.id}`,
        section: 'Services',
        label: s.name,
        note: g.name,
        keywords: [g.name, s.description ?? '', ...s.keywords, hostOf(s.url) ?? ''],
        icon: <ServiceIcon service={s} size={iconSize} />,
        meta: (
          <>
            {openIds.includes(s.id) && <Chip>Open tab</Chip>}
            {word && <span>{word}</span>}
            <HealthMark status={status} />
          </>
        ),
        onSelect: (newWindow) => {
          if (newWindow) openInNewWindow(model.url);
          // A service that cannot be framed opens in a browser tab, never a card-only tab.
          else if (model.card !== null && model.url !== null) openInBrowserTab(model.url);
          else onOpenService(s.id);
        },
      });
    }
  }
  links.forEach((l, i) => {
    const host = hostOf(l.url);
    entries.push({
      value: `link:${i}`,
      section: 'Links',
      label: l.name,
      note: host ?? undefined,
      keywords: [host ?? ''],
      icon: (
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-tile bg-selected-raised text-[10px] font-semibold text-text-2"
        >
          {l.abbr}
        </span>
      ),
      meta: <Chip>Browser</Chip>,
      onSelect: (newWindow) => (newWindow ? openInNewWindow(l.url) : openInBrowserTab(l.url)),
    });
  });
  openIds.forEach((id, i) => {
    const s = serviceById.get(id);
    const name = isBuiltin(id) ? builtinName(id) : s?.name;
    if (name === undefined) return;
    entries.push({
      value: `tab:${id}`,
      section: 'Open tabs',
      label: name,
      note: `Tab ${i + 1}`,
      keywords: s ? [s.group, ...s.keywords] : [],
      icon: s ? (
        <ServiceIcon service={s} size={iconSize} />
      ) : (
        <ActionIcon Icon={id === BUILTIN_JOBS ? Clock : PanelLeft} />
      ),
      onSelect: (newWindow) => (newWindow ? openInNewWindow(urlOf(id)) : props.onFocusTab(id)),
    });
  });
  entries.push(
    {
      value: 'action:jobs',
      section: 'Actions',
      label: 'Show scheduled jobs',
      keywords: ['cron', 'tasks'],
      icon: <ActionIcon Icon={Clock} />,
      meta: props.jobsFailed > 0 ? <Chip>{props.jobsFailed} failed</Chip> : undefined,
      onSelect: () => onOpenBuiltin(BUILTIN_JOBS),
    },
    {
      value: 'action:theme',
      section: 'Actions',
      label: dark ? 'Switch to light theme' : 'Switch to dark theme',
      keywords: ['appearance', 'mode'],
      icon: <ActionIcon Icon={dark ? Sun : Moon} />,
      onSelect: () => setTheme(dark ? 'light' : 'dark'),
    },
  );
  const { onToggleCollapsed } = props;
  if (onToggleCollapsed !== undefined) {
    entries.push({
      value: 'action:sidebar',
      section: 'Actions',
      label: props.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
      keywords: ['navigation'],
      icon: <ActionIcon Icon={props.sidebarCollapsed ? PanelLeftOpen : PanelLeft} />,
      onSelect: onToggleCollapsed,
    });
  }

  const done = () => {
    if (props.mode === 'dialog') props.onOpenChange(false);
  };

  if (props.mode === 'page')
    return <PaletteList entries={entries} page onDone={done} onCancel={props.onCancel} />;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-32 w-[640px] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Find a service, link, open tab or action. Enter opens it.
        </DialogDescription>
        <PaletteList entries={entries} page={false} onDone={done} />
      </DialogContent>
    </Dialog>
  );
}
