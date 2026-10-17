import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ServiceEntry } from '@/lib/shared/contract';
import { defaultIrisConfig, type IrisConfig } from '@/lib/server/config/iris';
import { loadManualServices, type ManualService } from '@/lib/server/config/services';
import { parseContainers, type ContainerSummary } from '@/lib/server/docker/parse';
import {
  discover,
  toPublicService,
  type IconInput,
  type ResolvedService,
} from '@/lib/server/discovery/discover';
import fixture from '../../fixtures/docker/containers.json';

vi.mock('@/lib/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const containers = parseContainers(fixture);
type Manual = ReturnType<typeof loadManualServices>;
const noManual: Manual = { services: [], warnings: [], state: 'missing' };

const config: IrisConfig = {
  ...defaultIrisConfig(),
  groups: [
    { name: 'Media', icon: 'lucide:clapperboard' },
    { name: 'Automation', icon: 'lucide:workflow' },
    { name: 'Downloads', icon: 'lucide:download' },
    { name: 'Infrastructure', icon: 'lucide:server' },
    { name: 'Home', icon: 'lucide:house' },
  ],
};

const iconCalls: IconInput[] = [];
const resolveIcon = (s: IconInput) => {
  iconCalls.push(s);
  return { kind: 'lucide' as const, name: s.label ?? s.serviceName };
};

function run(
  overrides: Partial<{
    containers: ContainerSummary[];
    config: IrisConfig;
    manual: Manual;
    zone: string | undefined;
    docker: 'ok' | 'unreachable';
  }> = {},
) {
  return discover({
    containers,
    config,
    manual: noManual,
    zone: 'example.invalid',
    resolveIcon,
    ...overrides,
  });
}

function ctr(
  name: string,
  labels: Record<string, string>,
  extra: Partial<ContainerSummary> = {},
): ContainerSummary {
  return {
    name,
    service: name,
    labels,
    state: 'running',
    statusText: 'Up',
    health: 'none',
    failingStreak: 0,
    publicPorts: [],
    ...extra,
  };
}

const flat = (r: ReturnType<typeof run>): ResolvedService[] => r.groups.flatMap((g) => g.services);
function svc(r: ReturnType<typeof run>, id: string): ResolvedService {
  const found = flat(r).find((s) => s.id === id);
  if (!found) throw new Error(`no service ${id}`);
  return found;
}
const rule = (name: string, host: string) => ({
  [`traefik.http.routers.${name}.rule`]: `Host(\`${host}\`)`,
});

describe('discover: what is listed (criterion 1.6)', () => {
  it('lists only containers with iris.enable=true, with no name list', () => {
    const ids = flat(run())
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(
      [
        'indexer-hub',
        'moviebox',
        'notify',
        'profile-kit',
        'recipe-book',
        'release-grabber',
        'request-desk',
        'self-heal',
        'showtrack',
        'streamhouse',
        'subtitle-sync',
        'sysmon',
        'torrent-client',
        'watchlog',
      ].sort(),
    );
    for (const absent of ['iris', 'vpn-gateway', 'cron-status', 'edge-tunnel'])
      expect(ids).not.toContain(absent);
  });

  it('warns about an invalid iris.enable and does not list it', () => {
    const r = run({ containers: [ctr('odd', { 'iris.enable': 'yes' })] });
    expect(flat(r)).toHaveLength(0);
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'LABEL_INVALID', serviceId: 'odd' }),
    );
  });

  it('keeps the first of two containers with the same Compose service, with a warning', () => {
    const r = run({
      containers: [
        ctr('b-1', { 'iris.enable': 'true', 'iris.name': 'Second' }, { service: 'b' }),
        ctr('a-1', { 'iris.enable': 'true', 'iris.name': 'First' }, { service: 'b' }),
      ],
    });
    expect(flat(r).map((s) => s.name)).toEqual(['First']);
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'SERVICE_DUPLICATE', serviceId: 'b' }),
    );
  });

  it('uses the container name when there is no Compose service', () => {
    const r = run({
      containers: [ctr('loose', { 'iris.enable': 'true' }, { service: null })],
    });
    expect(flat(r)[0]).toMatchObject({ id: 'loose', container: 'loose' });
  });
});

