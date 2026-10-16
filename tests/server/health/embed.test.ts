import { describe, expect, test } from 'vitest';
import { embedVerdict } from '@/lib/server/health/embed';

const frame = (xfo: string | null, csp: string | null) => ({ xfo, csp });

describe('embedVerdict', () => {
  test('no headers: allowed', () => {
    expect(embedVerdict('auto', true, frame(null, null))).toEqual({
      mode: 'auto',
      verdict: 'allowed',
      reason: null,
    });
  });

  test('no probe data: unknown, probe-failed', () => {
    expect(embedVerdict('auto', true, null)).toEqual({
      mode: 'auto',
      verdict: 'unknown',
      reason: 'probe-failed',
    });
  });

  test.each(['DENY', 'sameorigin', 'SAMEORIGIN', ' SameOrigin '])(
    'X-Frame-Options %s: blocked',
    (xfo) => {
      expect(embedVerdict('auto', true, frame(xfo, null))).toEqual({
        mode: 'auto',
        verdict: 'blocked',
        reason: 'x-frame-options',
      });
    },
  );

  test('a combined X-Frame-Options value is blocked if any value blocks', () => {
    expect(embedVerdict('auto', true, frame('SAMEORIGIN, SAMEORIGIN', null)).verdict).toBe(
      'blocked',
    );
  });

  test('ALLOW-FROM is obsolete and ignored by browsers: allowed', () => {
    expect(embedVerdict('auto', true, frame('ALLOW-FROM https://a.example.invalid', null))).toEqual(
      { mode: 'auto', verdict: 'allowed', reason: null },
    );
  });

  test.each([
    "frame-ancestors 'self'",
    "default-src 'self'; frame-ancestors 'self'; img-src *",
    "frame-ancestors 'none'",
    "Frame-Ancestors 'SELF'",
  ])('CSP %s: blocked', (csp) => {
    expect(embedVerdict('auto', true, frame(null, csp))).toEqual({
      mode: 'auto',
      verdict: 'blocked',
      reason: 'csp-frame-ancestors',
    });
  });

  test.each([
    'frame-ancestors *',
    "frame-ancestors 'self' https://dash.example.invalid",
    'frame-ancestors https://*.example.invalid',
  ])('CSP %s: allowed', (csp) => {
    expect(embedVerdict('auto', true, frame(null, csp))).toEqual({
      mode: 'auto',
      verdict: 'allowed',
      reason: null,
    });
  });

  test('CSP without frame-ancestors does not hide X-Frame-Options', () => {
    expect(embedVerdict('auto', true, frame('DENY', "default-src 'self'"))).toEqual({
      mode: 'auto',
      verdict: 'blocked',
      reason: 'x-frame-options',
    });
  });

  test("CSP frame-ancestors 'self' beats an X-Frame-Options allow", () => {
    expect(
      embedVerdict(
        'auto',
        true,
        frame('ALLOW-FROM https://a.example.invalid', "frame-ancestors 'self'"),
      ),
    ).toEqual({ mode: 'auto', verdict: 'blocked', reason: 'csp-frame-ancestors' });
  });

  test('CSP frame-ancestors * beats X-Frame-Options DENY', () => {
    expect(embedVerdict('auto', true, frame('DENY', 'frame-ancestors *'))).toEqual({
      mode: 'auto',
      verdict: 'allowed',
      reason: null,
    });
  });

  test('several policies: blocked when any of them blocks', () => {
    expect(
      embedVerdict('auto', true, frame(null, "frame-ancestors *, frame-ancestors 'self'")).reason,
    ).toBe('csp-frame-ancestors');
  });

  test('embed=true forces allowed even when blocked', () => {
    expect(embedVerdict('true', true, frame('DENY', "frame-ancestors 'none'"))).toEqual({
      mode: 'true',
      verdict: 'allowed',
      reason: 'label',
    });
    expect(embedVerdict('true', true, null).verdict).toBe('allowed');
  });

  test('embed=false is blocked by label', () => {
    expect(embedVerdict('false', true, frame(null, null))).toEqual({
      mode: 'false',
      verdict: 'blocked',
      reason: 'label',
    });
  });

  test('no URL is blocked with no-url, except that embed=false still reports its label', () => {
    expect(embedVerdict('auto', false, null)).toEqual({
      mode: 'auto',
      verdict: 'blocked',
      reason: 'no-url',
    });
    expect(embedVerdict('true', false, null).reason).toBe('no-url');
    expect(embedVerdict('false', false, null).reason).toBe('label');
  });
});
