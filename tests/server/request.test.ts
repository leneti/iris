import { describe, expect, test } from 'vitest';
import { isPhoneRequest } from '@/lib/server/request';

const request = (init: Record<string, string>) => isPhoneRequest(new Headers(init));

describe('isPhoneRequest', () => {
  test('the client hint decides when it is sent', () => {
    expect(request({ 'sec-ch-ua-mobile': '?1' })).toBe(true);
    expect(request({ 'sec-ch-ua-mobile': '?0' })).toBe(false);
  });

  test('a desktop hint wins over a mobile-looking user agent', () => {
    expect(
      request({ 'sec-ch-ua-mobile': '?0', 'user-agent': 'Mozilla/5.0 (Linux; Android 15)' }),
    ).toBe(false);
  });

  test.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148',
    'Mozilla/5.0 (Linux; Android 15; Phone) Mobile Safari/537.36',
  ])('a mobile user agent without a hint: %s', (ua) => {
    expect(request({ 'user-agent': ua })).toBe(true);
  });

  test('a desktop user agent, or none, is not a phone', () => {
    expect(request({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0' })).toBe(false);
    expect(request({})).toBe(false);
  });
});
