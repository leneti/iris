import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { group, servicesResponse, svc } from '../shell/fixtures';
import { cron, job } from '../overview/fixtures';
import { data, stubBrowser, usePhoneViewport } from './mock-api';

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/client/api', async () => (await import('./mock-api')).apiMock);

stubBrowser();

function mount(phoneMaxLive = 3) {
  return render(
    <TooltipProvider>
      <AppShell mode="lan" phoneMaxLive={phoneMaxLive} />
    </TooltipProvider>,
  );
}

/** The menu button: only a built-in view's top bar has one. */
const menuButton = () => screen.queryByRole('button', { name: /^Menu/ });
/** An item of the menu, opening the menu first. */
function nav(name: string) {
  if (!screen.queryByRole('navigation', { name: 'Main' })) fireEvent.click(menuButton()!);
  return within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', {
    name: new RegExp(`^${name}`),
  });
}
const tabsButton = () => screen.getByRole('button', { name: /^Tabs \(\d+ open\)$/ });
const frame = (name: string) =>
  screen.getByTitle(new RegExp(`^${name}(?!\\d)`)) as HTMLIFrameElement;
const iframes = () => document.querySelectorAll('iframe');

/** Opens a service from the Services view, wherever the phone is now. */
function openService(name: string) {
  if (!menuButton()) fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(nav('Services'));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}(?!\\d)`) }));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  usePhoneViewport();
  data.services = servicesResponse([
    group('Media', [
      svc('s0', 'Svc 0'),
      svc('s1', 'Svc 1'),
      svc('s2', 'Svc 2'),
      svc('s3', 'Svc 3'),
    ]),
  ]);
  data.status = undefined;
  data.cron = cron([
    job({ id: 'a', name: 'price-watch', flag: 'failed', result: 'failed' }),
    job({ id: 'b', name: 'photo-index', flag: 'overdue' }),
    job({ id: 'c', name: 'feed-sync' }),
  ]);
  data.widgets = undefined;
  data.system = undefined;
  data.streams = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('phone shell', () => {
  test('shows the top bar with a menu of four items, not the desktop sidebar', () => {
    mount();
    expect(within(screen.getByRole('banner')).getByRole('button', { name: /^Menu/ })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    nav('Overview');
    const names = within(screen.getByRole('navigation', { name: 'Main' }))
      .getAllByRole('button')
      .map((b) => b.textContent?.replace(/\d+/g, ''));
    expect(names).toEqual(['Overview', 'Services', 'Search', 'Jobs']);
    expect(screen.queryByRole('navigation', { name: 'Services' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  test('marks the current item, and choosing one closes the menu', () => {
    mount();
    expect(nav('Overview').getAttribute('aria-current')).toBe('page');
    fireEvent.click(nav('Services'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Services' })).toBeTruthy();
    expect(nav('Services').getAttribute('aria-current')).toBe('page');
    expect(nav('Overview').getAttribute('aria-current')).toBeNull();
  });

  test('opening a service puts Back in place of the menu, and Back returns with the tab open (9.2)', () => {
    mount();
    openService('Svc 0');
    expect(menuButton()).toBeNull();
    expect(frame('Svc 0')).toBeTruthy();
    expect(tabsButton().textContent).toContain('1');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(menuButton()).toBeTruthy();
    expect(tabsButton().textContent).toContain('1');
    expect(nav('Services').getAttribute('aria-current')).toBe('page');
    // The frame is still there, only hidden.
    expect(frame('Svc 0').closest('[hidden]')).not.toBeNull();
  });

  test('the service top bar has Back, Reload and the tabs button, and no fullscreen', () => {
    mount();
    openService('Svc 0');
    const bar = screen.getByRole('banner');
    expect(within(bar).getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(within(bar).getByText('Svc 0')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /full ?screen/i })).toBeNull();
  });

  test('Reload starts the frame again', () => {
    mount();
    openService('Svc 0');
    const before = frame('Svc 0');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(frame('Svc 0')).not.toBe(before);
  });

  test('keyboard shortcuts do nothing on a phone', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a built-in view scrolls the page, so the browser sizes it and can pull to refresh', () => {
    const { container } = mount();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('min-h-svh');
    expect(root.className).not.toContain('overflow-hidden');
    expect(root.className).not.toContain('overscroll-contain');
    expect(root.className).not.toMatch(/(^| )h-svh/);
  });

  test('nothing is fixed to the bottom edge, which Firefox for Android does not keep on screen', () => {
    const { container } = mount();
    nav('Overview');
    for (const el of [container, ...document.querySelectorAll('[role="dialog"]')]) {
      expect(el.innerHTML).not.toMatch(/\bbottom-0\b/);
    }
  });

  test('an open service fills the screen and keeps overscroll inside', () => {
    const { container } = mount();
    openService('Svc 0');
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('fixed');
    expect(root.className).toContain('inset-0');
    expect(root.className).toContain('overscroll-contain');
  });
});

describe('Jobs badge (9.1)', () => {
  test('equals the failed and overdue count, and the Jobs view lists as many flagged cards', () => {
    mount();
    const badge = within(nav('Jobs')).getByLabelText('2 jobs need attention');
    expect(badge.textContent).toBe('2');
    fireEvent.click(nav('Jobs'));
    const flagged = document.querySelectorAll('[data-flag="failed"], [data-flag="overdue"]');
    expect(flagged).toHaveLength(2);
    expect(Number(badge.textContent)).toBe(flagged.length);
  });

  test('is absent when no job needs attention', () => {
    data.cron = cron([job({ id: 'c', name: 'feed-sync' })]);
    mount();
    expect(menuButton()?.getAttribute('aria-label')).toBe('Menu');
    expect(within(nav('Jobs')).queryByLabelText(/need attention/)).toBeNull();
  });

  test('the menu button says so too, without opening the menu', () => {
    mount();
    expect(menuButton()?.getAttribute('aria-label')).toBe('Menu, 2 jobs need attention');
  });
});

describe('frames', () => {
  test('switching views never moves or reloads a live frame', () => {
    mount();
    openService('Svc 0');
    const first = frame('Svc 0');
    const parent = first.parentElement;
    const onload = vi.fn();
    first.addEventListener('load', onload);

    openService('Svc 1');
    expect(frame('Svc 0')).toBe(first);
    expect(first.parentElement).toBe(parent);
    expect(first.isConnected).toBe(true);

    // Back to the first tab through the tab sheet.
    fireEvent.click(tabsButton());
    const sheet = screen.getByRole('dialog', { name: 'Open tabs' });
    fireEvent.click(within(sheet).getByRole('button', { name: /^Svc 0/ }));
    expect(frame('Svc 0')).toBe(first);
    expect(first.parentElement).toBe(parent);
    expect(first.closest('[hidden]')).toBeNull();
    expect(frame('Svc 1').closest('[hidden]')).not.toBeNull();
    expect(onload).not.toHaveBeenCalled();
  });

  test('keeps at most phone.maxLiveFrames live, and suspends the least recently used', () => {
    mount(3);
    for (const name of ['Svc 0', 'Svc 1', 'Svc 2', 'Svc 3']) openService(name);
    expect(iframes()).toHaveLength(3);
    expect(screen.queryByTitle(/^Svc 0/)).toBeNull();
    expect(frame('Svc 3')).toBeTruthy();
  });

  test('a lower cap keeps fewer frames', () => {
    mount(2);
    for (const name of ['Svc 0', 'Svc 1', 'Svc 2']) openService(name);
    expect(iframes()).toHaveLength(2);
  });
});

describe('resizing', () => {
  test('growing past 640 px shows the desktop sidebar again', () => {
    const { rerender } = mount();
    expect(menuButton()).toBeTruthy();
    act(() => {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })) as unknown as typeof window.matchMedia;
    });
    rerender(
      <TooltipProvider>
        <AppShell mode="lan" phoneMaxLive={3} />
      </TooltipProvider>,
    );
    // useMedia re-reads on the next render of a subscriber; the desktop shell has a sidebar.
    expect(menuButton()).toBeNull();
  });
});
