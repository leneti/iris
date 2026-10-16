import { describe, expect, test } from 'vitest';
import { scoreEntry } from '@/components/palette/score';

describe('scoreEntry', () => {
  test('non-adjacent letters match a keyword', () => {
    expect(scoreEntry('service:movies', 'rdr', ['Moviebox', 'Media', 'radarr'])).toBeGreaterThan(0);
  });
  test('a name that starts with the query beats a keyword that does', () => {
    expect(scoreEntry('service:a', 'rad', ['Radarr'])).toBeGreaterThan(
      scoreEntry('service:b', 'rad', ['Moviebox', 'radarr']),
    );
  });
  test('letters scattered across long text do not match', () => {
    expect(
      scoreEntry('service:s', 'router', ['Streamhouse', 'Media', 'stream.example.invalid']),
    ).toBe(0);
  });
  test('the value (id) is never searched', () => {
    expect(scoreEntry('service:tab-link', 'link', ['Moviebox'])).toBe(0);
  });
  test('an empty query matches everything', () => {
    expect(scoreEntry('x', '  ', ['x'])).toBe(1);
  });
});
