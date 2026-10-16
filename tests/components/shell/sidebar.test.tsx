import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Sidebar, type SidebarProps } from '@/components/shell/sidebar';
import { TabBar } from '@/components/shell/tab-bar';
import { SidebarRail } from '@/components/shell/sidebar-rail';
import { prefs } from '@/lib/client/prefs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { group, svc } from './fixtures';

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;

const groups = [
  group('Media', [svc('stream', 'Streamhouse'), svc('watch', 'Watchlog')]),
  group('Downloads', [svc('torrent', 'Torrent Client')]),
];

function props(over: Partial<SidebarProps> = {}): SidebarProps {
  return {
    groups,
    statusById: { stream: 'healthy', watch: 'stopped', torrent: 'degraded' },
    openIds: [],
    activeId: null,
    onOpenService: vi.fn(),
    onOpenBuiltin: vi.fn(),
    onSearch: vi.fn(),
    onToggleCollapsed: vi.fn(),
    jobs: { failed: 0, overdue: 0 },
    docker: { state: 'ok', ageSeconds: null, count: 3 },
    ...over,
  };
}

const wrap = (ui: React.ReactElement) => <TooltipProvider>{ui}</TooltipProvider>;

beforeEach(() => localStorage.clear());

describe('Sidebar', () => {
  test('collapsing a group persists through prefs', () => {
    render(wrap(<Sidebar {...props()} />));
    expect(screen.getByText('Streamhouse')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Media/ }));
    expect(screen.queryByText('Streamhouse')).toBeNull();
    expect(prefs.get<string[]>('sidebar.collapsedGroups', [])).toEqual(['Media']);
  });

  test('a group collapsed on an earlier visit starts collapsed', () => {
    prefs.set('sidebar.collapsedGroups', ['Downloads']);
    render(wrap(<Sidebar {...props()} />));
    expect(screen.queryByText('Torrent Client')).toBeNull();
    expect(screen.getByText('Streamhouse')).toBeTruthy();
  });

  test('a stopped service row is muted and a healthy one is not', () => {
    render(wrap(<Sidebar {...props()} />));
    expect(screen.getByRole('button', { name: /Watchlog/ }).getAttribute('data-muted')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /Streamhouse/ }).getAttribute('data-muted')).toBe(
      'false',
    );
  });

  test('a group header shows the worst status of its services', () => {
    render(wrap(<Sidebar {...props()} />));
    const header = screen.getByRole('button', { name: /Media/ });
    expect(within(header).getByRole('img').getAttribute('aria-label')).toBe('stopped');
  });

  test('the jobs badge counts failed plus overdue jobs', () => {
    render(wrap(<Sidebar {...props({ jobs: { failed: 2, overdue: 1 } })} />));
    const jobs = screen.getByRole('button', { name: /Scheduled jobs/ });
    expect(within(jobs).getByText('3')).toBeTruthy();
  });

  test('no jobs badge when nothing failed or is overdue', () => {
    render(wrap(<Sidebar {...props()} />));
    const jobs = screen.getByRole('button', { name: /Scheduled jobs/ });
    expect(within(jobs).queryByText('0')).toBeNull();
  });

  test('the Docker footer shows the age of the last data when stale', () => {
    render(
      wrap(<Sidebar {...props({ docker: { state: 'unreachable', ageSeconds: 45, count: 3 } })} />),
    );
    expect(screen.getByText('Docker unreachable · 45 s')).toBeTruthy();
  });

  test('the Docker footer shows the live state and service count', () => {
    render(wrap(<Sidebar {...props()} />));
    expect(screen.getByText('Docker · live')).toBeTruthy();
    expect(screen.getByText('3 services')).toBeTruthy();
  });

  test('clicking a row opens that service', () => {
    const p = props();
    render(wrap(<Sidebar {...p} />));
    fireEvent.click(screen.getByRole('button', { name: /Streamhouse/ }));
    expect(p.onOpenService).toHaveBeenCalledWith('stream');
  });
});

