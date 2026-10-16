import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { JobsView } from '@/components/jobs/jobs-view';
import { cron, job, mockApi, renderFresh } from '../overview/fixtures';

afterEach(() => vi.unstubAllGlobals());

const maintenance = (over = {}) =>
  job({
    id: 'updater',
    name: 'Image updater',
    kind: 'maintenance',
    schedule: { expr: '19 4 * * *', label: null, configured: false, source: 'host-status' },
    lastRun: null,
    result: 'unknown',
    summary: 'Not monitored',
    flag: 'unknown',
    ...over,
  });

describe('JobsView', () => {
  test('has the two tables and the six columns', async () => {
    mockApi({ '/api/cron': cron([job({ id: 'a', name: 'feed-sync' }), maintenance()]) });
    renderFresh(<JobsView />);
    const mine = await screen.findByRole('table', { name: 'Your jobs' });
    const system = screen.getByRole('table', { name: 'System maintenance' });
    const heads = within(mine)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toEqual(['Job', 'Schedule', 'Last run', 'Result', 'Summary', 'Next due']);
    expect(within(mine).getByText('feed-sync')).toBeTruthy();
    expect(within(mine).getByText('Every 15 minutes')).toBeTruthy();
    expect(within(mine).getByText('*/15 * * * *')).toBeTruthy();
    expect(within(system).getByText('Image updater')).toBeTruthy();
  });

  test('a maintenance job without the host status file reads "Not monitored"', async () => {
    mockApi({ '/api/cron': cron([maintenance()]) });
    renderFresh(<JobsView />);
    const row = (await screen.findByText('Image updater')).closest('tr') as HTMLElement;
    expect(within(row).getAllByText('Not monitored').length).toBeGreaterThan(0);
    expect(within(row).queryByText('Failed')).toBeNull();
    expect(within(row).queryByText('Overdue')).toBeNull();
  });

  test('an overdue job shows when it was due and how late, and keeps its last result', async () => {
    mockApi({
      '/api/cron': cron([
        job({
          id: 'p',
          name: 'photo-index',
          flag: 'overdue',
          result: 'success',
          summary: 'Last result was success.',
          previousDue: '2026-10-16T10:05:00.000Z',
          nextDue: '2026-10-16T11:05:00.000Z',
          lastRun: '2026-10-16T07:05:00.000Z',
        }),
      ]),
    });
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-16T10:26:00.000Z') });
    try {
      renderFresh(<JobsView />);
      const row = (await screen.findByText('photo-index')).closest('tr') as HTMLElement;
      expect(within(row).getByText('Overdue')).toBeTruthy();
      expect(within(row).getByText('Last result was success.')).toBeTruthy();
      expect(within(row).getByText(/21 min late/)).toBeTruthy();
      // 10:05 UTC is 11:05 in Europe/London on this date.
      expect(within(row).getByText(/Due 11:05/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  test('the job link is an anchor with a safe rel', async () => {
    mockApi({
      '/api/cron': cron([job({ id: 'a', name: 'feed-sync', link: 'https://x.example.invalid/' })]),
    });
    renderFresh(<JobsView />);
    const link = (await screen.findByRole('link', { name: 'feed-sync' })) as HTMLAnchorElement;
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.target).toBe('_blank');
  });

  test('says so when the cron source is unreachable', async () => {
    mockApi({
      '/api/cron': cron([], [{ id: 'cron-status', state: 'unreachable', fetchedAt: null }]),
    });
    renderFresh(<JobsView />);
    await waitFor(() => expect(screen.getByText(/cron-status is unreachable/)).toBeTruthy());
  });
});
