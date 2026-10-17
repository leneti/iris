'use client';

/**
 * Notices a frame that its app sent to a page Iris may not frame, which is how a sign-in page
 * (Cloudflare Access, an app's own SSO) shows up: the redirect leaves the origins in Iris's
 * `frame-src`, the browser blocks it and fires `securitypolicyviolation` on this document.
 *
 * The event does not say which frame it was. Firefox reports the frame's own origin, so it is
 * matched by origin. Chromium reports the redirect target, so with one frame loading it is that
 * one; with several, each is checked again on its own with a hidden probe frame.
 */

const PROBE_TIMEOUT_MS = 10_000;
/** A frame still loading after this long is no longer a candidate (Firefox never fires `load`). */
const PENDING_MS = 15_000;

export type ProbeResult = 'ok' | 'sign-in' | 'unknown';

type Pending = { origin: string; since: number; onSignIn: () => void };
type Probe = { origin: string; finish: (r: ProbeResult) => void };

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export class FrameWatch {
  private readonly pending = new Map<symbol, Pending>();
  private probe: Probe | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listening = false;

  constructor(
    private readonly doc: Document,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * A frame starts loading `url`. Call the returned function when it fires `load`. `onSignIn` runs
   * at most once, when the frame is found to have been sent to a sign-in page.
   */
  track(url: string, onSignIn: () => void): () => void {
    const origin = originOf(url);
    if (origin === null) return () => {};
    this.listen();
    const key = Symbol(origin);
    this.pending.set(key, { origin, since: this.now(), onSignIn });
    return () => this.pending.delete(key);
  }

  /** Loads `url`'s origin in a hidden frame, one probe at a time, and says where it ended up. */
  check(url: string): Promise<ProbeResult> {
    const origin = originOf(url);
    if (origin === null) return Promise.resolve('unknown');
    const run = () => this.runProbe(origin);
    const result = this.queue.then(run, run);
    this.queue = result;
    return result;
  }

  private listen() {
    if (this.listening) return;
    this.listening = true;
    this.doc.addEventListener('securitypolicyviolation', (e) => this.onViolation(e));
  }

  private live(): [symbol, Pending][] {
    const cutoff = this.now() - PENDING_MS;
    for (const [key, p] of this.pending) if (p.since < cutoff) this.pending.delete(key);
    return [...this.pending];
  }

  private onViolation(e: SecurityPolicyViolationEvent) {
    const directive = e.effectiveDirective || e.violatedDirective || '';
    if (!directive.startsWith('frame-src') && !directive.startsWith('child-src')) return;
    const blocked = originOf(e.blockedURI);
    const frames = this.live();
    const probe = this.probe;

    if (probe && probe.origin === blocked) return probe.finish('sign-in');
    const matched = frames.filter(([, p]) => p.origin === blocked);
    if (matched.length > 0) return matched.forEach(([key]) => this.signIn(key));

    const candidates = frames.length + (probe ? 1 : 0);
    if (candidates === 1) {
      if (probe) return probe.finish('sign-in');
      const [key] = frames[0]!;
      return this.signIn(key);
    }
    // Ambiguous: settle each loading frame with its own probe. A running probe can't tell.
    probe?.finish('unknown');
    for (const [key, p] of frames) {
      this.pending.delete(key);
      void this.check(p.origin).then((r) => {
        if (r === 'sign-in') p.onSignIn();
      });
    }
  }

  private signIn(key: symbol) {
    const p = this.pending.get(key);
    this.pending.delete(key);
    p?.onSignIn();
  }

  private runProbe(origin: string): Promise<ProbeResult> {
    return new Promise((resolve) => {
      this.listen();
      const frame = this.doc.createElement('iframe');
      // No scripts run in the probe; same-origin keeps the app's cookies in play.
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.dataset.irisProbe = '';
      frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
      let done = false;
      const finish = (r: ProbeResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (this.probe?.finish === finish) this.probe = null;
        frame.remove();
        resolve(r);
      };
      const timer = setTimeout(() => finish('unknown'), PROBE_TIMEOUT_MS);
      // Chromium fires `load` after the violation even for a blocked frame, so `load` alone,
      // with no violation before it, means the app answered.
      frame.addEventListener('load', () => finish('ok'));
      this.probe = { origin, finish };
      frame.src = `${origin}/favicon.ico`;
      this.doc.body.append(frame);
    });
  }
}

let shared: FrameWatch | null = null;

/** The page's one watcher. */
export function frameWatch(): FrameWatch {
  shared ??= new FrameWatch(document);
  return shared;
}
