import { describe, expect, test } from 'vitest';
import { direction } from '@/components/overview/markets';

describe('direction', () => {
  test('up, down, and flat when it rounds to zero or is missing', () => {
    expect(direction(1.2)).toBe('up');
    expect(direction(-0.4)).toBe('down');
    expect(direction(0.04)).toBe('flat');
    expect(direction(null)).toBe('flat');
    expect(direction(Number.NaN)).toBe('flat');
  });
});