describe('SidebarRail', () => {
  test('each icon has tooltip text "Name, status"', async () => {
    render(wrap(<SidebarRail {...props()} />));
    fireEvent.focus(screen.getByRole('button', { name: 'Torrent Client, degraded' }));
    expect((await screen.findAllByText('Torrent Client, degraded')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('tooltip')).toBeTruthy();
  });

  test('icons are labelled with name and status for assistive tech', () => {
    render(wrap(<SidebarRail {...props()} />));
    expect(screen.getByRole('button', { name: 'Watchlog, stopped' })).toBeTruthy();
  });
});

describe('TabBar switcher', () => {
  test('each listed tab has a close button that closes without selecting', async () => {
    const onClose = vi.fn();
    const onFocus = vi.fn();
    const noop = vi.fn();
    render(
      <TabBar
        tabs={[
          {
            id: 'stream',
            name: 'Streamhouse',
            service: svc('stream', 'Streamhouse'),
            status: 'healthy',
          },
        ]}
        activeId="stream"
        onFocus={onFocus}
        onClose={onClose}
        onCloseOthers={noop}
        onCloseAll={noop}
        onNew={noop}
      />,
    );
    const trigger = screen.getByRole('button', { name: /Open tabs/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Close Streamhouse tab' }));
    expect(onClose).toHaveBeenCalledWith('stream');
    expect(onFocus).not.toHaveBeenCalled();
  });
});

describe('TabBar tablist', () => {
  const tabs = [
    { id: 'a', name: 'Alpha', service: svc('a', 'Alpha'), status: 'healthy' as const },
    { id: 'b', name: 'Beta', service: svc('b', 'Beta'), status: 'healthy' as const },
  ];
  function bar() {
    const onClose = vi.fn();
    const onFocus = vi.fn();
    const noop = vi.fn();
    render(
      <TabBar
        tabs={tabs}
        activeId="b"
        onFocus={onFocus}
        onClose={onClose}
        onCloseOthers={noop}
        onCloseAll={noop}
        onNew={noop}
      />,
    );
    return { onClose, onFocus };
  }

  test('the tablist holds only tabs, with no button or wrapper inside it', () => {
    bar();
    const list = screen.getByRole('tablist');
    expect(Array.from(list.children).map((c) => c.getAttribute('role'))).toEqual(['tab', 'tab']);
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
  });

  test('only the active tab is a tab stop, and arrows move between tabs', () => {
    bar();
    const [alpha, beta] = screen.getAllByRole('tab');
    expect([alpha?.tabIndex, beta?.tabIndex]).toEqual([-1, 0]);
    beta?.focus();
    fireEvent.keyDown(beta as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(alpha);
    fireEvent.keyDown(alpha as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(beta);
  });

  test('Delete closes the focused tab, and the cross closes with the mouse', () => {
    const { onClose, onFocus } = bar();
    const [alpha] = screen.getAllByRole('tab');
    fireEvent.keyDown(alpha as HTMLElement, { key: 'Delete' });
    expect(onClose).toHaveBeenCalledWith('a');
    const cross = alpha?.lastElementChild;
    fireEvent.click(cross as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onFocus).not.toHaveBeenCalled();
  });
});

describe('sidebar footer and rail', () => {
  test('before the first status poll the footer is neutral, not "live"', () => {
    render(
      wrap(<Sidebar {...props({ docker: { state: 'pending', ageSeconds: null, count: 3 } })} />),
    );
    expect(screen.getByText('Docker · checking…')).toBeTruthy();
    expect(screen.queryByText('Docker · live')).toBeNull();
  });

  test('the rail Docker indicator can be reached by keyboard and is named', () => {
    render(wrap(<SidebarRail {...props()} />));
    const indicator = screen.getByRole('img', { name: 'Docker · live' });
    expect(indicator.tabIndex).toBe(0);
  });

  test('the search hint says Ctrl off Apple platforms, after mount', async () => {
    render(wrap(<Sidebar {...props()} />));
    expect((await screen.findByText('Ctrl K')).tagName).toBe('KBD');
  });
});
