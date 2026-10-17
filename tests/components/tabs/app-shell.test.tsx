import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setAlwaysNewTab } from '@/lib/client/new-tab';
import type { ServiceEntry, ServicesResponse } from '@/lib/shared/contract';
import { group, servicesResponse, svc } from '../shell/fixtures';

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));

let servicesData: ServicesResponse | undefined;
const mutate = vi.fn();
vi.mock('@/lib/client/api', () => ({
  useServices: () => ({ data: servicesData, mutate }),
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

const many: ServiceEntry[] = Array.from({ length: 10 }, (_, i) => svc(`s${i}`, `Svc ${i}`));
const torrent: ServiceEntry = {
  ...svc('t', 'Torrent Client', 'Downloads'),
  embed: { mode: 'auto', verdict: 'blocked', reason: 'x-frame-options', checkedAt: null },
};

function mount(mode: 'lan' | 'zone' = 'lan') {
  return render(
    <TooltipProvider>
      <AppShell mode={mode} />
    </TooltipProvider>,
  );
}
const openFromSidebar = (name: string) =>
  // The sidebar only: the Overview shows the same names as tiles.
  fireEvent.click(
    within(screen.getByRole('navigation')).getByRole('button', {
      name: new RegExp(`^${name}(?!\\d)`),
    }),
  );
const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}(?!\\d)`) });
const frame = (name: string) =>
  screen.getByTitle(new RegExp(`^${name}(?!\\d)`)) as HTMLIFrameElement;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  servicesData = servicesResponse([group('Media', [...many, torrent])]);
  mutate.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'fullscreenEnabled');
});

describe('tab marks', () => {
  test('a tab shows a spinner while its frame loads, and none after load', () => {
    mount();
    openFromSidebar('Svc 0');
    expect(within(tab('Svc 0')).getByRole('img', { name: 'loading' })).toBeTruthy();
    fireEvent.load(frame('Svc 0'));
    expect(within(tab('Svc 0')).queryByRole('img', { name: 'loading' })).toBeNull();
  });

  test('a blocked service shows the blocked mark and no iframe', () => {
    mount();
    openFromSidebar('Torrent Client');
    expect(within(tab('Torrent Client')).getByRole('img', { name: 'blocked' })).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('heading', { name: /can.t be shown here/ })).toBeTruthy();
  });

  test('a 9th tab suspends the least recently used: iframe removed, pause mark shown', () => {
    mount();
    for (let i = 0; i < 9; i += 1) openFromSidebar(`Svc ${i}`);
    expect(document.querySelectorAll('iframe')).toHaveLength(8);
    expect(screen.queryByTitle(/^Svc 0 /)).toBeNull();
    expect(within(tab('Svc 0')).getByRole('img', { name: 'suspended' })).toBeTruthy();
    expect(within(tab('Svc 8')).queryByRole('img', { name: 'suspended' })).toBeNull();
    // Selecting the suspended tab brings its frame back and suspends the next least recent one.
    fireEvent.click(tab('Svc 0'));
    expect(frame('Svc 0')).toBeTruthy();
    expect(document.querySelectorAll('iframe')).toHaveLength(8);
    expect(within(tab('Svc 1')).getByRole('img', { name: 'suspended' })).toBeTruthy();
  });

  test('a frame survives switching tabs (the same node comes back)', () => {
    mount();
    openFromSidebar('Svc 0');
    openFromSidebar('Svc 1');
    const first = frame('Svc 0');
    fireEvent.click(tab('Svc 0'));
    expect(frame('Svc 0')).toBe(first);
  });
});

describe('pinned Overview', () => {
  test('is the first tab before anything is open, selected, with no close mark', () => {
    mount();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.textContent).toBe('Overview');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('button', { name: /New tab/ })).toBeNull();
  });

  test('stays first, ignores Delete and middle-click, and comes back into focus when clicked', () => {
    mount();
    openFromSidebar('Svc 0');
    const overview = tab('Overview');
    expect(screen.getAllByRole('tab')[0]).toBe(overview);
    expect(overview.getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(overview, { key: 'Delete' });
    fireEvent(overview, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(tab('Overview')).toBeTruthy();
    fireEvent.click(tab('Overview'));
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    expect(tab('Svc 0')).toBeTruthy();
  });
});

describe('controls', () => {
  test('reload returns the frame to its start URL and shows the spinner again', () => {
    mount();
    openFromSidebar('Svc 0');
    fireEvent.load(frame('Svc 0'));
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(frame('Svc 0').getAttribute('src')).toBe('http://localhost:8080/');
    expect(within(tab('Svc 0')).getByRole('img', { name: 'loading' })).toBeTruthy();
  });

  test('pop-out opens the address with noopener,noreferrer', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount();
    openFromSidebar('Svc 0');
    fireEvent.click(screen.getByRole('button', { name: 'Open in new browser tab' }));
    expect(open).toHaveBeenCalledWith('http://localhost:8080/', '_blank', 'noopener,noreferrer');
  });

  test('fullscreen is hidden where the Fullscreen API is not available', () => {
    mount();
    openFromSidebar('Svc 0');
    expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull();
  });

  test('fullscreen asks the canvas wrapper to go full screen', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    const request = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = request;
    mount();
    openFromSidebar('Svc 0');
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(request).toHaveBeenCalledTimes(1);
    const target = request.mock.contexts[0] as HTMLElement;
    expect(target.contains(frame('Svc 0'))).toBe(true);
    expect(target.dataset.slot).toBe('canvas');
  });

  test('the more menu offers "Sign in and retry" for a public address and reloads when the popup closes', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const popup = { closed: false, opener: {} as unknown };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    mount('zone');
    openFromSidebar('Svc 0');
    fireEvent.load(frame('Svc 0'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign in and retry' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0]![0])).toBe('https://s0.example.invalid/');
    expect(popup.opener).toBeNull();
    // While the popup is open the tab is left alone.
    act(() => void vi.advanceTimersByTime(1500));
    expect(within(tab('Svc 0')).queryByRole('img', { name: 'loading' })).toBeNull();
    popup.closed = true;
    act(() => void vi.advanceTimersByTime(500));
    expect(within(tab('Svc 0')).getByRole('img', { name: 'loading' })).toBeTruthy();
  });

  test('the more menu has no "Sign in and retry" on a LAN address', () => {
    mount('lan');
    openFromSidebar('Svc 0');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.queryByRole('menuitem', { name: 'Sign in and retry' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeTruthy();
  });

  test('"Check again" re-fetches the services list', () => {
    mount();
    openFromSidebar('Torrent Client');
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

describe('always open in a new tab', () => {
  test('a service marked on this device opens in a browser tab, not a dashboard tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    setAlwaysNewTab('s1', true);
    mount();
    openFromSidebar('Svc 1');
    expect(open).toHaveBeenCalledWith('http://localhost:8080/', '_blank', 'noopener,noreferrer');
    expect(screen.queryByRole('tab', { name: /Svc 1/ })).toBeNull();
  });

  test('the card switch stores the choice per device', () => {
    mount();
    openFromSidebar('Torrent Client');
    fireEvent.click(screen.getByRole('switch', { name: /Always open Torrent Client/ }));
    expect(
      JSON.parse(localStorage.getItem('iris.pref.tabs.alwaysNewTab') ?? '{}') as unknown,
    ).toEqual({ t: true });
  });
});

describe('copy link', () => {
  test('the address stays focused and selected after the menu closes', async () => {
    mount();
    openFromSidebar('Torrent Client');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const field = screen.getByLabelText('Link') as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)).toBe(field.value);
  });
});
