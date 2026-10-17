import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ServiceEntry, ServicesResponse } from '@/lib/shared/contract';
import { group, servicesResponse, svc } from '../shell/fixtures';

let servicesData: ServicesResponse | undefined;
vi.mock('@/lib/client/api', () => ({
  useServices: () => ({ data: servicesData, mutate: vi.fn() }),
  useStatus: () => ({ data: undefined }),
  useCron: () => ({ data: undefined }),
  useWidgets: () => ({ data: undefined }),
  useSystem: () => ({ data: undefined }),
  useStreams: () => ({ data: undefined }),
}));

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

const moviebox: ServiceEntry = {
  ...svc('movies', 'Moviebox', 'Media'),
  description: 'Movie collection',
  keywords: ['radarr'],
};
const streamhouse = svc('stream', 'Streamhouse', 'Media');
const noEmbed: ServiceEntry = {
  ...svc('legacy', 'Legacy Panel', 'Tools'),
  embed: { mode: 'false', verdict: 'blocked', reason: 'label', checkedAt: null },
};

function mount() {
  return render(
    <TooltipProvider>
      <AppShell mode="lan" />
    </TooltipProvider>,
  );
}
const input = () => screen.getByRole('combobox') as HTMLInputElement;
const openPalette = () => fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const enter = (init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(input(), { key: 'Enter', ...init });
const openFromSidebar = (name: string) =>
  // The sidebar only: the Overview shows the same names as tiles.
  fireEvent.click(
    within(screen.getByRole('navigation')).getByRole('button', {
      name: new RegExp(`^${name}(?!\\d)`),
    }),
  );

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  servicesData = {
    ...servicesResponse([group('Media', [moviebox, streamhouse]), group('Tools', [noEmbed])]),
    links: [{ name: 'Router Admin', abbr: 'RA', url: 'http://router.example.invalid/admin' }],
  };
});
afterEach(() => vi.restoreAllMocks());

