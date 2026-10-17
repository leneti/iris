import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { group, servicesResponse, svc } from '../shell/fixtures';
import { data, statusResponse, stubBrowser, usePhoneViewport } from './mock-api';

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/client/api', async () => (await import('./mock-api')).apiMock);

stubBrowser();

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  usePhoneViewport();
  data.services = servicesResponse([
    group('Media', [svc('a', 'Showtrack'), svc('b', 'Streamhouse')]),
  ]);
  data.status = statusResponse({ a: 'degraded', b: 'healthy' });
  render(
    <TooltipProvider>
      <AppShell mode="lan" phoneMaxLive={3} />
    </TooltipProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', {
      name: /^Search/,
    }),
  );
});

describe('phone search', () => {
  test('the search input uses a 16 px font so iOS does not zoom', () => {
    const input = screen.getByPlaceholderText(/Search services/);
    expect(input.className).toContain('text-base');
    expect(input.className).not.toMatch(/text-(sm|xs|\[)/);
  });

  test('is the palette in the page, not a dialog, with the same sections', () => {
    expect(screen.queryByRole('dialog')).toBeNull();
    const headings = [...document.querySelectorAll('[cmdk-group-heading]')].map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(['Services', 'Actions']);
    expect(screen.getByText('Showtrack')).toBeTruthy();
  });

  test('has no sidebar action and no key hints', () => {
    expect(screen.queryByText(/sidebar/i)).toBeNull();
    expect(screen.queryByText('esc')).toBeNull();
  });

  test('result rows are 48 px tall', () => {
    const row = screen.getByText('Showtrack').closest('[cmdk-item]') as HTMLElement;
    expect(row.className).toContain('h-12');
  });

  test('choosing a service opens it full height', () => {
    fireEvent.click(screen.getByText('Showtrack'));
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
    expect(screen.getByTitle(/^Showtrack/)).toBeTruthy();
  });

  test('Cancel returns to the Overview', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(
      within(screen.getByRole('navigation', { name: 'Main' }))
        .getByRole('button', { name: /^Overview/ })
        .getAttribute('aria-current'),
    ).toBe('page');
  });
});