describe('discover: address (criterion 1.3)', () => {
  it('derives the url from the container own Traefik router', () => {
    const s = svc(run(), 'moviebox');
    expect(s).toMatchObject({
      url: 'https://moviebox.example.invalid/',
      urlSource: 'traefik-router',
      container: 'moviebox',
      discovery: 'label',
    });
  });

  it('resolves qbittorrent-style entries through iris.router on another container', () => {
    const s = svc(run(), 'torrent-client');
    expect(s).toMatchObject({
      url: 'https://torrent-client.example.invalid/',
      urlSource: 'traefik-router',
      container: 'torrent-client',
    });
    expect(s.health).toEqual({
      kind: 'traefik',
      host: 'torrent-client.example.invalid',
      path: '/api/v2/app/version',
    });
  });

  it('lets iris.url win over a router', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          'iris.url': 'https://elsewhere.example.invalid/x',
          ...rule('a', 'a.example.invalid'),
        }),
      ],
    });
    expect(svc(r, 'a')).toMatchObject({
      url: 'https://elsewhere.example.invalid/x',
      urlSource: 'label',
    });
  });

  it('takes the only router when none is named like the service', () => {
    const r = run({
      containers: [ctr('a', { 'iris.enable': 'true', ...rule('web', 'a.example.invalid') })],
    });
    expect(svc(r, 'a').url).toBe('https://a.example.invalid/');
  });

  it('prefers the router named like the service when there are several', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          ...rule('other', 'other.example.invalid'),
          ...rule('a', 'a.example.invalid'),
        }),
      ],
    });
    expect(svc(r, 'a').url).toBe('https://a.example.invalid/');
    expect(r.warnings).toHaveLength(0);
  });

  it('warns when there are several routers and none is named like the service', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          ...rule('x', 'x.example.invalid'),
          ...rule('y', 'y.example.invalid'),
        }),
      ],
    });
    expect(svc(r, 'a')).toMatchObject({ url: null, urlSource: 'none' });
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'ROUTER_AMBIGUOUS', serviceId: 'a' }),
    );
  });

  it('warns ROUTER_NOT_FOUND when there is no url label and no router at all', () => {
    const r = run({ containers: [ctr('a', { 'iris.enable': 'true' })] });
    expect(svc(r, 'a')).toMatchObject({ url: null, urlSource: 'none' });
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'ROUTER_NOT_FOUND', serviceId: 'a' }),
    );
  });

  it('does not warn about a missing router when iris.url is set or none', () => {
    const r = run({
      containers: [
        ctr('a', { 'iris.enable': 'true', 'iris.url': 'none' }),
        ctr('b', { 'iris.enable': 'true', 'iris.url': 'https://b.example.invalid/' }),
      ],
    });
    expect(r.warnings).toHaveLength(0);
  });

  it('warns when the own router rule gives no Host (HostRegexp)', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          'traefik.http.routers.a.rule': 'HostRegexp(`{sub:[a-z]+}.example.invalid`)',
        }),
      ],
    });
    expect(svc(r, 'a')).toMatchObject({ url: null, urlSource: 'none' });
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'ROUTER_NO_HOST', serviceId: 'a' }),
    );
  });

  it('warns when iris.router names a router whose rule gives no Host', () => {
    const r = run({
      containers: [
        ctr('gate', { 'traefik.http.routers.t.rule': 'HostRegexp(`{x:.+}`)' }),
        ctr('a', { 'iris.enable': 'true', 'iris.router': 't' }),
      ],
    });
    expect(svc(r, 'a').url).toBeNull();
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'ROUTER_NO_HOST', serviceId: 'a' }),
    );
  });

  it('warns when iris.router names a router that does not exist', () => {
    const r = run({
      containers: [ctr('a', { 'iris.enable': 'true', 'iris.router': 'ghost' })],
    });
    expect(svc(r, 'a').url).toBeNull();
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'ROUTER_NOT_FOUND', serviceId: 'a' }),
    );
  });

  it('warns about an unresolved iris.router even when iris.url is set', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          'iris.router': 'ghost',
          'iris.url': 'https://a.example.invalid/',
        }),
      ],
    });
    expect(svc(r, 'a').url).toBe('https://a.example.invalid/');
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'ROUTER_NOT_FOUND' }));
  });
});

