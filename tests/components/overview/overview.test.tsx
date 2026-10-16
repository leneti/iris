import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Overview, type OverviewProps } from '@/components/overview/overview';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { StandaloneWidget } from '@/lib/shared/contract';
import { group, servicesResponse, svc } from '../shell/fixtures';
import { cron, job, mockApi, renderFresh, streams, system, widgets } from './fixtures';

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
  ],
};

const services = servicesResponse([
  group('Media', [svc('moviebox', 'Moviebox'), svc('showtrack', 'Showtrack')]),
  group('Home', [svc('notify', 'Notify')]),
]);

function props(over: Partial<OverviewProps> = {}): OverviewProps {
  return {
    services,
    statusById: { moviebox: 'healthy', showtrack: 'degraded', notify: 'healthy' },
    openIds: ['showtrack'],
    docker: { state: 'ok', ageSeconds: null },
    onOpenService: vi.fn(),
    onOpenJobs: vi.fn(),
    ...over,
  };
}

function api(over: Record<string, unknown> = {}) {
  return mockApi({
    '/api/widgets': widgets(),
    '/api/system': system(),
    '/api/streams': streams(),
    '/api/cron': cron([]),
    ...over,
  });
}

const show = (p: OverviewProps) =>
  renderFresh(
    <TooltipProvider>
      <Overview {...p} />
    </TooltipProvider>,
  );

// jsdom lacks the pointer and scroll APIs Radix Select uses.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('service tiles', () => {
  test('a failed integration says "Data unavailable" and keeps the health mark', async () => {
    api({
      '/api/widgets': widgets({
        services: {
          showtrack: { type: 'sonarr', state: 'unreachable', fetchedAt: null, stats: [] },
        },
      }),
    });
    show(props());
    const tile = await screen.findByRole('button', { name: /Showtrack/ });
    await waitFor(() => expect(within(tile).getByText('Data unavailable')).toBeTruthy());
    expect(within(tile).getByRole('img', { name: 'degraded' })).toBeTruthy();
  });

  test('the state decides, not fetchedAt: a failed read with an old fetchedAt is unavailable', async () => {
    api({
      '/api/widgets': widgets({
        services: {
          showtrack: {
            type: 'sonarr',
            state: 'unauthorized',
            fetchedAt: '2026-10-16T09:00:00.000Z',
            stats: [{ key: 'wanted', label: 'Wanted', value: 3, unit: null }],
          },
        },
      }),
    });
    show(props());
    const tile = await screen.findByRole('button', { name: /Showtrack/ });
    await waitFor(() => expect(within(tile).getByText('Data unavailable')).toBeTruthy());
    expect(within(tile).queryByText('Wanted')).toBeNull();
  });

  test('a service without an integration shows its description', async () => {
    api();
    show(
      props({
        services: servicesResponse([
          group('Media', [{ ...svc('moviebox', 'Moviebox'), description: 'Playback history' }]),
        ]),
      }),
    );
    expect(await screen.findByText('Playback history')).toBeTruthy();
  });

  test('shows at most four figures and Gotify "100+" when a next page exists', async () => {
    api({
      '/api/widgets': widgets({
        services: {
          notify: {
            type: 'gotify',
            state: 'ok',
            fetchedAt: '2026-10-16T10:25:00.000Z',
            stats: [
              { key: 'apps', label: 'Apps', value: 5, unit: null },
              { key: 'clients', label: 'Clients', value: 3, unit: null },
              { key: 'messages', label: 'Messages', value: 100, unit: null, atLeast: true },
              { key: 'a', label: 'Fourth', value: 1, unit: null },
              { key: 'b', label: 'Fifth', value: 1, unit: null },
            ],
          },
        },
      }),
    });
    show(props());
    expect(await screen.findByText('100+')).toBeTruthy();
    expect(screen.getByText('Fourth')).toBeTruthy();
    expect(screen.queryByText('Fifth')).toBeNull();
  });

  test('opens the service and marks open tabs', async () => {
    api();
    const p = props();
    show(p);
    const tile = await screen.findByRole('button', { name: /Moviebox/ });
    fireEvent.click(tile);
    expect(p.onOpenService).toHaveBeenCalledWith('moviebox');
    const open = screen.getByRole('button', { name: /Showtrack/ });
    expect(within(open).getByLabelText('Open in a tab')).toBeTruthy();
    expect(within(tile).queryByLabelText('Open in a tab')).toBeNull();
  });
});

