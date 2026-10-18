// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { validTimeZone } from '@/lib/client/time-zone';

describe('validTimeZone', () => {
  test.each(['UTC', 'Europe/London', 'America/Argentina/Buenos_Aires'])('accepts %s', (zone) => {
    expect(validTimeZone(zone)).toBe(zone);
  });

  test('decodes a percent-encoded value', () => {
    expect(validTimeZone('Europe%2FLondon')).toBe('Europe/London');
  });

  test.each([undefined, null, '', 'Not/AZone', '%E0%A4%A', 'x'.repeat(100), '../etc/passwd'])(
    'ignores %s',
    (value) => {
      expect(validTimeZone(value)).toBeUndefined();
    },
  );
});