describe('discover: LAN port (criterion 1.7)', () => {
  it('derives the port from exactly one published port', () => {
    expect(svc(run(), 'moviebox').lan).toEqual({ port: 7878, path: '/', source: 'published-port' });
    expect(svc(run(), 'sysmon').lan).toEqual({ port: 61208, path: '/', source: 'published-port' });
  });

  it('lets the label win, with its path', () => {
    expect(svc(run(), 'streamhouse').lan).toEqual({ port: 47485, path: '/web', source: 'label' });
    expect(svc(run(), 'torrent-client').lan).toEqual({ port: 8080, path: '/', source: 'label' });
    // two published ports, the label picks one
    expect(svc(run(), 'request-desk').lan).toEqual({ port: 5055, path: '/', source: 'label' });
  });

  it('gives none for lan.port=none even when a port is published', () => {
    expect(svc(run(), 'subtitle-sync').lan).toBeNull();
  });

  it('gives none with no published port, and with several and no label', () => {
    expect(svc(run(), 'notify').lan).toBeNull();
    const r = run({
      containers: [ctr('a', { 'iris.enable': 'true' }, { publicPorts: [1001, 1002] })],
    });
    expect(svc(r, 'a').lan).toBeNull();
  });
});

describe('discover: unsafe paths', () => {
  const withPath = (labels: Record<string, string>, port = '8080') =>
    run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          'iris.lan.port': port,
          ...rule('a', 'a.example.invalid'),
          ...labels,
        }),
      ],
    });

  it('drops a lan.path that would leave the origin, with LABEL_INVALID', () => {
    const r = withPath({ 'iris.lan.path': '/\\evil.example.invalid/x' });
    expect(svc(r, 'a').lan).toEqual({ port: 8080, path: '/', source: 'label' });
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'LABEL_INVALID', serviceId: 'a' }),
    );
    expect(JSON.stringify(r.groups)).not.toContain('evil');
  });

  it('drops a health.path that would leave the origin, with LABEL_INVALID', () => {
    const r = withPath({ 'iris.health.path': '/\\evil.example.invalid/x' });
    expect(svc(r, 'a').health).toEqual({
      kind: 'traefik',
      host: 'a.example.invalid',
      path: '/',
    });
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'LABEL_INVALID', serviceId: 'a' }),
    );
  });

  it('keeps a path with .. that stays on the origin, normalised', () => {
    const r = withPath({
      'iris.lan.path': '/a/../b?x=1',
      'iris.health.path': '/up/../ping',
    });
    expect(svc(r, 'a').lan?.path).toBe('/b?x=1');
    expect(svc(r, 'a').health).toMatchObject({ path: '/ping' });
    expect(r.warnings).toHaveLength(0);
  });
});

