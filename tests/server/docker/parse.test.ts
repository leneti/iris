import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContainers } from '@/lib/server/docker/parse';

const raw: unknown = JSON.parse(
  readFileSync(new URL('../../fixtures/docker/containers.json', import.meta.url), 'utf8'),
);
const all = parseContainers(raw);
const byName = (name: string) => {
  const found = all.find((c) => c.name === name);
  if (!found) throw new Error(`fixture has no container ${name}`);
  return found;
};

describe('parseContainers', () => {
  it('keeps only whitelisted fields', () => {
    const [c] = parseContainers(raw);
    expect(Object.keys(c ?? {}).sort()).toEqual([
      'failingStreak',
      'health',
      'labels',
      'name',
      'publicPorts',
      'service',
      'state',
      'statusText',
    ]);
    expect(JSON.stringify(c)).not.toMatch(
      /Mounts|Command|203\.0\.113\.|2001:db8|00:00:5e|NetworkSettings/,
    );
    expect(JSON.stringify(all)).not.toMatch(
      /Mounts|Command|203\.0\.113\.|2001:db8|00:00:5e|NetworkSettings|0\.0\.0\.0|not-a-real-token|sha256|\/srv\/example/,
    );
  });

  it('keeps every container and strips the leading slash from the name', () => {
    expect(all).toHaveLength((raw as unknown[]).length);
    expect(all.every((c) => !c.name.startsWith('/'))).toBe(true);
  });

  it('keeps only dashboard.* labels and traefik router rules', () => {
    expect(Object.keys(byName('moviebox').labels).sort()).toEqual([
      'dashboard.description',
      'dashboard.enable',
      'dashboard.group',
      'dashboard.health.path',
      'dashboard.icon',
      'dashboard.name',
      'dashboard.order',
      'dashboard.widget',
      'traefik.http.routers.moviebox.rule',
    ]);
    expect(Object.keys(byName('edge-tunnel').labels)).toEqual([]);
  });

  it('reads the Compose service name, null when the label is missing', () => {
    expect(byName('iris').service).toBe('dashboard');
    const [c] = parseContainers([{ Names: ['/loose'], State: 'running', Status: 'Up' }]);
    expect(c?.service).toBeNull();
  });

  it('keeps TCP published ports once across IPv4 and IPv6, sorted', () => {
    expect(byName('moviebox').publicPorts).toEqual([7878]);
    expect(byName('request-desk').publicPorts).toEqual([5055, 5056]);
  });

  it('drops UDP ports, unpublished ports and containers without ports', () => {
    expect(byName('indexer-hub').publicPorts).toEqual([9696]);
    expect(byName('streamhouse').publicPorts).toEqual([]);
  });

  it('maps Docker health and the failing streak', () => {
    expect(byName('moviebox')).toMatchObject({ health: 'healthy', failingStreak: 0 });
    expect(byName('showtrack')).toMatchObject({ health: 'unhealthy', failingStreak: 3 });
    expect(byName('profile-kit').health).toBe('starting');
    expect(byName('streamhouse')).toMatchObject({ health: 'none', failingStreak: 0 });
  });

  it('treats an unknown health word as none', () => {
    const [c] = parseContainers([
      { Names: ['/a'], State: 'running', Status: 'Up', Health: { Status: 'weird' } },
    ]);
    expect(c?.health).toBe('none');
  });

  it('keeps state and status text', () => {
    expect(byName('self-heal')).toMatchObject({
      state: 'exited',
      statusText: 'Exited (0) 2 hours ago',
    });
  });

  it('throws when the reply is not a list', () => {
    expect(() => parseContainers({ message: 'nope' })).toThrow(/list/);
    expect(() => parseContainers(null)).toThrow(/list/);
  });

  it('skips entries it cannot read and tolerates null labels', () => {
    const out = parseContainers([
      'text',
      null,
      { Names: [] },
      { State: 'running' },
      { Names: ['/ok'], State: 'running', Status: 'Up', Labels: null, Ports: null },
    ]);
    expect(out).toEqual([
      {
        name: 'ok',
        service: null,
        labels: {},
        state: 'running',
        statusText: 'Up',
        health: 'none',
        failingStreak: 0,
        publicPorts: [],
      },
    ]);
  });

  it('ignores label values that are not strings', () => {
    const [c] = parseContainers([
      { Names: ['/a'], State: 'running', Status: 'Up', Labels: { 'dashboard.enable': true } },
    ]);
    expect(c?.labels).toEqual({});
  });
});
