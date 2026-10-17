import { describe, expect, it } from 'vitest';
import { chipTag } from '@/components/overview/circle';
import type { Chip } from '@/lib/client/reading';

const chip = (over: Partial<Chip>): Chip => ({
  id: 'alpha',
  name: 'Alpha',
  service: {} as Chip['service'],
  figure: null,
  state: 'ok',
  ...over,
});

describe('chipTag', () => {
  it('keeps the words on desktop', () => {
    expect(chipTag(chip({ state: 'warn' }), false)).toBe('degraded');
    expect(chipTag(chip({ figure: 'Healthy' }), false)).toBe('Healthy');
  });
  it('shortens or drops words on the phone so the name keeps its room', () => {
    expect(chipTag(chip({ state: 'warn' }), true)).toBe('!');
    expect(chipTag(chip({ figure: 'Healthy' }), true)).toBeNull();
    expect(chipTag(chip({ state: 'down' }), true)).toBe('down');
  });
  it('keeps numeric figures on both', () => {
    expect(chipTag(chip({ figure: '318' }), true)).toBe('318');
    expect(chipTag(chip({ figure: '↓ 1.2 MB/s' }), true)).toBe('↓ 1.2 MB/s');
    expect(chipTag(chip({}), true)).toBeNull();
  });
});