describe('discover: health target and widget', () => {
  it('uses iris.health.url as a url target', () => {
    expect(svc(run(), 'sysmon').health).toEqual({
      kind: 'url',
      url: 'http://sysmon:61208/api/4/status',
    });
    expect(svc(run(), 'streamhouse').health).toEqual({
      kind: 'url',
      url: 'http://streamhouse:47485/web',
    });
  });

  it('otherwise routes through Traefik with the health path, default /', () => {
    expect(svc(run(), 'moviebox').health).toEqual({
      kind: 'traefik',
      host: 'moviebox.example.invalid',
      path: '/ping',
    });
    expect(svc(run(), 'request-desk').health).toEqual({
      kind: 'traefik',
      host: 'request-desk.example.invalid',
      path: '/',
    });
  });

  it('probes through the router even when iris.url=none', () => {
    expect(svc(run(), 'subtitle-sync')).toMatchObject({
      url: null,
      health: { kind: 'traefik', host: 'subtitle-sync.example.invalid', path: '/' },
    });
  });

  it('probes a file-provider route (Plex) through Traefik at the iris.url hostname', () => {
    const r = run({
      containers: [
        ctr('plex', {
          'iris.enable': 'true',
          'iris.url': 'https://plex.example.invalid/web',
          'iris.health.path': '/web',
        }),
      ],
    });
    expect(svc(r, 'plex')).toMatchObject({
      url: 'https://plex.example.invalid/web',
      urlSource: 'label',
      health: { kind: 'traefik', host: 'plex.example.invalid', path: '/web' },
    });
    expect(r.warnings).toEqual([]);
  });

  it('gives no target when the iris.url hostname is off the zone or no zone is set', () => {
    const labels = {
      'iris.enable': 'true',
      'iris.url': 'https://other.example.org/',
      'iris.health.path': '/web',
    };
    expect(svc(run({ containers: [ctr('a', labels)] }), 'a').health).toEqual({ kind: 'none' });
    const onZone = {
      ...labels,
      'iris.url': 'https://plex.example.invalid/web',
    };
    expect(svc(run({ containers: [ctr('a', onZone)], zone: undefined }), 'a').health).toEqual({
      kind: 'none',
    });
    // a lookalike suffix is not a subdomain, the zone itself is
    const lookalike = { ...labels, 'iris.url': 'https://notexample.invalid/' };
    expect(svc(run({ containers: [ctr('a', lookalike)] }), 'a').health).toEqual({ kind: 'none' });
    const apex = { ...labels, 'iris.url': 'https://example.invalid/' };
    expect(svc(run({ containers: [ctr('a', apex)] }), 'a').health).toMatchObject({
      kind: 'traefik',
      host: 'example.invalid',
    });
  });

  it('defaults the iris.url fallback path to / and prefers a router host over it', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          'iris.url': 'https://public.example.invalid/x',
        }),
        ctr('b', {
          'iris.enable': 'true',
          'iris.url': 'https://public.example.invalid/x',
          ...rule('b', 'b.example.invalid'),
        }),
        ctr('c', {
          'iris.enable': 'true',
          'iris.url': 'https://public.example.invalid/x',
          'iris.health.url': 'http://c:80/up',
        }),
        ctr('d', {
          'iris.enable': 'true',
          'iris.url': 'https://public.example.invalid/x',
          'iris.health.url': 'none',
        }),
      ],
    });
    expect(svc(r, 'a').health).toEqual({
      kind: 'traefik',
      host: 'public.example.invalid',
      path: '/',
    });
    expect(svc(r, 'b').health).toMatchObject({ host: 'b.example.invalid' });
    expect(svc(r, 'c').health).toEqual({ kind: 'url', url: 'http://c:80/up' });
    expect(svc(r, 'd').health).toEqual({ kind: 'none' });
  });

  it('drops an unsafe health.path on the iris.url fallback too', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          'iris.url': 'https://a.example.invalid/',
          'iris.health.path': '/\\evil.example.invalid/x',
        }),
      ],
    });
    expect(svc(r, 'a').health).toEqual({ kind: 'traefik', host: 'a.example.invalid', path: '/' });
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'LABEL_INVALID' }));
  });

  it('has no target with neither a health url nor a router', () => {
    expect(svc(run(), 'self-heal').health).toEqual({ kind: 'none' });
  });

  it('treats iris.health.url=none as no probe even with a router', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          'iris.health.url': 'none',
          ...rule('a', 'a.example.invalid'),
        }),
      ],
    });
    expect(svc(r, 'a').health).toEqual({ kind: 'none' });
  });

  it('puts the widget on the router host unless iris.widget.url is set', () => {
    expect(svc(run(), 'moviebox').widget).toEqual({
      type: 'radarr',
      url: null,
      host: 'moviebox.example.invalid',
      fields: null,
    });
    expect(svc(run(), 'streamhouse').widget).toEqual({
      type: 'tautulli',
      url: 'http://watchlog:8181',
      host: null,
      fields: null,
    });
    expect(svc(run(), 'torrent-client').widget).toMatchObject({
      type: 'qbittorrent',
      host: 'torrent-client.example.invalid',
    });
  });

  it('carries widget fields and gives no widget for none or unset', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          'iris.widget': 'radarr',
          'iris.widget.fields': 'wanted, missing',
          ...rule('a', 'a.example.invalid'),
        }),
        ctr('b', {
          'iris.enable': 'true',
          'iris.widget': 'none',
          'iris.url': 'none',
        }),
        ctr('c', { 'iris.enable': 'true', 'iris.url': 'none' }),
      ],
    });
    expect(svc(r, 'a').widget?.fields).toEqual(['wanted', 'missing']);
    expect(svc(r, 'b').widget).toBeNull();
    expect(svc(r, 'c').widget).toBeNull();
  });

  it('drops a widget that has no way to be reached, with a warning', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          'iris.widget': 'radarr',
          'iris.url': 'none',
        }),
      ],
    });
    expect(svc(r, 'a').widget).toBeNull();
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'WIDGET_NO_TARGET', serviceId: 'a' }),
    );
  });
});

