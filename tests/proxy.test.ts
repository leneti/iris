import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { config, proxy } from '@/proxy';

function request(path: string, host: string | null): NextRequest {
  const headers = new Headers();
  if (host !== null) headers.set('host', host);
  return new NextRequest(`http://127.0.0.1:3000${path}`, { headers });
}

const matcher = (path: string): boolean =>
  config.matcher.some((source) => new RegExp(`^${source}$`).test(path));

describe('proxy', () => {
  beforeEach(() => {
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '192.0.2.10:4747');
    vi.stubEnv('DASHBOARD_ZONE', 'example.invalid');
  });
  afterEach(() => vi.unstubAllEnvs());

  test('an allowed host passes through with security headers', () => {
    const res = proxy(request('/', '192.0.2.10:4747'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('content-security-policy')).toContain(
      'frame-src https://*.example.invalid http://192.0.2.10:*',
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test.each([
    ['www.example.invalid'],
    ['192.0.2.10:4748'],
    ['192.0.2.10'],
    ['[2001:db8::1]:4747'],
    ['evil.example:4747'],
    [null],
    [''],
  ])('host %s gets 400 with a fixed plain-text body', async (host) => {
    const res = proxy(request('/', host));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    const body = await res.text();
    expect(body).toBe('Bad Request');
    if (host) expect(body).not.toContain(host);
  });

  test('host variants are normalised before the comparison', () => {
    expect(proxy(request('/', '192.0.2.10.:4747')).status).toBe(200);
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', 'iris.example.invalid');
    expect(proxy(request('/', 'IRIS.Example.Invalid.')).status).toBe(200);
    expect(proxy(request('/', 'www.example.invalid')).status).toBe(400);
  });

  test('the zone joins the allowlist with no code change', () => {
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '192.0.2.10:4747,example.invalid');
    const res = proxy(request('/_next/static/x', 'example.invalid'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).not.toContain('http://');
  });

  test('icon responses keep their own sandboxing CSP, never the dashboard one', () => {
    for (const path of [
      '/api/icons/di/x',
      '/api/icons/di/x.svg',
      '/api/icons/',
      '/API/Icons/di/x',
      '/api/%69cons/di/x',
      '/api/icons/%zz',
    ]) {
      const res = proxy(request(path, '192.0.2.10:4747'));
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-security-policy'), path).toBe("default-src 'none'; sandbox");
      expect(res.headers.get('content-security-policy'), path).not.toContain('script-src');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  test('similar paths outside /api/icons/ still get the dashboard CSP', () => {
    for (const path of ['/', '/api/iconsx', '/api/services', '/icons/x'])
      expect(
        proxy(request(path, '192.0.2.10:4747')).headers.get('content-security-policy'),
      ).toContain("script-src 'self' 'unsafe-inline'");
  });

  test('icons on a disallowed host still get 400', () => {
    expect(proxy(request('/api/icons/di/x', 'www.example.invalid')).status).toBe(400);
  });

  test('the 400 also covers static paths', () => {
    expect(proxy(request('/_next/static/x.js', 'www.example.invalid')).status).toBe(400);
    expect(proxy(request('/favicon.ico', 'www.example.invalid')).status).toBe(400);
  });
});

describe('config.matcher', () => {
  test('healthz is exempt from the allowlist', () => {
    expect(matcher('/api/healthz')).toBe(false);
  });
  test('everything else is covered, static files included', () => {
    for (const path of [
      '/',
      '/_next/static/x',
      '/_next/image',
      '/favicon.ico',
      '/api/services',
      '/api/healthz/extra',
      '/api/healthzx',
    ])
      expect(matcher(path), path).toBe(true);
  });
  test('proxy does not export runtime', async () => {
    const mod = await import('@/proxy');
    expect('runtime' in mod).toBe(false);
    expect('runtime' in config).toBe(false);
  });
});
