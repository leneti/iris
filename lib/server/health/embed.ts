import 'server-only';
import type { EmbedInfo } from '@/lib/shared/contract';
import type { ProbeResult } from './probe';

// Handoff §7.3. Mixed content is decided in the browser, which knows the page's scheme.

type Verdict = Pick<EmbedInfo, 'mode' | 'verdict' | 'reason'>;

/**
 * Every service is on another origin than the dashboard, so `'self'` and `'none'` block. Any other
 * source (`*`, a scheme, a host) is taken as allowing it: the dashboard's own address is not known
 * here, and a list that names hosts is written to let some other page frame the app.
 */
function cspBlocks(csp: string): boolean {
  for (const policy of csp.split(',')) {
    for (const directive of policy.split(';')) {
      const [name, ...sources] = directive.trim().split(/\s+/);
      if (name?.toLowerCase() !== 'frame-ancestors') continue;
      const tokens = sources.map((s) => s.toLowerCase());
      if (tokens.every((s) => s === "'self'" || s === "'none'")) return true;
    }
  }
  return false;
}

function cspHasFrameAncestors(csp: string): boolean {
  return csp
    .split(/[,;]/)
    .some((directive) => directive.trim().split(/\s+/)[0]?.toLowerCase() === 'frame-ancestors');
}

/** `ALLOW-FROM` is obsolete and ignored by browsers, so only these two values block. */
function xfoBlocks(xfo: string): boolean {
  return xfo
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .some((v) => v === 'deny' || v === 'sameorigin');
}

export function embedVerdict(
  mode: 'auto' | 'true' | 'false',
  hasUrl: boolean,
  frame: ProbeResult['frame'] | null,
): Verdict {
  if (mode === 'false') return { mode, verdict: 'blocked', reason: 'label' };
  if (!hasUrl) return { mode, verdict: 'blocked', reason: 'no-url' };
  if (mode === 'true') return { mode, verdict: 'allowed', reason: 'label' };
  if (frame === null) return { mode, verdict: 'unknown', reason: 'probe-failed' };

  // CSP frame-ancestors supersedes X-Frame-Options when both are present.
  if (frame.csp !== null && cspHasFrameAncestors(frame.csp)) {
    return cspBlocks(frame.csp)
      ? { mode, verdict: 'blocked', reason: 'csp-frame-ancestors' }
      : { mode, verdict: 'allowed', reason: null };
  }
  if (frame.xfo !== null && xfoBlocks(frame.xfo))
    return { mode, verdict: 'blocked', reason: 'x-frame-options' };
  return { mode, verdict: 'allowed', reason: null };
}