describe('discover: manual entries (criterion 1.4)', () => {
  const manual = (services: Partial<ManualService>[], extra: Partial<Manual> = {}): Manual => ({
    services: services.map((s) => ({
      id: 'x',
      name: 'X',
      keywords: [],
      order: 0,
      url: null,
      embed: 'auto',
      ...s,
    })),
    warnings: [],
    state: 'ok',
    ...extra,
  });

  it('lists a manual-only entry with discovery manual', () => {
    const r = run({
      manual: manual([
        {
          id: 'edge-tunnel',
          name: 'Edge Tunnel',
          group: 'Infrastructure',
          icon: 'cloudflare',
          description: 'Tunnel',
          container: 'edge-tunnel',
          url: 'https://dash.example.invalid/',
          embed: 'false',
          widget: { type: 'cloudflared' },
        },
      ]),
    });
    expect(r.sources.manual).toBe('ok');
    expect(svc(r, 'edge-tunnel')).toMatchObject({
      name: 'Edge Tunnel',
      group: 'Infrastructure',
      description: 'Tunnel',
      url: 'https://dash.example.invalid/',
      urlSource: 'manual',
      lan: null,
      container: 'edge-tunnel',
      containerName: 'edge-tunnel',
      discovery: 'manual',
      health: { kind: 'none' },
      widget: { type: 'cloudflared', url: null, host: null, fields: null },
      embed: { mode: 'false', verdict: 'blocked', reason: 'label', checkedAt: null },
    });
    expect(iconCalls.at(-1)).toMatchObject({
      label: 'cloudflare',
      serviceName: 'edge-tunnel',
      containerName: 'edge-tunnel',
    });
  });

  it('gives a url-less manual entry without a container urlSource none and no container', () => {
    const r = run({ manual: manual([{ id: 'gluetun', name: 'Gluetun', url: null }]) });
    expect(svc(r, 'gluetun')).toMatchObject({
      url: null,
      urlSource: 'none',
      container: null,
      containerName: null,
      group: 'Other',
      description: null,
      health: { kind: 'none' },
    });
  });

  it('gives a manual entry with a url and a container no HTTP target (Docker health only)', () => {
    const r = run({
      manual: manual([
        {
          id: 'cloudflared',
          url: 'https://dash.cloudflare.com/',
          container: 'cloudflared',
        },
        { id: 'link', url: 'https://link.example.invalid/page' },
      ]),
    });
    expect(svc(r, 'cloudflared')).toMatchObject({
      containerName: 'cloudflared',
      health: { kind: 'none' },
    });
    expect(svc(r, 'link').health).toEqual({ kind: 'none' });
  });

  it('lets the label win on an id clash, with a warning, and keeps the labelled entry', () => {
    const r = run({ manual: manual([{ id: 'moviebox', name: 'Manual Moviebox' }]) });
    expect(svc(r, 'moviebox')).toMatchObject({ name: 'Moviebox', discovery: 'label' });
    expect(flat(r).filter((s) => s.id === 'moviebox')).toHaveLength(1);
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'SERVICE_ID_CLASH', serviceId: 'moviebox' }),
    );
  });

  it('accepts a manual widget url and fields, and drops an unknown widget type', () => {
    const r = run({
      manual: manual([
        { id: 'm1', widget: { type: 'radarr', url: 'http://moviebox:7878', fields: ['wanted'] } },
        { id: 'm2', widget: { type: 'bogus' } },
        { id: 'm3', widget: { type: 'radarr' } },
      ]),
    });
    expect(svc(r, 'm1').widget).toEqual({
      type: 'radarr',
      url: 'http://moviebox:7878',
      host: null,
      fields: ['wanted'],
    });
    expect(svc(r, 'm2').widget).toBeNull();
    expect(svc(r, 'm3').widget).toBeNull();
    expect(r.warnings.map((w) => `${w.code}:${w.serviceId}`)).toEqual(
      expect.arrayContaining(['WIDGET_UNKNOWN:m2', 'WIDGET_NO_TARGET:m3']),
    );
  });

  it('passes the manual loader warnings and state through when services.yaml is broken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iris-discover-'));
    writeFileSync(join(dir, 'services.yaml'), 'services: [unclosed\n');
    const broken = loadManualServices(dir, 'example.invalid');
    expect(broken.state).toBe('invalid');
    const r = run({ manual: broken });
    expect(r.sources.manual).toBe('invalid');
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'CONFIG_INVALID' }));
    expect(flat(r).filter((s) => s.discovery === 'label').length).toBe(14);
  });
});

