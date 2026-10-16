import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { JobsPill, jobsPill } from '@/components/jobs/jobs-pill';
import { cron, job } from '../overview/fixtures';

describe('jobsPill state', () => {
  test.each([
    [cron([job({ id: 'a', name: 'a', flag: 'failed' })]), 'red', 'Jobs · 1 failed'],
    [cron([job({ id: 'a', name: 'a', flag: 'overdue' })]), 'amber', 'Jobs · 1 overdue'],
    [cron([job({ id: 'a', name: 'a', flag: 'warning' })]), 'amber', 'Jobs · 1 warning'],
    [cron([job({ id: 'a', name: 'a' })]), 'neutral', 'Jobs'],
    [undefined, 'neutral', 'Jobs'],
  ] as const)('%#', (data, tone, text) => {
    expect(jobsPill(data, false)).toEqual({ tone, text });
  });

  test('unreachable cron-status is amber', () => {
    expect(jobsPill(undefined, true)).toEqual({ tone: 'amber', text: 'Jobs · unavailable' });
  });
});

describe('JobsPill', () => {
  test('failed is red, reads the count, and opens the jobs view on click', () => {
    const onOpen = vi.fn();
    render(<JobsPill cron={cron([job({ id: 'a', name: 'a', flag: 'failed' })])} onOpen={onOpen} />);
    const pill = screen.getByRole('button', { name: /Jobs · 1 failed/ });
    expect(pill.className).toContain('text-status-unhealthy-text');
    fireEvent.click(pill);
    expect(onOpen).toHaveBeenCalled();
  });

  test('an unreachable cron-status source shows the amber unavailable pill', () => {
    render(
      <JobsPill
        cron={cron([], [{ id: 'cron-status', state: 'unreachable', fetchedAt: null }])}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /unavailable/ }).className).toContain(
      'text-status-degraded-text',
    );
  });
});
