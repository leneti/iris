import { describe, expect, it } from 'vitest';
import { buildRouterMap, parseHostRule } from '@/lib/server/discovery/routers';

describe('parseHostRule', () => {
  it('takes the first host of an || rule', () => {
    expect(parseHostRule('Host(`a.example.invalid`) || Host(`b.example.invalid`)')).toBe(
      'a.example.invalid',
    );
  });
  it('takes the first host of a multi-argument Host', () => {
    expect(parseHostRule('Host(`a.example.invalid`, `b.example.invalid`)')).toBe(
      'a.example.invalid',
    );
  });
  it('finds Host beside other matchers', () => {
    expect(parseHostRule('Host(`a.example.invalid`) && PathPrefix(`/api`)')).toBe(
      'a.example.invalid',
    );
    expect(parseHostRule('PathPrefix(`/x`) && Host(`a.example.invalid`)')).toBe(
      'a.example.invalid',
    );
  });
  it('accepts double quotes and spacing', () => {
    expect(parseHostRule('Host( "a.example.invalid" )')).toBe('a.example.invalid');
  });
  it('lower-cases and drops a trailing dot', () => {
    expect(parseHostRule('Host(`A.Example.Invalid.`)')).toBe('a.example.invalid');
  });
  it('returns null for HostRegexp and HostSNI', () => {
    expect(parseHostRule('HostRegexp(`{sub:[a-z]+}.example.invalid`)')).toBeNull();
    expect(parseHostRule('HostSNI(`a.example.invalid`)')).toBeNull();
  });
  it('does not take a negated Host', () => {
    expect(parseHostRule('!Host(`a.example.invalid`)')).toBeNull();
    expect(parseHostRule('Host(`b.example.invalid`) && ! Host(`a.example.invalid`)')).toBe(
      'b.example.invalid',
    );
  });
  it('returns null for rules without a host and for junk', () => {
    expect(parseHostRule('PathPrefix(`/x`)')).toBeNull();
    expect(parseHostRule('')).toBeNull();
    expect(parseHostRule('Host()')).toBeNull();
    expect(parseHostRule('Host(`not a host`)')).toBeNull();
    expect(parseHostRule('Host(`{template}.example.invalid`)')).toBeNull();
  });
  it('never returns an IP literal', () => {
    expect(parseHostRule('Host(`192.0.2.10`)')).toBeNull();
    expect(parseHostRule('Host(`192.0.2.10`) || Host(`a.example.invalid`)')).toBe(
      'a.example.invalid',
    );
  });
});

describe('buildRouterMap', () => {
  it('maps a router name to its host and container', () => {
    const map = buildRouterMap([
      {
        container: 'gluetun',
        labels: { 'traefik.http.routers.qbittorrent.rule': 'Host(`torrent.example.invalid`)' },
      },
    ]);
    expect(map.get('qbittorrent')).toEqual({
      host: 'torrent.example.invalid',
      container: 'gluetun',
    });
  });
  it('collects several routers from several containers', () => {
    const map = buildRouterMap([
      {
        container: 'a',
        labels: { 'traefik.http.routers.one.rule': 'Host(`one.example.invalid`)' },
      },
      {
        container: 'b',
        labels: {
          'traefik.http.routers.two.rule': 'Host(`two.example.invalid`)',
          'traefik.http.routers.three.rule': 'Host(`three.example.invalid`)',
        },
      },
    ]);
    expect([...map.keys()].sort()).toEqual(['one', 'three', 'two']);
    expect(map.get('three')?.container).toBe('b');
  });
  it('skips routers whose rule has no plain Host', () => {
    const map = buildRouterMap([
      {
        container: 'a',
        labels: {
          'traefik.http.routers.rx.rule': 'HostRegexp(`{s:.+}.example.invalid`)',
          'traefik.http.routers.path.rule': 'PathPrefix(`/x`)',
          'traefik.http.routers.ok.rule': 'Host(`ok.example.invalid`)',
        },
      },
    ]);
    expect([...map.keys()]).toEqual(['ok']);
  });
  it('ignores other labels, including other router properties', () => {
    const map = buildRouterMap([
      {
        container: 'a',
        labels: {
          'traefik.http.routers.r.entrypoints': 'websecure',
          'traefik.http.routers.r.rule.extra': 'Host(`x.example.invalid`)',
          'traefik.tcp.routers.r.rule': 'Host(`x.example.invalid`)',
          'dashboard.name': 'x',
        },
      },
    ]);
    expect(map.size).toBe(0);
  });
  it('keeps the first definition when two containers share a router name', () => {
    const map = buildRouterMap([
      {
        container: 'first',
        labels: { 'traefik.http.routers.r.rule': 'Host(`a.example.invalid`)' },
      },
      {
        container: 'second',
        labels: { 'traefik.http.routers.r.rule': 'Host(`b.example.invalid`)' },
      },
    ]);
    expect(map.get('r')).toEqual({ host: 'a.example.invalid', container: 'first' });
  });
  it('returns an empty map for no entries', () => {
    expect(buildRouterMap([]).size).toBe(0);
  });
});
