import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PhoneOverview, type PhoneOverviewProps } from '@/components/phone/phone-overview';
import type { StandaloneWidget } from '@/lib/shared/contract';
import { group, servicesResponse, svc } from '../shell/fixtures';
import { cron, job, mockApi, renderFresh, streams, system, widgets } from '../overview/fixtures';
import { statusResponse } from './mock-api';

Element.prototype.scrollIntoView ??= () => {};

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));

const markets: StandaloneWidget = {
  id: 'markets',
  name: 'Markets',
  group: 'Home',
  icon: { kind: 'lucide', name: 'chart-line' },
  type: 'coinmarketcap',
  state: 'ok',
  fetchedAt: '2026-10-16T10:20:00.000Z',
  interval: '24h',
  stats: [
    {
      key: 'AAA',
      label: 'Alphacoin',
      value: 61240,
      unit: 'GBP',
      changePercent: { '1h': 0.1, '24h': 1.2, '7d': -3.4, '30d': 8 },
    },
    {
      key: 'BBB',
      label: 'Betacoin',
      value: 3180,
      unit: 'GBP',
      changePercent: { '1h': 0, '24h': -0.4, '7d': 1, '30d': 2 },
    },
  ],
};

const services = {
  ...servicesResponse([
    group('Media', [svc('m', 'Moviebox'), svc('s', 'Showtrack'), svc('t', 'Torrent')]),
  ]),
  links: [{ name: 'Example Wiki', abbr: 'EW', url: 'https://wiki.example.invalid/page' }],
};

function props(over: Partial<PhoneOverviewProps> = {}): PhoneOverviewProps {
  const status = statusResponse({ m: 'healthy', s: 'unhealthy', t: 'stopped' });
  const entry = status.services.t;
  if (entry) entry.changedAt = '2026-10-16T10:00:00.000Z';
  return {
    services,
    status,
    openIds: [],
    onOpenService: vi.fn(),
    onOpenJobs: vi.fn(),
    ...over,
  };
}

function api(over: Record<string, unknown> = {}) {
  return mockApi({
    '/api/widgets': widgets({ standalone: [markets] }),
    '/api/system': system(),
    '/api/streams': streams(),
    '/api/cron': cron([
      job({ id: 'p', name: 'price-watch', flag: 'failed', result: 'failed' }),
      job({
        id: 'ph',
        name: 'photo-index',
        flag: 'overdue',
        previousDue: '2026-10-16T10:05:00.000Z',
      }),
      job({ id: 'f', name: 'feed-sync' }),
    ]),
    ...over,
  });
}

beforeEach(() => {
  window.matchMedia = (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => vi.unstubAllGlobals());

describe('PhoneOverview', () => {
  test('leads with the alerts, then the health counts, System and Now playing', async () => {
    api();
    renderFresh(<PhoneOverview {...props()} />);
    await screen.findByRole('region', { name: 'Alerts' });
    const order = [
      screen.getByRole('region', { name: 'Alerts' }),
      screen.getByRole('region', { name: 'Health' }),
      screen.getByRole('region', { name: 'System' }),
      screen.getByRole('region', { name: 'Now playing' }),
      screen.getByRole('region', { name: 'Markets' }),
      screen.getByRole('region', { name: 'Links' }),
      screen.getByRole('region', { name: 'Scheduled jobs' }),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        (order[i - 1] as HTMLElement).compareDocumentPosition(order[i] as HTMLElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  test('alerts: a row for each failed or overdue job and each unhealthy or stopped service', async () => {
    const p = props();
    api();
    renderFresh(<PhoneOverview {...p} />);
    const alerts = await screen.findByRole('region', { name: 'Alerts' });
    const rows = within(alerts).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('price-watch failed'),
      expect.stringContaining('photo-index overdue'),
      expect.stringContaining('Showtrack is unhealthy'),
      expect.stringContaining('Torrent stopped'),
    ]);
    fireEvent.click(rows[0] as HTMLElement);
    expect(p.onOpenJobs).toHaveBeenCalled();
    fireEvent.click(rows[2] as HTMLElement);
    expect(p.onOpenService).toHaveBeenCalledWith('s');
  });

  test('no alerts section when nothing needs attention', async () => {
    api({ '/api/cron': cron([job({ id: 'f', name: 'feed-sync' })]) });
    renderFresh(
      <PhoneOverview
        {...props({ status: statusResponse({ m: 'healthy', s: 'healthy', t: 'healthy' }) })}
      />,
    );
    await screen.findByText('Nothing needs attention');
    expect(screen.queryByRole('region', { name: 'Alerts' })).toBeNull();
  });

  test('health counts show each status that has services, with its word', async () => {
    api();
    renderFresh(<PhoneOverview {...props()} />);
    const health = await screen.findByRole('region', { name: 'Health' });
    expect(within(health).getByText('Healthy').nextElementSibling?.textContent).toContain('1');
    expect(within(health).getByText('Unhealthy')).toBeTruthy();
    expect(within(health).getByText('Stopped')).toBeTruthy();
    expect(within(health).queryByText('Starting')).toBeNull();
  });

  test('Markets has one row per coin with name, symbol, price and a coloured change', async () => {
    api();
    renderFresh(<PhoneOverview {...props()} />);
    const section = await screen.findByRole('region', { name: 'Markets' });
    const rows = await within(section).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Alphacoin');
    expect(rows[0]?.textContent).toContain('AAA');
    expect(rows[0]?.textContent).toContain('£61,240');
    expect(rows[0]?.textContent).toContain('+1.2 %');
    expect(rows[1]?.textContent).toContain('−0.4 %');
    expect(rows[0]?.querySelector('[data-direction="up"]')).not.toBeNull();
    expect(rows[1]?.querySelector('[data-direction="down"]')).not.toBeNull();
  });

  test('Markets interval control switches the change without a request', async () => {
    const spy = api();
    renderFresh(<PhoneOverview {...props()} />);
    const section = await screen.findByRole('region', { name: 'Markets' });
    await within(section).findAllByRole('listitem');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const before = spy.mock.calls.length;
    fireEvent.click(within(section).getByRole('combobox', { name: 'Interval' }));
    fireEvent.click(await screen.findByRole('option', { name: '7 days' }));
    expect(await within(section).findByText('−3.4 %')).toBeTruthy();
    expect(spy.mock.calls.length).toBe(before);
  });

  test('Links are 48 px rows with the hostname under the name, opening in the browser', async () => {
    api();
    renderFresh(<PhoneOverview {...props()} />);
    const link = (await screen.findByRole('link', { name: /Example Wiki/ })) as HTMLAnchorElement;
    expect(link.href).toBe('https://wiki.example.invalid/page');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.className).toContain('min-h-12');
    expect(within(link).getByText('wiki.example.invalid')).toBeTruthy();
    expect(within(link).getByText('EW')).toBeTruthy();
  });

  test('the jobs card lists what needs attention and opens the Jobs view', async () => {
    const p = props();
    api();
    renderFresh(<PhoneOverview {...p} />);
    const card = await screen.findByRole('region', { name: 'Scheduled jobs' });
    expect(await within(card).findByText('price-watch')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /Open scheduled jobs/ }));
    expect(p.onOpenJobs).toHaveBeenCalled();
  });
});
