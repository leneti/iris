// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { compassPoint } from '@/lib/client/weather';

describe('compassPoint', () => {
  test.each([
    [0, 'N'],
    [22.4, 'N'],
    [22.5, 'NE'],
    [90, 'E'],
    [135, 'SE'],
    [180, 'S'],
    [225, 'SW'],
    [270, 'W'],
    [315, 'NW'],
    [337.5, 'N'],
    [360, 'N'],
    [-45, 'NW'],
  ])('%s° is %s', (deg, point) => expect(compassPoint(deg)).toBe(point));
});