describe('opening the palette', () => {
  test('Ctrl+K opens it and focuses the input', () => {
    mount();
    openPalette();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.activeElement).toBe(input());
  });

  test('"/" opens it when focus is outside an input', () => {
    mount();
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('typing "/" inside the palette input is left alone and inserts the character (4.1)', () => {
    mount();
    openPalette();
    // Not prevented: the browser inserts the character.
    expect(fireEvent.keyDown(input(), { key: '/' })).toBe(true);
    type('a/b');
    expect(input().value).toBe('a/b');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('the sidebar search button opens it (4.3)', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Search services/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('the key listener is removed on unmount', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = mount();
    unmount();
    expect(remove.mock.calls.some(([type]) => type === 'keydown')).toBe(true);
    openPalette();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('search', () => {
  test('"rdr" finds Moviebox through its keyword "radarr" (4.2)', () => {
    mount();
    openPalette();
    type('rdr');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('option')[0]!.textContent).toContain('Moviebox');
    expect(within(dialog).queryByRole('option', { name: /Streamhouse/ })).toBeNull();
  });

  test('a link is found by its hostname', () => {
    mount();
    openPalette();
    type('router.example');
    expect(screen.getByRole('option', { name: /Router Admin/ })).toBeTruthy();
  });

  test('sections are Services, Links, Open tabs and Actions', () => {
    mount();
    openFromSidebar('Moviebox');
    openPalette();
    const dialog = screen.getByRole('dialog');
    for (const heading of ['Services', 'Links', 'Open tabs', 'Actions']) {
      expect(within(dialog).getByText(heading)).toBeTruthy();
    }
  });
});

describe('unique rows', () => {
  test('two services with one name in different groups both render and each opens itself', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    servicesData = servicesResponse([
      group('Media', [svc('admin-a', 'Admin', 'Media')]),
      group('Tools', [svc('admin-b', 'Admin', 'Tools')]),
    ]);
    mount();
    openPalette();
    type('Admin');
    const rows = screen.getAllByRole('option').filter((o) => /^AAdmin/.test(o.textContent ?? ''));
    expect(rows).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    const second = rows.find((o) => /Tools/.test(o.textContent ?? ''))!;
    fireEvent.click(second);
    expect(window.location.hash).toBe('#tab=admin-b');
  });

  test('"tab" does not match an open tab just because the row is an open tab', () => {
    mount();
    openFromSidebar('Streamhouse');
    openPalette();
    type('tab');
    expect(screen.queryByRole('option', { name: /Streamhouse/ })).toBeNull();
  });

  test('"link" does not match every link row by its kind', () => {
    servicesData = {
      ...servicesData!,
      links: [{ name: 'Router Admin', abbr: 'RA', url: 'http://router.example.invalid/admin' }],
    };
    mount();
    openPalette();
    type('link');
    expect(screen.queryByRole('option', { name: /Router Admin/ })).toBeNull();
  });
});

describe('Enter', () => {
  test('on an open service focuses its tab instead of opening a second one', () => {
    mount();
    openFromSidebar('Moviebox');
    openFromSidebar('Streamhouse');
    openPalette();
    type('Moviebox');
    enter();
    expect(
      screen.getAllByRole('tab').filter((t) => /Moviebox/.test(t.textContent ?? '')),
    ).toHaveLength(1);
    // The two services and the pinned Overview.
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /Moviebox/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('on a service that is not open opens its tab', () => {
    mount();
    openPalette();
    type('Streamhouse');
    enter();
    expect(screen.getByRole('tab', { name: /Streamhouse/ })).toBeTruthy();
  });

  test('on a link opens a browser tab with noopener,noreferrer (4.4)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount();
    openPalette();
    type('router');
    enter();
    expect(open).toHaveBeenCalledWith(
      'http://router.example.invalid/admin',
      '_blank',
      'noopener,noreferrer',
    );
  });

  test('on a service whose embed is off opens a browser tab, not a dashboard tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount();
    openPalette();
    type('Legacy');
    enter();
    expect(open).toHaveBeenCalledWith('http://localhost:8080/', '_blank', 'noopener,noreferrer');
    expect(screen.queryByRole('tab', { name: /Legacy/ })).toBeNull();
  });

  test('Ctrl+Enter on a service opens a new window with noopener,noreferrer', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount();
    openPalette();
    type('Streamhouse');
    enter({ ctrlKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    const [url, target, features] = open.mock.calls[0]!;
    expect(url).toBe('http://localhost:8080/');
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
    expect(features).toContain('noreferrer');
    expect(screen.queryByRole('tab', { name: /Streamhouse/ })).toBeNull();
  });

  test('on "Collapse sidebar" collapses the sidebar and the label flips', () => {
    mount();
    openPalette();
    type('collapse');
    enter();
    expect(localStorage.getItem('iris.pref.sidebar.collapsed')).toBe('"collapsed"');
    openPalette();
    expect(screen.getByRole('option', { name: /Expand sidebar/ })).toBeTruthy();
  });

  test('on "Show scheduled jobs" opens the jobs tab', () => {
    mount();
    openPalette();
    type('scheduled');
    enter();
    expect(screen.getByRole('tab', { name: /Scheduled jobs|Jobs/ })).toBeTruthy();
  });
});

describe('page mode', () => {
  test('renders the search in the page, without a dialog or key hints', async () => {
    const { Palette } = await import('@/components/palette/palette');
    render(
      <Palette
        open
        onOpenChange={() => {}}
        mode="page"
        groups={servicesData?.groups ?? []}
        links={[]}
        statusById={{}}
        openIds={[]}
        address={{ mode: 'lan', hostname: 'localhost', protocol: 'http:' }}
        onOpenService={() => {}}
        onFocusTab={() => {}}
        onOpenBuiltin={() => {}}
        jobsFailed={0}
        sidebarCollapsed={false}
        onToggleCollapsed={() => {}}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input()).toBeTruthy();
    expect(screen.queryByText('New window')).toBeNull();
  });
});
