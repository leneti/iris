import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { DesktopTopBar } from '@/components/shell/top-bar';
import type { CronResponse } from '@/lib/shared/contract';

function mount(over: { onOpenJobs?: () => void; onSearch?: () => void } = {}) {
  return render(
    <DesktopTopBar
      tabBar={<div role="tablist" aria-label="Open tabs" />}
      cron={undefined as CronResponse | undefined}
      onOpenJobs={over.onOpenJobs ?? (() => {})}
      onSearch={over.onSearch ?? (() => {})}
    />,
  );
}

describe('DesktopTopBar', () => {
  test('has the wordmark, the tab bar, the jobs pill and a search button', () => {
    mount();
    expect(document.querySelector('[data-slot="wordmark-i"]')).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Open tabs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Jobs/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });

  test('search button shows the platform shortcut and calls onSearch', () => {
    const onSearch = vi.fn();
    mount({ onSearch });
    const button = screen.getByRole('button', { name: 'Search' });
    expect(button.querySelector('kbd')?.textContent).toMatch(/^(⌘|Ctrl)\s?K$/);
    fireEvent.click(button);
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  test('the jobs pill opens the jobs tab', () => {
    const onOpenJobs = vi.fn();
    mount({ onOpenJobs });
    fireEvent.click(screen.getByRole('button', { name: /^Jobs/ }));
    expect(onOpenJobs).toHaveBeenCalledTimes(1);
  });
});