describe('discover: groups and order (criterion 1.5)', () => {
  it('follows iris.yaml order, unknown groups alphabetically, default Other', () => {
    const r = run({
      containers: [
        ctr('z', {
          'iris.enable': 'true',
          'iris.group': 'Zeta',
          'iris.url': 'none',
        }),
        ctr('a', {
          'iris.enable': 'true',
          'iris.group': 'Alpha',
          'iris.url': 'none',
        }),
        ctr('o', { 'iris.enable': 'true', 'iris.url': 'none' }),
        ctr('h', {
          'iris.enable': 'true',
          'iris.group': 'Home',
          'iris.url': 'none',
        }),
        ctr('m', {
          'iris.enable': 'true',
          'iris.group': 'Media',
          'iris.url': 'none',
        }),
      ],
    });
    expect(r.groups.map((g) => g.name)).toEqual(['Media', 'Home', 'Alpha', 'Other', 'Zeta']);
  });

  it('orders services by iris.order, then name', () => {
    const r = run({
      containers: [
        ctr('c', {
          'iris.enable': 'true',
          'iris.name': 'Charlie',
          'iris.url': 'none',
        }),
        ctr('b', {
          'iris.enable': 'true',
          'iris.name': 'bravo',
          'iris.url': 'none',
        }),
        ctr('d', {
          'iris.enable': 'true',
          'iris.name': 'Delta',
          'iris.order': '5',
          'iris.url': 'none',
        }),
        ctr('a', {
          'iris.enable': 'true',
          'iris.name': 'Alpha',
          'iris.url': 'none',
        }),
      ],
    });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]?.name).toBe('Other');
    expect(r.groups[0]?.services.map((s) => s.name)).toEqual([
      'Delta',
      'Alpha',
      'bravo',
      'Charlie',
    ]);
  });

  it('puts the fixture groups in configured order with Moviebox first in Automation', () => {
    const r = run();
    expect(r.groups.map((g) => g.name)).toEqual([
      'Media',
      'Automation',
      'Downloads',
      'Infrastructure',
      'Home',
    ]);
    expect(r.groups[1]?.services.slice(0, 2).map((s) => s.id)).toEqual(['moviebox', 'showtrack']);
  });

  it('gives each group its configured icon, and a default for an unconfigured one', () => {
    const r = run({
      containers: [
        ctr('a', {
          'iris.enable': 'true',
          'iris.group': 'Media',
          'iris.url': 'none',
        }),
        ctr('b', {
          'iris.enable': 'true',
          'iris.group': 'Nowhere',
          'iris.url': 'none',
        }),
      ],
    });
    expect(r.groups.map((g) => [g.name, g.icon])).toEqual([
      ['Media', 'lucide:clapperboard'],
      ['Nowhere', 'lucide:layout-grid'],
    ]);
  });

  it('omits configured groups with no services', () => {
    expect(run({ containers: [] }).groups).toEqual([]);
  });
});

describe('discover: fields and defaults', () => {
  it('fills defaults and parses lists', () => {
    expect(svc(run(), 'profile-kit')).toMatchObject({
      name: 'Profile Kit',
      group: 'Automation',
      description: null,
      keywords: ['profiles', 'quality'],
      order: 100,
      embed: { mode: 'auto', verdict: 'unknown', reason: null, checkedAt: null },
    });
    expect(svc(run(), 'moviebox')).toMatchObject({
      name: 'Moviebox',
      description: 'Movie Manager',
      order: 10,
    });
  });

  it('marks iris.embed=false as blocked by label', () => {
    expect(svc(run(), 'torrent-client').embed).toEqual({
      mode: 'false',
      verdict: 'blocked',
      reason: 'label',
      checkedAt: null,
    });
  });

  it('asks the icon resolver with the label, service, container and group icon', () => {
    iconCalls.length = 0;
    run();
    expect(iconCalls.find((c) => c.serviceName === 'moviebox')).toEqual({
      label: 'radarr',
      serviceName: 'moviebox',
      containerName: 'moviebox',
      groupIcon: 'lucide:workflow',
    });
    expect(iconCalls.find((c) => c.serviceName === 'profile-kit')?.label).toBeUndefined();
  });

  it('records the container name for server-side use', () => {
    expect(svc(run(), 'moviebox').containerName).toBe('moviebox');
  });
});

