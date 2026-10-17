import { describe, expect, test } from 'vitest';
import { loadEnv } from '@/lib/server/env';

describe('loadEnv', () => {
  test('empty credential is not configured', () => {
    expect(loadEnv({ IRIS_RADARR_KEY: '' }).radarrKey).toBeUndefined();
  });
  test('credential is read', () => {
    expect(loadEnv({ IRIS_RADARR_KEY: 'abc' }).radarrKey).toBe('abc');
  });
  test('docker api version defaults to 1.52', () => {
    expect(loadEnv({}).dockerApiVersion).toBe('1.52');
  });
  test('dirs default', () => {
    const e = loadEnv({});
    expect(e.configDir).toBe('/config');
    expect(e.cacheDir).toBe('/cache');
  });
  test('allowed hosts are split, trimmed and lower-cased', () => {
    expect(
      loadEnv({ IRIS_ALLOWED_HOSTS: ' Iris.Example.invalid:8080, ,Other.example.invalid ' })
        .allowedHosts,
    ).toEqual(['iris.example.invalid:8080', 'other.example.invalid']);
    expect(loadEnv({}).allowedHosts).toEqual([]);
  });
  test('frame sources keep only the origins of https URLs with a host name', () => {
    const env = loadEnv({
      IRIS_FRAME_SOURCES: [
        'https://Media.Example.net:32400/web?x=1',
        'https://media.example.net:32400/other',
        'http://plain.example.net',
        'https://192.0.2.10:32400',
        'https://user:pw@creds.example.net',
        'https://bad host.example.net',
        'https://x.example.net; script-src *',
        'not a url',
        '',
      ].join(','),
    });
    expect(env.frameSources).toEqual(['https://media.example.net:32400']);
    expect(loadEnv({}).frameSources).toEqual([]);
  });

  test('result is frozen', () => {
    expect(Object.isFrozen(loadEnv({}))).toBe(true);
  });
});
