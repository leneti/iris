import { describe, expect, test, vi } from 'vitest';
import { loadEnv } from '@/lib/server/env';
import { isAllowedHost, normalizeHost, securityHeaders } from '@/lib/server/headers';

const allowed = ['192.0.2.10:4747'];

describe('isAllowedHost(normalizeHost(h))', () => {
  test.each([
    ['192.0.2.10:4747', true],
    ['192.0.2.10:4748', false],
    ['192.0.2.10', false],
    [null, false],
    [undefined, false],
    ['', false],
    ['   ', false],
    ['www.example.invalid', false],
    ['EXAMPLE.INVALID.', false],
    ['[2001:db8::1]:4747', false],
    ['evil.example:4747', false],
    ['192.0.2.10:4747.', false],
    ['192.0.2.10.:4747', true],
    ['192.0.2.10..:4747', false],
    ['192.0.2.10:4747, evil.example', false],
    ['192.0.2.10:4747@evil.example', false],
  ])('%s allowed=%s', (h, ok) => {
    expect(isAllowedHost(normalizeHost(h ?? null), allowed)).toBe(ok);
  });

  test('an entry without a port matches only a Host without a port', () => {
    const list = ['example.invalid'];
    expect(isAllowedHost(normalizeHost('example.invalid'), list)).toBe(true);
    expect(isAllowedHost(normalizeHost('Example.Invalid.'), list)).toBe(true);
    expect(isAllowedHost(normalizeHost('example.invalid:80'), list)).toBe(false);
    expect(isAllowedHost(normalizeHost('example.invalid:443'), list)).toBe(false);
    expect(isAllowedHost(normalizeHost('www.example.invalid'), list)).toBe(false);
  });

  test('an IPv6 literal matches when listed exactly, brackets and port as written', () => {
    const list = ['[2001:db8::1]:4747'];
    expect(isAllowedHost(normalizeHost('[2001:DB8::1]:4747'), list)).toBe(true);
    expect(isAllowedHost(normalizeHost('[2001:db8::1]:4748'), list)).toBe(false);
    expect(isAllowedHost(normalizeHost('[2001:db8::1]'), list)).toBe(false);
  });

  test('an empty allowlist rejects everything', () => {
    expect(isAllowedHost(normalizeHost('192.0.2.10:4747'), [])).toBe(false);
  });
});

describe('normalizeHost', () => {
  test('lower-cases, strips one trailing dot before the port, keeps the port and brackets', () => {
    expect(normalizeHost('Example.INVALID.')).toBe('example.invalid');
    expect(normalizeHost('Example.INVALID.:8080')).toBe('example.invalid:8080');
    expect(normalizeHost('[2001:DB8::1]:4747')).toBe('[2001:db8::1]:4747');
    expect(normalizeHost('192.0.2.10:80')).toBe('192.0.2.10:80');
    expect(normalizeHost('example.invalid..')).toBe('example.invalid.');
  });
  test('missing or empty gives null', () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost('')).toBeNull();
    expect(normalizeHost(' ')).toBeNull();
    expect(normalizeHost('.')).toBeNull();
    expect(normalizeHost(':4747')).toBeNull();
  });
});

describe('securityHeaders', () => {
  const env = loadEnv({
    IRIS_ZONE: 'example.invalid',
    IRIS_ALLOWED_HOSTS: '192.0.2.10:4747,example.invalid',
  });
  const csp = (host: string, e = env) => securityHeaders(host, e)['Content-Security-Policy'] ?? '';

  test('frame-src includes the LAN host only when requested through it', () => {
    expect(csp('192.0.2.10:4747')).toContain(
      'frame-src https://*.example.invalid http://192.0.2.10:*',
    );
    expect(csp('example.invalid')).toContain('frame-src https://*.example.invalid;');
    expect(csp('example.invalid')).not.toContain('http://');
  });

  test('a host that is under the zone is not a LAN host', () => {
    const e = loadEnv({
      IRIS_ZONE: 'example.invalid',
      IRIS_ALLOWED_HOSTS: 'iris.example.invalid:8080',
    });
    expect(csp('iris.example.invalid:8080', e)).toContain('frame-src https://*.example.invalid;');
    expect(csp('iris.example.invalid:8080', e)).not.toContain('http://');
  });

  test('a host that is not in the allowlist gets no LAN frame-src', () => {
    expect(csp('192.0.2.99:4747')).not.toContain('http://');
  });

  test('no zone and a LAN host: frame-src is just the LAN host, never undefined', () => {
    const e = loadEnv({ IRIS_ALLOWED_HOSTS: '192.0.2.10:4747' });
    const value = csp('192.0.2.10:4747', e);
    expect(value).toContain('frame-src http://192.0.2.10:*;');
    expect(value).not.toContain('undefined');
    expect(value).not.toContain('https://*.');
  });

  test('no zone and no match: frame-src is none', () => {
    const e = loadEnv({});
    expect(csp('192.0.2.10:4747', e)).toContain("frame-src 'none';");
  });

  test('IPv6 LAN host keeps its brackets', () => {
    const e = loadEnv({ IRIS_ALLOWED_HOSTS: '[2001:db8::1]:4747' });
    expect(csp('[2001:db8::1]:4747', e)).toContain('frame-src http://[2001:db8::1]:*;');
  });

  test('a zone or host with CSP-significant characters is left out', () => {
    const e = loadEnv({
      IRIS_ZONE: 'example.invalid; script-src *',
      IRIS_ALLOWED_HOSTS: '192.0.2.10:4747',
    });
    expect(csp('192.0.2.10:4747', e)).not.toContain('script-src *');
  });

  test('fixed directives and the other headers', () => {
    const headers = securityHeaders('192.0.2.10:4747', env);
    const value = headers['Content-Security-Policy'] ?? '';
    for (const directive of [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ])
      expect(value.split('; ')).toContain(directive);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
  });
});

describe('script-src and unsafe-eval', () => {
  const env = loadEnv({ IRIS_ALLOWED_HOSTS: '192.0.2.10:4747' });
  const scriptSrc = () =>
    securityHeaders('192.0.2.10:4747', env)
      ['Content-Security-Policy']!.split('; ')
      .find((d) => d.startsWith('script-src'))!;

  test.each(['production', 'test'])('%s never allows eval', (mode) => {
    vi.stubEnv('NODE_ENV', mode);
    expect(scriptSrc()).not.toContain('unsafe-eval');
    vi.unstubAllEnvs();
  });

  test('development allows it for React', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(scriptSrc()).toContain("'unsafe-eval'");
    vi.unstubAllEnvs();
  });
});
