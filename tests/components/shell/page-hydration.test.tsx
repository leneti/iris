import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { defaultIrisConfig } from '@/lib/server/config/iris';
import { servicesOf, statusOf } from '../../helpers/reading';

// The page with the server's pieces replaced by fixed ones: no cookie, a seed of services and
// status, and the clock the server rendered at.
const SERVER_NOW = Date.UTC(2026, 9, 17, 13, 0);

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'localhost' }),
  cookies: async () => ({
    get: () => (jar.value === undefined ? undefined : { value: jar.value }),
  }),
}));
vi.mock('@/lib/server/seed', () => ({
  getSeed: async () => ({
    now: SERVER_NOW,
    data: {
      '/api/services': servicesOf([['Media', ['alpha', 'beta']]]),
      '/api/status': statusOf(['alpha', 'beta']),
    },
  }),
}));
vi.mock('@/lib/server/config/services', () => ({
  getConfigWatcher: () => ({ get: () => ({ iris: { config: defaultIrisConfig() } }) }),
}));
vi.mock('@/lib/server/env', () => ({ loadEnv: () => ({ zone: 'example.invalid' }) }));

const originalTz = process.env.TZ;
const setZone = (zone: string) => {
  process.env.TZ = zone;
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  jar.value = undefined;
});

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function renderPage() {
  const { default: Page } = await import('@/app/page');
  return <TooltipProvider>{await Page()}</TooltipProvider>;
}

describe('the page without an iris-tz cookie', () => {
  test('hydrates in a browser whose zone differs from the server', async () => {
    // 13:00 UTC: 22:00 in Tokyo, 06:00 in Los Angeles. The greeting differs by band and date.
    // The page runs on the server once; the browser receives its props, not a second run.
    setZone('Asia/Tokyo');
    const element = await renderPage();
    const html = renderToString(element);

    setZone('America/Los_Angeles');
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, element, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    await act(async () => root.unmount());
  });

  test('renders the greeting for the server zone when the cookie is missing or unknown', async () => {
    setZone('Asia/Tokyo');
    const none = renderToString(await renderPage());
    jar.value = 'Not/AZone';
    expect(renderToString(await renderPage())).toBe(none);
  });
});
