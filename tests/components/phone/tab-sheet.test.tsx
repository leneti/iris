import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { group, servicesResponse, svc } from '../shell/fixtures';
import { data, statusResponse, stubBrowser, usePhoneViewport } from './mock-api';

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/client/api', async () => (await import('./mock-api')).apiMock);

stubBrowser();

const nav = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', {
    name: new RegExp(`^${name}`),
  });
const tabsButton = () => screen.getByRole('button', { name: /^Tabs \(\d+ open\)$/ });
const sheet = () => screen.getByRole('dialog', { name: 'Open tabs' });

function open(name: string) {
  if (!screen.queryByRole('navigation', { name: 'Main' })) {
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  }
  fireEvent.click(nav('Services'));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}(?!\\d)`) }));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  usePhoneViewport();
  data.services = servicesResponse([
    group('Media', [svc('a', 'Alpha'), svc('b', 'Beta'), svc('c', 'Gamma')]),
  ]);
  data.status = statusResponse({ a: 'healthy', b: 'degraded', c: 'healthy' });
  render(
    <TooltipProvider>
      <AppShell mode="lan" phoneMaxLive={3} />
    </TooltipProvider>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe('tab sheet', () => {
  test('drops from the top, where the tabs button is, with 12 px bottom corners and no close button', () => {
    // A bottom sheet can open below the visible screen in Firefox for Android.
    open('Alpha');
    fireEvent.click(tabsButton());
    const content = sheet();
    expect(content.className).toContain('top-0');
    expect(content.className).not.toContain('bottom-0');
    expect(content.className).toContain('rounded-b-sheet');
    expect(within(content).queryByRole('button', { name: 'Close' })).toBeNull();
  });

  test('lists the open tabs, marks the current one and shows each health', () => {
    open('Alpha');
    open('Beta');
    fireEvent.click(tabsButton());
    const rows = within(sheet()).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('[data-slot="tab-name"]')?.textContent)).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect(rows[1]?.getAttribute('aria-current')).toBe('true');
    expect(within(rows[1] as HTMLElement).getByRole('img', { name: /degraded/i })).toBeTruthy();
  });

  test('switches to a tab and closes itself', () => {
    open('Alpha');
    open('Beta');
    fireEvent.click(tabsButton());
    fireEvent.click(within(sheet()).getByRole('button', { name: /^Alpha/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('banner')).getByText('Alpha')).toBeTruthy();
    expect(screen.getByTitle(/^Alpha/).closest('[hidden]')).toBeNull();
  });

  test('closes one tab and keeps the rest', () => {
    open('Alpha');
    open('Beta');
    fireEvent.click(tabsButton());
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close Alpha' }));
    const rows = within(sheet()).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(screen.queryByTitle(/^Alpha/)).toBeNull();
    expect(screen.getByTitle(/^Beta/)).toBeTruthy();
  });

  test('closes the sheet with Escape', () => {
    open('Alpha');
    fireEvent.click(tabsButton());
    fireEvent.keyDown(sheet(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('"Close all tabs" empties the list and returns to the built-in view', () => {
    open('Alpha');
    open('Beta');
    fireEvent.click(tabsButton());
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close all tabs' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTitle(/^Alpha/)).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(tabsButton().textContent).toContain('0');
  });

  test('lists the current tab actions: open in browser, copy link, close all', () => {
    open('Alpha');
    fireEvent.click(tabsButton());
    const link = within(sheet()).getByRole('link', { name: 'Open in browser' });
    expect(link.getAttribute('href')).toBe('http://localhost:8080/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    // The lan address is not public, so there is no sign-in.
    expect(within(sheet()).queryByRole('button', { name: 'Sign in and retry' })).toBeNull();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Copy link' }));
    const field = within(sheet()).getByLabelText('Link') as HTMLInputElement;
    expect(field.value).toBe('http://localhost:8080/');
    expect(within(sheet()).getByRole('button', { name: 'Close all tabs' })).toBeTruthy();
  });

  test('on a built-in view it has the list but no current-tab actions', () => {
    open('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(tabsButton());
    expect(within(sheet()).queryByRole('link', { name: 'Open in browser' })).toBeNull();
    expect(within(sheet()).getAllByRole('listitem')).toHaveLength(1);
  });

  test('with no tab open it says so', () => {
    fireEvent.click(tabsButton());
    expect(within(sheet()).getByText('No open tabs')).toBeTruthy();
    expect(within(sheet()).queryByRole('button', { name: 'Close all tabs' })).toBeNull();
  });
});

describe('Sheet primitive, side="bottom"', () => {
  test('carries the 12 px top radius and a grab handle', () => {
    render(
      <Sheet open>
        <SheetContent side="bottom">
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>Choose one.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const content = screen.getAllByRole('dialog').at(-1) as HTMLElement;
    expect(content.className).toContain('rounded-t-sheet');
    expect(content.querySelector('[data-slot="sheet-handle"]')).not.toBeNull();
  });
});
