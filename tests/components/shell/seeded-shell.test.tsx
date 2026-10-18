import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';
import type { ShellSeed } from '@/components/shell/seed';
import { TooltipProvider } from '@/components/ui/tooltip';
import { lastOk } from '@/lib/client/source-health';
import { cronOf, servicesOf, statusOf, systemOf, widgetsOf } from '../../helpers/reading';

const SERVER_NOW = Date.UTC(2026, 9, 17, 13, 0);

const services = servicesOf([
  ['Media', ['alpha', 'beta']],
  ['Home', ['gamma']],
]);
const status = statusOf(['alpha', 'beta', 'gamma']);
const full: ShellSeed = {
  now: SERVER_NOW,
  data: {
    '/api/services': services,
    '/api/status': status,
    '/api/cron': cronOf([]),
    '/api/system': systemOf(),
    '/api/widgets': widgetsOf(),
  },
};
const minimal: ShellSeed = {
  now: SERVER_NOW,
  data: { '/api/services': services, '/api/status': status },
};

type Props = Parameters<typeof AppShell>[0];
const tree = (props: Props) => (
  <TooltipProvider>
    <AppShell {...props} />
  </TooltipProvider>
);

function matchMedia(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === '(max-width: 639px)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  matchMedia(false);
  // The polls that start on mount never answer; the seed is all the page has.
  vi.stubGlobal('fetch', () => new Promise(() => {}));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the server-rendered Overview', () => {
  test('a full seed gives the circle and the real sentence, not the pending text', () => {
    // The page always passes a zone; 13:00 UTC is the afternoon.
    const html = renderToString(tree({ mode: 'lan', seed: full, timeZone: 'UTC' }));
    expect(html).not.toContain('Reading the signs');
    for (const name of ['Alpha', 'Beta', 'Gamma']) expect(html).toContain(name);
    expect(html).toMatch(/Good afternoon\.|Afternoon!|Mid-day quadrant reached\./);
  });

  test('services and status alone are enough for the circle and the sentence', () => {
    const html = renderToString(tree({ mode: 'lan', seed: minimal }));
    expect(html).not.toContain('Reading the signs');
    expect(html).toContain('Alpha');
  });

  test('with no seed it is still reading', () => {
    const html = renderToString(tree({ mode: 'lan' }));
    expect(html).toContain('Reading the signs');
  });

  test('the greeting follows the zone given', () => {
    // 13:00 UTC is 02:00 the next day in Auckland.
    const html = renderToString(tree({ mode: 'lan', seed: full, timeZone: 'Pacific/Auckland' }));
    expect(html).toMatch(/Deep space silence\.|Quiet hours\.|Even the cron jobs are asleep\./);
  });

  test('a phone request gets the phone layout', () => {
    const phone = renderToString(tree({ mode: 'lan', seed: full, phoneHint: true }));
    const desktop = renderToString(tree({ mode: 'lan', seed: full }));
    expect(phone).not.toBe(desktop);
    expect(phone).not.toContain('role="tablist"');
    expect(desktop).toContain('role="tablist"');
  });
});

describe('hydrating the server-rendered Overview', () => {
  async function hydrate(props: Props, html: string) {
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, tree(props), {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    consoleError.mockRestore();
    return { container, root, errors };
  }

  const cases: [string, Props, boolean][] = [
    ['desktop, full seed', { mode: 'lan', seed: full }, false],
    ['desktop, services and status only', { mode: 'lan', seed: minimal }, false],
    [
      'desktop, a zone from the cookie',
      { mode: 'lan', seed: full, timeZone: 'Pacific/Auckland' },
      false,
    ],
    ['phone, hinted and confirmed', { mode: 'lan', seed: full, phoneHint: true }, true],
    ['phone, hinted but the screen is wide', { mode: 'lan', seed: full, phoneHint: true }, false],
  ];

  test.each(cases)('%s matches the HTML', async (_name, props, phoneScreen) => {
    const html = renderToString(tree(props));
    matchMedia(phoneScreen);
    const { root, errors } = await hydrate(props, html);
    expect(errors).toEqual([]);
    await act(async () => root.unmount());
  });

  test('seeded endpoints count as answered once mounted', async () => {
    const html = renderToString(tree({ mode: 'lan', seed: full }));
    const { root } = await hydrate({ mode: 'lan', seed: full }, html);
    for (const url of Object.keys(full.data)) expect(lastOk(url)).not.toBeNull();
    await act(async () => root.unmount());
  });

  test('the data stays on screen while the first poll is in flight', async () => {
    const html = renderToString(tree({ mode: 'lan', seed: full }));
    const { container, root } = await hydrate({ mode: 'lan', seed: full }, html);
    expect(container.textContent).not.toContain('Reading the signs');
    expect(container.textContent).toContain('Alpha');
    await act(async () => root.unmount());
  });
});
