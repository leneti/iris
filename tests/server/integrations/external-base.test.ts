import { afterEach, describe, expect, test, vi } from 'vitest';
import { externalBase, type Adapter } from '@/lib/server/integrations/fetcher';

const external = { type: 'cloudflared', baseUrl: 'https://api.example.invalid' } as Adapter;
const internal = { type: 'radarr' } as Adapter;
const NAME = 'IRIS_DEV_EXTERNAL_BASE';

afterEach(() => vi.unstubAllEnvs());

function withEnv(nodeEnv: string, value: string | undefined): void {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (value !== undefined) vi.stubEnv(NAME, value);
}

describe('externalBase', () => {
  test('is the adapter origin without an override, and null for an adapter without one', () => {
    withEnv('development', undefined);
    expect(externalBase(external)).toBe('https://api.example.invalid');
    expect(externalBase(internal)).toBeNull();
  });

  test.each(['development', 'test'])('%s: a loopback http origin replaces it', (mode) => {
    withEnv(mode, 'http://127.0.0.1:47481');
    expect(externalBase(external)).toBe('http://127.0.0.1:47481');
    withEnv(mode, 'http://localhost:47481/');
    expect(externalBase(external)).toBe('http://localhost:47481');
  });

  test('an https origin on any host is accepted', () => {
    withEnv('development', 'https://fixtures.example.invalid');
    expect(externalBase(external)).toBe('https://fixtures.example.invalid');
  });

  test('production ignores it, even when it is valid', () => {
    withEnv('production', 'http://127.0.0.1:47481');
    expect(externalBase(external)).toBe('https://api.example.invalid');
  });

  test('an adapter with no external origin is not redirected by it', () => {
    withEnv('development', 'http://127.0.0.1:47481');
    expect(externalBase(internal)).toBeNull();
  });

  test.each([
    'http://api.example.invalid',
    'http://192.0.2.1:47481',
    'ftp://127.0.0.1',
    'http://127.0.0.1:47481/path',
    'http://127.0.0.1:47481/?q=1',
    'http://user:pass@127.0.0.1:47481',
    'http://127.0.0.1:47481#x',
    'localhost:47481',
    'not a url',
    '',
  ])('an invalid value (%s) is ignored', (value) => {
    withEnv('development', value);
    expect(externalBase(external)).toBe('https://api.example.invalid');
  });
});
