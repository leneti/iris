import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FrameWatch } from '@/components/tabs/frame-watch';
import { startSignIn } from '@/components/tabs/sign-in';

const A = 'https://alpha.example.invalid/app';
const B = 'https://beta.example.invalid/';
const LOGIN = 'https://team.example.net/cdn-cgi/access/login';

function violation(blockedURI: string, directive = 'frame-src') {
  document.dispatchEvent(
    Object.assign(new Event('securitypolicyviolation'), {
      effectiveDirective: directive,
      violatedDirective: directive,
      blockedURI,
    }),
  );
}
const probes = () => [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-iris-probe]')];
const flush = () => new Promise((r) => setTimeout(r, 0));

let watch: FrameWatch;
beforeEach(() => {
  document.body.innerHTML = '';
  watch = new FrameWatch(document);
});
afterEach(() => vi.useRealTimers());

describe('FrameWatch', () => {
  test('Firefox reports the frame’s own origin: only that frame needs a sign-in', () => {
    const a = vi.fn();
    const b = vi.fn();
    watch.track(A, a);
    watch.track(B, b);
    violation('https://alpha.example.invalid');
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    expect(probes()).toHaveLength(0);
  });

  test('Chromium reports the login page: with one frame loading, it is that frame', () => {
    const a = vi.fn();
    watch.track(A, a);
    violation(LOGIN);
    expect(a).toHaveBeenCalledOnce();
  });

  test('a frame that fired load is no longer a candidate', () => {
    const a = vi.fn();
    const b = vi.fn();
    watch.track(A, a)();
    watch.track(B, b);
    violation(LOGIN);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  test('other directives are ignored', () => {
    const a = vi.fn();
    watch.track(A, a);
    violation(LOGIN, 'img-src');
    expect(a).not.toHaveBeenCalled();
  });

  test('ambiguous: each loading frame is probed on its own, one at a time', async () => {
    const a = vi.fn();
    const b = vi.fn();
    watch.track(A, a);
    watch.track(B, b);
    violation(LOGIN);
    await flush();
    expect(probes().map((p) => p.src)).toEqual(['https://alpha.example.invalid/favicon.ico']);
    expect(probes()[0]!.getAttribute('sandbox')).toBe('allow-same-origin');
    violation(LOGIN);
    await flush();
    await flush();
    expect(a).toHaveBeenCalledOnce();
    expect(probes().map((p) => p.src)).toEqual(['https://beta.example.invalid/favicon.ico']);
    probes()[0]!.dispatchEvent(new Event('load'));
    await flush();
    expect(b).not.toHaveBeenCalled();
    expect(probes()).toHaveLength(0);
  });

  test('check: load without a violation is ok, and the probe frame is removed', async () => {
    const result = watch.check(A);
    await flush();
    probes()[0]!.dispatchEvent(new Event('load'));
    await expect(result).resolves.toBe('ok');
    expect(probes()).toHaveLength(0);
  });

  test('check: a violation for its origin means sign-in, even in Chromium’s order', async () => {
    const result = watch.check(A);
    await flush();
    violation(LOGIN);
    probes()[0]?.dispatchEvent(new Event('load'));
    await expect(result).resolves.toBe('sign-in');
  });

  test('check: no answer in 10 s is unknown', async () => {
    vi.useFakeTimers();
    const result = watch.check(A);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBe('unknown');
  });
});

describe('startSignIn', () => {
  test('closes the popup once the check passes, then reports it closed', async () => {
    vi.useFakeTimers();
    const popup = { closed: false, opener: {}, close: vi.fn(() => (popup.closed = true)) };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const check = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const onClosed = vi.fn();
    const stop = startSignIn(A, onClosed, check);
    expect(stop).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(check).toHaveBeenCalledOnce();
    expect(popup.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(popup.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(onClosed).toHaveBeenCalledOnce();
  });

  test('a blocked popup returns null', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(startSignIn(A, vi.fn())).toBeNull();
  });
});
