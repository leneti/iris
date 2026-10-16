import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PhoneServices } from '@/components/phone/phone-services';
import type { ServiceWidget, WidgetsResponse } from '@/lib/shared/contract';
import { group, svc } from '../shell/fixtures';
import { widgets } from '../overview/fixtures';
import { data } from './mock-api';

vi.mock('@/lib/client/api', async () => (await import('./mock-api')).apiMock);

const stats = (
  ...pairs: Array<
    [string, string, number | string] | [string, string, number | string, string | null]
  >
): ServiceWidget => ({
  type: 'x',
  state: 'ok',
  fetchedAt: null,
  stats: pairs.map(([key, label, value, unit = null]) => ({ key, label, value, unit })),
});

function mount(over: Partial<WidgetsResponse> = {}, onOpen = vi.fn()) {
  data.widgets = widgets({
    services: {
      b: stats(['a', 'wanted', 14], ['b', 'movies', 1482], ['c', 'queued', 3], ['d', 'extra', 9]),
      c: { ...stats(), state: 'unreachable' },
      d: stats(['download', 'download', 12.4e6 * 8, 'bytes-per-second']),
    },
    ...over,
  });
  render(
    <PhoneServices
      groups={[
        group('Media', [svc('a', 'Plain'), svc('b', 'Figures')]),
        group('Downloads', [svc('c', 'Broken'), svc('d', 'Torrent')]),
      ]}
      statusById={{ a: 'healthy', b: 'degraded', c: 'unhealthy' }}
      openIds={['b']}
      onOpenService={onOpen}
    />,
  );
  return onOpen;
}

beforeEach(() => {
  localStorage.clear();
});

describe('PhoneServices', () => {
  test('rows are 48 px, or 60 px with a second line of at most three figures', () => {
    mount();
    const plain = screen.getByRole('button', { name: /^Plain/ });
    expect(plain.className).toContain('min-h-12');
    const figures = screen.getByRole('button', { name: /^Figures/ });
    expect(figures.className).toContain('min-h-[60px]');
    expect(within(figures).getByText('14 wanted · 1,482 movies · 3 queued')).toBeTruthy();
    expect(within(figures).queryByText(/extra/)).toBeNull();
  });

  test('a failed read says Data unavailable on the second line', () => {
    mount();
    const broken = screen.getByRole('button', { name: /^Broken/ });
    expect(within(broken).getByText('Data unavailable')).toBeTruthy();
    expect(broken.className).toContain('min-h-[60px]');
  });

  test('marks the services open in a tab', () => {
    mount();
    expect(
      within(screen.getByRole('button', { name: /^Figures/ })).getByLabelText('Open in a tab'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('button', { name: /^Plain/ })).queryByLabelText('Open in a tab'),
    ).toBeNull();
  });

  test('tapping a row opens the service', () => {
    const onOpen = mount();
    fireEvent.click(screen.getByRole('button', { name: /^Plain/ }));
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  test('groups collapse and the choice is remembered', () => {
    mount();
    const header = screen.getByRole('button', { name: /^Media/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header);
    expect(screen.queryByRole('button', { name: /^Plain/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Torrent/ })).toBeTruthy();
  });

  test('group headers carry the count and the worst health', () => {
    mount();
    const header = screen.getByRole('button', { name: /^Media/ });
    expect(header.textContent).toContain('2');
    expect(within(header).getByRole('img', { name: /degraded/i })).toBeTruthy();
  });
});