describe('Markets', () => {
  test('switching the interval changes the sign and text and makes no request', async () => {
    const spy = api({ '/api/widgets': widgets({ standalone: [markets] }) });
    show(props());
    expect(await screen.findByText(/\+1\.2 %/)).toBeTruthy();
    // No health mark on a standalone tile.
    const tile = screen.getByRole('group', { name: 'Markets' });
    expect(within(tile).queryByRole('img', { name: 'healthy' })).toBeNull();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const before = spy.mock.calls.length;

    fireEvent.click(within(tile).getByRole('combobox', { name: 'Interval' }));
    fireEvent.click(await screen.findByRole('option', { name: '7 days' }));
    expect(await screen.findByText(/−3\.4 %/)).toBeTruthy();
    fireEvent.click(within(tile).getByRole('combobox', { name: 'Interval' }));
    fireEvent.click(await screen.findByRole('option', { name: '30 days' }));
    expect(await screen.findByText(/\+8 %/)).toBeTruthy();
    expect(spy.mock.calls.length).toBe(before);
  });

  test('the change is neutral text, not a status colour', async () => {
    api({ '/api/widgets': widgets({ standalone: [markets] }) });
    show(props());
    const change = await screen.findByText(/\+1\.2 %/);
    expect(change.className).not.toMatch(/status-|green|red/);
  });
});

describe('Links', () => {
  test('are anchors that open a new browser tab with the right rel', async () => {
    api();
    show(
      props({
        services: {
          ...services,
          links: [{ name: 'Example Wiki', abbr: 'EW', url: 'https://wiki.example.invalid/' }],
        },
      }),
    );
    const link = (await screen.findByRole('link', { name: /Example Wiki/ })) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://wiki.example.invalid/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.title).toBe('https://wiki.example.invalid/');
  });
});

describe('Weather', () => {
  test('shows temperature, condition word and place; hidden on a failed read', async () => {
    api({
      '/api/widgets': widgets({
        weather: {
          state: 'ok',
          fetchedAt: '2026-10-16T10:20:00.000Z',
          label: 'Hometown',
          temperature: 15.2,
          unit: 'celsius',
          condition: 'cloudy',
          isDay: true,
        },
      }),
    });
    const { unmount } = show(props());
    expect(await screen.findByText('Hometown')).toBeTruthy();
    expect(screen.getByText(/15 °C/)).toBeTruthy();
    expect(screen.getByText('Cloudy')).toBeTruthy();
    unmount();

    api({
      '/api/widgets': widgets({
        weather: {
          state: 'unreachable',
          fetchedAt: null,
          label: 'Hometown',
          temperature: null,
          unit: 'celsius',
          condition: null,
          isDay: null,
        },
      }),
    });
    show(props());
    await screen.findByRole('heading', { name: 'Overview' });
    await waitFor(() => expect(screen.queryByText('Hometown')).toBeNull());
  });
});

describe('System panel', () => {
  test('meters take warn and bad colours from level, and ok stays neutral', async () => {
    api();
    show(props());
    const fill = (name: string) =>
      screen
        .getByRole('progressbar', { name })
        .querySelector('[data-slot="progress-indicator"]') as HTMLElement;
    await screen.findByRole('progressbar', { name: 'CPU' });
    expect(fill('CPU').className).toContain('bg-meter-normal');
    expect(fill('Memory').className).toContain('bg-meter-warning');
    expect(fill('Media disk').className).toContain('bg-meter-critical');
  });

  test('says so when Glances is unreachable', async () => {
    api({ '/api/system': system({ source: { state: 'unreachable', fetchedAt: null } }) });
    show(props());
    expect(await screen.findByText('Unreachable')).toBeTruthy();
  });
});

describe('Now playing panel', () => {
  test('reads "Nothing is playing" with zero sessions', async () => {
    api();
    show(props());
    expect(await screen.findByText('Nothing is playing')).toBeTruthy();
  });

  test('reads "Not configured" when the source is not configured', async () => {
    api({ '/api/streams': streams({ source: { state: 'not-configured', fetchedAt: null } }) });
    show(props());
    expect(await screen.findByText('Not configured')).toBeTruthy();
    expect(screen.queryByText('Nothing is playing')).toBeNull();
  });

  test('lists a session with title, user, player, state and progress', async () => {
    api({
      '/api/streams': streams({
        streamCount: 1,
        sessions: [
          {
            id: '1',
            title: 'Example Show · S02 E05',
            mediaType: 'episode',
            user: 'alex',
            player: 'Living room TV',
            state: 'playing',
            progressPercent: 42,
            decision: 'transcode',
            location: 'lan',
          },
        ],
      }),
    });
    show(props());
    expect(await screen.findByText('Example Show · S02 E05')).toBeTruthy();
    expect(screen.getByText(/alex · Living room TV/)).toBeTruthy();
    expect(screen.getByText('Transcode')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Example Show · S02 E05' })).toBeTruthy();
  });
});

describe('Jobs card', () => {
  test('lists failed and overdue jobs first and links to the jobs view', async () => {
    api({
      '/api/cron': cron([
        job({ id: 'a', name: 'feed-sync' }),
        job({ id: 'b', name: 'price-watch', flag: 'failed', result: 'failed' }),
        job({ id: 'c', name: 'photo-index', flag: 'overdue' }),
      ]),
    });
    const p = props();
    show(p);
    const card = await screen.findByRole('region', { name: 'Scheduled jobs' });
    await within(card).findByText('price-watch');
    expect(within(card).getByText('photo-index')).toBeTruthy();
    expect(within(card).queryByText('feed-sync')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /Open scheduled jobs/ }));
    expect(p.onOpenJobs).toHaveBeenCalled();
  });
});
