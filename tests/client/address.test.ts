import { describe, expect, test } from 'vitest';
import { addressMode, effectiveEmbed, frameUrl } from '@/lib/client/address';
import type { ServiceEntry } from '@/lib/shared/contract';

function entry(over: Partial<ServiceEntry>): ServiceEntry {
  return {
    id: 'radarr',
    name: 'Radarr',
    group: 'Media',
    description: null,
    keywords: [],
    order: 0,
    icon: { kind: 'lucide', name: 'film' },
    url: 'https://radarr.example.invalid/',
    urlSource: 'label',
    lan: null,
    embed: { mode: 'auto', verdict: 'allowed', reason: null, checkedAt: null },
    container: 'radarr',
    discovery: 'label',
    ...over,
  };
}

const radarr = entry({ lan: { port: 7878, path: '/', source: 'label' } });
const gotify = entry({ id: 'gotify', url: 'https://gotify.example.invalid/', lan: null });
const lanOnly = entry({
  id: 'nas',
  url: null,
  urlSource: 'none',
  lan: { port: 5000, path: '/ui', source: 'published-port' },
});

describe('addressMode (handoff 7.3)', () => {
  test('a host outside the zone, or an address, is lan', () => {
    expect(addressMode('192.0.2.10:3000', 'example.invalid')).toBe('lan');
    expect(addressMode('iris.lan', 'example.invalid')).toBe('lan');
    expect(addressMode('[2001:db8::1]:3000', 'example.invalid')).toBe('lan');
  });
  test('the zone itself and its subdomains are zone, ignoring port and case', () => {
    expect(addressMode('example.invalid', 'example.invalid')).toBe('zone');
    expect(addressMode('Iris.Example.Invalid:443', 'example.invalid')).toBe('zone');
    expect(addressMode('iris.example.invalid.', 'EXAMPLE.invalid')).toBe('zone');
  });
  test('a lookalike suffix is not the zone', () => {
    expect(addressMode('notexample.invalid', 'example.invalid')).toBe('lan');
    expect(addressMode('example.invalid.evil.test', 'example.invalid')).toBe('lan');
  });
  test('a null host or an unset zone is lan', () => {
    expect(addressMode(null, 'example.invalid')).toBe('lan');
    expect(addressMode('iris.example.invalid', undefined)).toBe('lan');
    expect(addressMode('iris.example.invalid', '')).toBe('lan');
  });
});

describe('frameUrl', () => {
  test('LAN mode builds the address from the page hostname and the LAN port', () => {
    expect(frameUrl(radarr, 'lan', '192.0.2.10')).toBe('http://192.0.2.10:7878/');
    expect(frameUrl(lanOnly, 'lan', 'iris.lan')).toBe('http://iris.lan:5000/ui');
  });
  test('an IPv6 hostname is bracketed', () => {
    expect(frameUrl(radarr, 'lan', '2001:db8::1')).toBe('http://[2001:db8::1]:7878/');
    expect(frameUrl(radarr, 'lan', '[2001:db8::1]')).toBe('http://[2001:db8::1]:7878/');
  });
  test('criterion 8.2: a service without lan opens at its public URL in LAN mode', () => {
    expect(frameUrl(gotify, 'lan', '192.0.2.10')).toBe('https://gotify.example.invalid/');
  });
  test('zone mode uses the public URL', () => {
    expect(frameUrl(radarr, 'zone', 'iris.example.invalid')).toBe(
      'https://radarr.example.invalid/',
    );
  });
  test('zone mode with only a LAN port is null (home network only)', () => {
    expect(frameUrl(lanOnly, 'zone', 'iris.example.invalid')).toBeNull();
  });
  test('no address at all is null', () => {
    expect(frameUrl(entry({ url: null, lan: null }), 'lan', '192.0.2.10')).toBeNull();
  });
});

describe('effectiveEmbed', () => {
  const allowed = radarr.embed;
  test('http frame on an https page becomes blocked/mixed-content', () => {
    expect(effectiveEmbed(radarr, 'https:', 'http://192.0.2.10:7878/')).toEqual({
      ...allowed,
      verdict: 'blocked',
      reason: 'mixed-content',
    });
  });
  test('other combinations keep the server verdict', () => {
    expect(effectiveEmbed(radarr, 'http:', 'http://192.0.2.10:7878/')).toEqual(allowed);
    expect(effectiveEmbed(radarr, 'https:', 'https://radarr.example.invalid/')).toEqual(allowed);
    expect(effectiveEmbed(radarr, 'https:', null)).toEqual(allowed);
  });
  test('an existing block keeps its own reason', () => {
    const blocked = entry({
      embed: { mode: 'auto', verdict: 'blocked', reason: 'x-frame-options', checkedAt: null },
    });
    expect(effectiveEmbed(blocked, 'https:', 'http://192.0.2.10:1/').reason).toBe(
      'x-frame-options',
    );
  });
});
