import { describe, expect, test } from 'vitest';
import {
  formatAge,
  formatBytes,
  formatDuration,
  formatPercent,
  formatRate,
} from '@/lib/client/format';

describe('format (placeholder figures from handoff 12.1)', () => {
  test('formatBytes uses decimal units and trims needless decimals', () => {
    expect(formatBytes(12.5e9)).toBe('12.5 GB');
    expect(formatBytes(32e9)).toBe('32 GB');
    expect(formatBytes(484e9)).toBe('484 GB');
    expect(formatBytes(2.6e12)).toBe('2.6 TB');
    expect(formatBytes(18.2e12)).toBe('18.2 TB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1500)).toBe('1.5 kB');
  });
  test('formatBytes handles null and bad input', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
  test('formatRate takes bits per second', () => {
    expect(formatRate(42.1e6)).toBe('42.1 Mb/s');
    expect(formatRate(3.2e6)).toBe('3.2 Mb/s');
    expect(formatRate(14.2e6)).toBe('14.2 Mb/s');
    expect(formatRate(900)).toBe('900 b/s');
    expect(formatRate(1.2e9)).toBe('1.2 Gb/s');
    expect(formatRate(null)).toBe('—');
  });
  test('formatAge reads like the mockups', () => {
    expect(formatAge(2)).toBe('just now');
    expect(formatAge(5)).toBe('5 s ago');
    expect(formatAge(40)).toBe('40 s ago');
    expect(formatAge(11 * 60)).toBe('11 min ago');
    expect(formatAge(3 * 3600 + 21 * 60)).toBe('3 h 21 min ago');
    expect(formatAge(3 * 3600)).toBe('3 h ago');
    expect(formatAge(26 * 3600)).toBe('1 d 2 h ago');
    expect(formatAge(-30)).toBe('just now');
    expect(formatAge(null)).toBe('—');
  });
  test('formatDuration for uptime', () => {
    expect(formatDuration((12 * 24 + 4) * 3600)).toBe('12 d 4 h');
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
    expect(formatDuration(90)).toBe('1 min');
    expect(formatDuration(null)).toBe('—');
  });
  test('formatPercent rounds to a whole number', () => {
    expect(formatPercent(23)).toBe('23 %');
    expect(formatPercent(85.6)).toBe('86 %');
    expect(formatPercent(null)).toBe('—');
  });
});
