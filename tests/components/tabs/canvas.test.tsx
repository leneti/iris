import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ServiceEntry } from '@/lib/shared/contract';
import { svc } from '../shell/fixtures';
import { CanvasHarness, tabsOf } from './harness';

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));

const a = svc('a', 'Alpha');
const b = svc('b', 'Beta');
const blocked: ServiceEntry = {
  ...svc('t', 'Torrent Client', 'Downloads'),
  embed: { mode: 'auto', verdict: 'blocked', reason: 'x-frame-options', checkedAt: null },
};

const frameOf = (name: string) => screen.getByTitle(new RegExp(`^${name}`));

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('Canvas frames', () => {
  test('switching tabs keeps the same iframe DOM node (criterion 3.3)', () => {
    const view = render(<CanvasHarness tabs={tabsOf(['a', 'b'], 'a')} services={[a, b]} />);
    const before = frameOf('Alpha');
    view.rerender(<CanvasHarness tabs={tabsOf(['a', 'b'], 'b')} services={[a, b]} />);
    view.rerender(<CanvasHarness tabs={tabsOf(['a', 'b'], 'a')} services={[a, b]} />);
    const after = frameOf('Alpha');
    expect(after).toBe(before);
    expect(after.isConnected).toBe(true);
  });

  test('only the active frame is visible; the others are hidden, not removed', () => {
    const view = render(<CanvasHarness tabs={tabsOf(['a', 'b'], 'a')} services={[a, b]} />);
    expect(frameOf('Alpha').closest('[hidden]')).toBeNull();
    expect(frameOf('Beta').closest('[hidden]')).not.toBeNull();
    view.rerender(<CanvasHarness tabs={tabsOf(['a', 'b'], 'b')} services={[a, b]} />);
    expect(frameOf('Alpha').closest('[hidden]')).not.toBeNull();
    expect(frameOf('Beta').closest('[hidden]')).toBeNull();
  });

  test('opening another tab in the middle does not move existing frames', () => {
    const c = svc('c', 'Gamma');
    const view = render(
      <CanvasHarness tabs={tabsOf(['a', 'b'], 'a', ['a'])} services={[a, b, c]} />,
    );
    const alpha = frameOf('Alpha');
    const parent = alpha.parentElement!.parentElement!;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((m) => mutations.push(...m));
    observer.observe(parent, { childList: true, subtree: true });
    view.rerender(
      <CanvasHarness tabs={tabsOf(['a', 'b', 'c'], 'c', ['c', 'a', 'b'])} services={[a, b, c]} />,
    );
    observer.takeRecords().forEach((m) => mutations.push(m));
    observer.disconnect();
    const removed = mutations.flatMap((m) => [...m.removedNodes]);
    expect(removed).not.toContain(alpha);
    expect(frameOf('Alpha')).toBe(alpha);
  });

  test('every frame has the allow list, a title and no sandbox', () => {
    render(<CanvasHarness tabs={tabsOf(['a'], 'a')} services={[a]} />);
    const frame = frameOf('Alpha');
    expect(frame.getAttribute('allow')).toBe(
      'fullscreen; clipboard-write; picture-in-picture; autoplay',
    );
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(frame.getAttribute('title')).toBeTruthy();
    expect(frame.getAttribute('src')).toBe('http://127.0.0.1:8080/');
  });

  test('a suspended tab renders no iframe', () => {
    render(<CanvasHarness tabs={tabsOf(['a', 'b'], 'a', ['a'])} services={[a, b]} />);
    expect(screen.queryByTitle(/^Beta/)).toBeNull();
    expect(frameOf('Alpha')).toBeTruthy();
  });

  test('a blocked service renders the card and no iframe (criterion 3.4)', () => {
    render(<CanvasHarness tabs={tabsOf(['t'], 't')} services={[blocked]} />);
    expect(screen.queryByTitle(/^Torrent Client/)).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(
      screen.getByRole('heading', { name: /Torrent Client can.t be shown here/ }),
    ).toBeTruthy();
  });
});

describe('Canvas loading', () => {
  test('a skeleton shows until the frame fires load', () => {
    render(<CanvasHarness tabs={tabsOf(['a'], 'a')} services={[a]} />);
    expect(screen.getByText('Loading Alpha…')).toBeTruthy();
    // The status text must not sit inside an aria-hidden parent, or it is never announced.
    expect(screen.getByRole('status').closest('[aria-hidden="true"]')).toBeNull();
    fireEvent.load(frameOf('Alpha'));
    expect(screen.queryByText('Loading Alpha…')).toBeNull();
  });

  test('after 12 s without load the hint offers three actions (criterion 3.5)', () => {
    vi.useFakeTimers();
    render(<CanvasHarness tabs={tabsOf(['a'], 'a')} services={[{ ...a, lan: null }]} />);
    act(() => void vi.advanceTimersByTime(11_999));
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText(/Alpha is taking longer than usual/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep waiting' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in and retry' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in new tab' })).toBeTruthy();
  });

  test('the hint never shows once the frame has loaded', () => {
    vi.useFakeTimers();
    render(<CanvasHarness tabs={tabsOf(['a'], 'a')} services={[a]} />);
    fireEvent.load(frameOf('Alpha'));
    act(() => void vi.advanceTimersByTime(30_000));
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
  });

  test('"Keep waiting" dismisses the hint for good', () => {
    vi.useFakeTimers();
    render(<CanvasHarness tabs={tabsOf(['a'], 'a')} services={[a]} />);
    act(() => void vi.advanceTimersByTime(12_000));
    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
  });

  test('"Sign in and retry" is not offered on a LAN address', () => {
    vi.useFakeTimers();
    render(<CanvasHarness tabs={tabsOf(['a'], 'a')} services={[a]} />);
    act(() => void vi.advanceTimersByTime(12_000));
    expect(screen.queryByRole('button', { name: 'Sign in and retry' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open in new tab' })).toBeTruthy();
  });
});

describe('Canvas sign-in panel', () => {
  const violation = () =>
    act(() => {
      document.dispatchEvent(
        Object.assign(new Event('securitypolicyviolation'), {
          effectiveDirective: 'frame-src',
          blockedURI: 'https://team.example.net/cdn-cgi/access/login',
        }),
      );
    });
  const zone = (tabs = tabsOf(['a'], 'a')) => (
    <CanvasHarness tabs={tabs} services={[a]} mode="zone" protocol="https:" />
  );

  test('a frame sent to a sign-in page shows the panel; Sign in opens the window', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    render(zone());
    violation();
    expect(screen.getByRole('heading', { name: 'Alpha needs you to sign in' })).toBeTruthy();
    expect(open).not.toHaveBeenCalled(); // no fresh click, so no window by itself
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(open).toHaveBeenCalledWith('https://a.example.invalid/', '_blank', expect.any(String));
    expect(screen.getByRole('heading', { name: 'Signing in to Alpha…' })).toBeTruthy();
  });

  test('a fresh click opens the window straight away', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    Object.defineProperty(navigator, 'userActivation', {
      value: { isActive: true },
      configurable: true,
    });
    render(zone());
    violation();
    expect(open).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Signing in to Alpha…' })).toBeTruthy();
    Reflect.deleteProperty(navigator, 'userActivation');
  });

  test('a blocked window says so and offers to try again', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(zone());
    violation();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText(/blocked the sign-in window/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  test('a frame that loaded is not blamed for a later violation', () => {
    render(zone());
    fireEvent.load(frameOf('Alpha'));
    violation();
    expect(screen.queryByRole('heading', { name: /needs you to sign in/ })).toBeNull();
  });
});