describe('discover: health-only entries', () => {
  it('url=none with no lan port has url null and lan null', () => {
    const s = svc(run(), 'self-heal');
    expect(s).toMatchObject({ url: null, urlSource: 'none', lan: null, container: 'self-heal' });
    expect(s.embed).toMatchObject({ verdict: 'blocked', reason: 'no-url' });
  });

  it('url=none with a lan port keeps the lan address', () => {
    expect(svc(run(), 'sysmon')).toMatchObject({
      url: null,
      urlSource: 'none',
      lan: { port: 61208 },
      embed: { verdict: 'unknown', reason: null },
    });
  });
});

describe('discover: links, sources and warnings', () => {
  it('fills links from iris.yaml and reports bad ones', () => {
    const r = run({
      config: {
        ...config,
        links: [
          { name: 'Example Forum', abbr: 'EF', url: 'https://forum.example.invalid/' },
          { name: 'Staging', abbr: 'PS', url: 'https://staging.{zone}/' },
          { name: 'Broken', abbr: 'BR', url: 'ftp://x.example.invalid/' },
        ],
      },
    });
    expect(r.links.map((l) => l.url)).toEqual([
      'https://forum.example.invalid/',
      'https://staging.example.invalid/',
    ]);
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'LINK_INVALID' }));
  });

  it('reports the Docker source', () => {
    expect(run().sources.docker).toBe('ok');
    expect(run({ docker: 'unreachable' }).sources.docker).toBe('unreachable');
  });

  it('has no warnings for the clean fixture', () => {
    expect(run().warnings).toEqual([]);
  });
});

describe('toPublicService (criterion 8.3)', () => {
  it('strips the server-only fields', () => {
    const s = toPublicService(svc(run(), 'moviebox'));
    expect(Object.keys(s).sort()).toEqual(
      [
        'container',
        'description',
        'discovery',
        'embed',
        'group',
        'icon',
        'id',
        'keywords',
        'lan',
        'name',
        'order',
        'url',
        'urlSource',
      ].sort(),
    );
    expect(s).not.toHaveProperty('health');
    expect(s).not.toHaveProperty('widget');
    expect(s).not.toHaveProperty('containerName');
  });

  it('every public service parses with the contract ServiceEntry schema', () => {
    const manual: Manual = {
      services: [
        {
          id: 'edge-tunnel',
          name: 'Edge Tunnel',
          keywords: [],
          order: 0,
          url: 'https://dash.example.invalid/',
          embed: 'false',
          container: 'edge-tunnel',
        },
      ],
      warnings: [],
      state: 'ok',
    };
    const all = flat(run({ manual }));
    expect(all.length).toBeGreaterThan(14);
    for (const s of all) {
      const parsed = ServiceEntry.safeParse(toPublicService(s));
      expect(parsed.success, `${s.id}: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
    }
  });

  it('marks the services listed in hidden, keeps them in their group, and warns about unknown ids', () => {
    const r = run({
      containers: [ctr('a', { 'iris.enable': 'true' }), ctr('b', { 'iris.enable': 'true' })],
      config: { ...config, hidden: ['b', 'missing'] },
    });
    const byId = new Map(flat(r).map((s) => [s.id, s]));
    expect(byId.get('a')).not.toHaveProperty('hidden');
    expect(byId.get('b')).toMatchObject({ hidden: true });
    expect(ServiceEntry.safeParse(toPublicService(byId.get('b')!)).success).toBe(true);
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'HIDDEN_UNKNOWN', serviceId: 'missing' }),
    );
  });

  it('public service output contains no IP-like string', () => {
    const r = run();
    const json = JSON.stringify(r.groups.map((g) => g.services.map(toPublicService)));
    expect(json).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(json).not.toMatch(/[0-9a-f]{0,4}:[0-9a-f]{0,4}:[0-9a-f:]+/i);
  });
});
