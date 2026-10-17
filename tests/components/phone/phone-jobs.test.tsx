import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PhoneJobs } from '@/components/phone/phone-jobs';
import { cron, job } from '../overview/fixtures';
import { data } from './mock-api';

vi.mock('@/lib/client/api', async () => (await import('./mock-api')).apiMock);

const maintenance = job({
  id: 'updater',
  name: 'Image updater',
  kind: 'maintenance',
  schedule: { expr: '19 4 * * *', label: null, configured: false, source: 'host-status' },
  lastRun: null,
  result: 'unknown',
  summary: 'Not monitored',
  flag: 'unknown',
});

const names = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-slot="job-name"]')].map((n) => n.textContent);

beforeEach(() => {
  // The fixtures are timed on 2026-10-16; on a later real date the card adds a weekday.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-16T10:26:00.000Z') });
  data.cron = cron([
    job({ id: 'feed', name: 'feed-sync' }),
    job({ id: 'digest', name: 'report-digest', flag: 'warning', result: 'warning' }),
    job({
      id: 'photo',
      name: 'photo-index',
      flag: 'overdue',
      previousDue: '2026-10-16T10:05:00.000Z',
    }),
    job({
      id: 'price',
      name: 'price-watch',
      flag: 'failed',
      result: 'failed',
      summary: 'Request timed out.',
    }),
    maintenance,
  ]);
});
afterEach(() => vi.useRealTimers());

describe('PhoneJobs', () => {
  test('failed and overdue cards come first, then the rest, then System maintenance', () => {
    const { container } = render(<PhoneJobs />);
    expect(names(container)).toEqual([
      'price-watch',
      'photo-index',
      'feed-sync',
      'report-digest',
      'Image updater',
    ]);
    const mine = screen.getByRole('region', { name: 'Your jobs' });
    const system = screen.getByRole('region', { name: 'System maintenance' });
    expect(within(mine).getAllByRole('listitem')).toHaveLength(4);
    expect(within(system).getAllByRole('listitem')).toHaveLength(1);
    expect(mine.compareDocumentPosition(system) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('each card has the schedule, last run, next due and summary', () => {
    render(<PhoneJobs />);
    const card = screen.getByText('feed-sync').closest('li') as HTMLElement;
    expect(within(card).getByText('Every 15 minutes')).toBeTruthy();
    expect(within(card).getByText('*/15 * * * *')).toBeTruthy();
    expect(within(card).getByText(/Last 11:15/)).toBeTruthy();
    expect(within(card).getByText(/Next 11:30/)).toBeTruthy();
    expect(within(card).getByText('Nothing to do.')).toBeTruthy();
  });

  test('a flagged card has the status bar and the failed summary in the status colour', () => {
    render(<PhoneJobs />);
    const failed = screen.getByText('price-watch').closest('li') as HTMLElement;
    expect(failed.getAttribute('data-flag')).toBe('failed');
    expect(failed.className).toContain('bg-row-unhealthy');
    expect(within(failed).getByText('Request timed out.').className).toContain(
      'text-status-unhealthy-text',
    );
    const overdue = screen.getByText('photo-index').closest('li') as HTMLElement;
    expect(overdue.className).toContain('bg-row-degraded');
    expect(within(overdue).getByText(/Next was 11:05/)).toBeTruthy();
  });

  test('summarises the counts at the top', () => {
    render(<PhoneJobs />);
    for (const text of ['1 failed', '1 overdue', '1 warning', '1 ok']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  test('says when cron-status is unreachable', () => {
    data.cron = cron(
      [job({ id: 'a', name: 'feed-sync' })],
      [{ id: 'cron-status', state: 'unreachable', fetchedAt: null }],
    );
    render(<PhoneJobs />);
    expect(screen.getByText(/cron-status is unreachable/)).toBeTruthy();
  });
});
