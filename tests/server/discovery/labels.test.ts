import { describe, expect, it } from 'vitest';
import { parseLabels } from '@/lib/server/discovery/labels';

const parse = (labels: Record<string, string>) => parseLabels('x', labels);
const codes = (labels: Record<string, string>) => parse(labels).warnings.map((w) => w.code);

describe('parseLabels defaults', () => {
  it('returns no fields and no warnings for an empty label set', () => {
    expect(parse({})).toEqual({ labels: {}, warnings: [] });
  });

  it('ignores labels outside the dashboard.* namespace', () => {
    const r = parse({ 'traefik.enable': 'true', 'com.docker.compose.service': 'x' });
    expect(r).toEqual({ labels: {}, warnings: [] });
  });

  it('parses every label into its typed field', () => {
    const r = parse({
      'dashboard.enable': 'true',
      'dashboard.name': 'Radarr',
      'dashboard.group': 'Automation',
      'dashboard.icon': 'radarr',
      'dashboard.url': 'https://radarr.example.invalid/web',
      'dashboard.router': 'radarr',
      'dashboard.lan.port': '7878',
      'dashboard.lan.path': '/web',
      'dashboard.embed': 'false',
      'dashboard.widget': 'radarr',
      'dashboard.widget.url': 'http://radarr:7878',
      'dashboard.widget.fields': 'wanted,missing,movies',
      'dashboard.order': '10',
      'dashboard.description': 'Movies',
      'dashboard.keywords': 'film, movies',
      'dashboard.health.url': 'http://radarr:7878/',
      'dashboard.health.path': '/ping',
    });
    expect(r.warnings).toEqual([]);
    expect(r.labels).toEqual({
      enable: true,
      name: 'Radarr',
      group: 'Automation',
      icon: 'radarr',
      url: 'https://radarr.example.invalid/web',
      router: 'radarr',
      lanPort: 7878,
      lanPath: '/web',
      embed: 'false',
      widget: 'radarr',
      widgetUrl: 'http://radarr:7878',
      widgetFields: ['wanted', 'missing', 'movies'],
      order: 10,
      description: 'Movies',
      keywords: ['film', 'movies'],
      healthUrl: 'http://radarr:7878/',
      healthPath: '/ping',
    });
  });

  it('carries the service id on every warning', () => {
    const w = parseLabels('svc-1', { 'dashboard.order': 'abc' }).warnings;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ code: 'LABEL_INVALID', serviceId: 'svc-1' });
  });

  it('never echoes the label value in a warning', () => {
    const w = parse({ 'dashboard.url': 'ftp://secret-host.example.invalid' }).warnings[0];
    expect(w?.message).not.toContain('secret-host');
    expect(w?.message).toContain('dashboard.url');
  });

  it('trims surrounding whitespace', () => {
    expect(parse({ 'dashboard.name': '  Plex ' }).labels.name).toBe('Plex');
  });
});

describe('dashboard.enable', () => {
  it('accepts true and false', () => {
    expect(parse({ 'dashboard.enable': 'true' }).labels.enable).toBe(true);
    expect(parse({ 'dashboard.enable': 'false' }).labels.enable).toBe(false);
  });
  it('ignores anything else', () => {
    const r = parse({ 'dashboard.enable': 'yes' });
    expect(r.labels.enable).toBeUndefined();
    expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
  });
});

describe('dashboard.name (up to 40 chars)', () => {
  it('accepts 40 characters', () => {
    expect(parse({ 'dashboard.name': 'n'.repeat(40) }).labels.name).toHaveLength(40);
  });
  it('ignores 41 characters with a warning', () => {
    const r = parse({ 'dashboard.name': 'n'.repeat(41) });
    expect(r.labels.name).toBeUndefined();
    expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
  });
  it('ignores an empty value', () => {
    expect(codes({ 'dashboard.name': '  ' })).toEqual(['LABEL_INVALID']);
  });
});

describe('dashboard.group (up to 32 chars)', () => {
  it('accepts 32 and ignores 33', () => {
    expect(parse({ 'dashboard.group': 'g'.repeat(32) }).labels.group).toHaveLength(32);
    const r = parse({ 'dashboard.group': 'g'.repeat(33) });
    expect(r.labels.group).toBeUndefined();
    expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
  });
});

describe('dashboard.description (up to 80 chars)', () => {
  it('accepts 80 and ignores 81', () => {
    expect(parse({ 'dashboard.description': 'd'.repeat(80) }).labels.description).toHaveLength(80);
    const r = parse({ 'dashboard.description': 'd'.repeat(81) });
    expect(r.labels.description).toBeUndefined();
    expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
  });
  it('treats an empty value as the empty default without a warning', () => {
    expect(parse({ 'dashboard.description': '' })).toEqual({ labels: {}, warnings: [] });
  });
});

describe('dashboard.icon', () => {
  it.each(['cleanuperr', 'plex', 'local:logo.svg', 'local:my_icon-2.png', 'lucide:house'])(
    'accepts %s',
    (icon) => {
      expect(parse({ 'dashboard.icon': icon }).labels.icon).toBe(icon);
    },
  );
  it.each([
    'Has Space',
    'UPPER',
    'local:',
    'local:../etc/passwd',
    'local:a/b.svg',
    'local:.hidden',
    'lucide:',
    'lucide:Has_Caps',
    'http://example.invalid/i.png',
    'a/b',
  ])('ignores %s', (icon) => {
    const r = parse({ 'dashboard.icon': icon });
    expect(r.labels.icon).toBeUndefined();
    expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
  });
});

describe('dashboard.url', () => {
  it('accepts http and https', () => {
    expect(parse({ 'dashboard.url': 'http://a.example.invalid' }).labels.url).toBe(
      'http://a.example.invalid',
    );
    expect(parse({ 'dashboard.url': 'https://a.example.invalid/web' }).labels.url).toBe(
      'https://a.example.invalid/web',
    );
  });
  it('accepts none', () => {
    expect(parse({ 'dashboard.url': 'none' }).labels.url).toBe('none');
  });
  it.each([
    'ftp://a.example.invalid',
    'javascript:alert(1)',
    '/relative',
    'a.example.invalid',
    'https://user:pw@a.example.invalid',
    'http://192.0.2.10',
    'https://192.0.2.10:8443/x',
    'http://127.0.0.1',
    'http://[2001:db8::1]/',
    'http://[::1]:8080',
    'http://2130706433/',
    'http://0x7f.1/',
  ])('ignores %s', (url) => {
    const r = parse({ 'dashboard.url': url });
    expect(r.labels.url).toBeUndefined();
    expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
  });
});

describe('dashboard.router', () => {
  it('accepts a Traefik router name', () => {
    expect(parse({ 'dashboard.router': 'qbittorrent' }).labels.router).toBe('qbittorrent');
    expect(parse({ 'dashboard.router': 'my_router-2' }).labels.router).toBe('my_router-2');
  });
  it.each(['has space', 'a.b', 'a/b', ''])('ignores %j', (router) => {
    expect(codes({ 'dashboard.router': router })).toEqual(['LABEL_INVALID']);
  });
});

describe('dashboard.lan.port (1-65535 or none)', () => {
  it('accepts the bounds and none', () => {
    expect(parse({ 'dashboard.lan.port': '1' }).labels.lanPort).toBe(1);
    expect(parse({ 'dashboard.lan.port': '65535' }).labels.lanPort).toBe(65535);
    expect(parse({ 'dashboard.lan.port': 'none' }).labels.lanPort).toBe('none');
  });
  it.each(['0', '65536', '70000', '-1', 'abc', '80.5', '8e3', '0x50', ''])('ignores %j', (port) => {
    const r = parse({ 'dashboard.lan.port': port });
    expect(r.labels.lanPort).toBeUndefined();
    expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
  });
});

describe.each([
  ['dashboard.lan.path', 'lanPath'],
  ['dashboard.health.path', 'healthPath'],
] as const)('%s', (label, field) => {
  it('accepts a path starting with a slash', () => {
    expect(parse({ [label]: '/web' }).labels[field]).toBe('/web');
    expect(parse({ [label]: '/' }).labels[field]).toBe('/');
  });
  it.each(['web', '//evil.example.invalid', '/a b', 'http://a.example.invalid/', '/a\nb', ''])(
    'ignores %j',
    (path) => {
      const r = parse({ [label]: path });
      expect(r.labels[field]).toBeUndefined();
      expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
    },
  );
});

describe('dashboard.embed', () => {
  it.each(['auto', 'true', 'false'])('accepts %s', (v) => {
    expect(parse({ 'dashboard.embed': v }).labels.embed).toBe(v);
  });
  it('ignores anything else', () => {
    const r = parse({ 'dashboard.embed': 'maybe' });
    expect(r.labels.embed).toBeUndefined();
    expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
  });
});

describe('dashboard.widget', () => {
  it.each([
    'seerr',
    'tautulli',
    'radarr',
    'sonarr',
    'prowlarr',
    'autobrr',
    'gotify',
    'qbittorrent',
  ])('accepts %s', (w) => {
    expect(parse({ 'dashboard.widget': w }).labels.widget).toBe(w);
  });
  it('accepts none', () => {
    expect(parse({ 'dashboard.widget': 'none' })).toEqual({
      labels: { widget: 'none' },
      warnings: [],
    });
  });
  it('gives WIDGET_UNKNOWN for an unsupported type and ignores it', () => {
    const r = parse({ 'dashboard.widget': 'plex' });
    expect(r.labels.widget).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: 'WIDGET_UNKNOWN', serviceId: 'x' });
    expect(r.warnings[0]?.message).not.toContain('plex');
  });
});

describe('dashboard.widget.url and dashboard.health.url', () => {
  it.each([
    ['dashboard.widget.url', 'widgetUrl'],
    ['dashboard.health.url', 'healthUrl'],
  ] as const)('%s accepts an internal URL and rejects IP literals', (label, field) => {
    expect(parse({ [label]: 'http://tautulli:8181/' }).labels[field]).toBe('http://tautulli:8181/');
    for (const bad of [
      'http://192.0.2.5:8181',
      'http://[2001:db8::5]/',
      'ftp://tautulli',
      'tautulli:8181',
    ]) {
      const r = parse({ [label]: bad });
      expect(r.labels[field]).toBeUndefined();
      expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
    }
  });
  it('dashboard.health.url accepts none', () => {
    expect(parse({ 'dashboard.health.url': 'none' }).labels.healthUrl).toBe('none');
  });
  it('dashboard.widget.url does not accept none', () => {
    expect(codes({ 'dashboard.widget.url': 'none' })).toEqual(['LABEL_INVALID']);
  });
});

describe('dashboard.widget.fields (up to 4)', () => {
  it('accepts 4 fields', () => {
    expect(parse({ 'dashboard.widget.fields': 'a,b,c,d' }).labels.widgetFields).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });
  it('keeps the first 4 of 5 and warns', () => {
    const r = parse({ 'dashboard.widget.fields': 'a,b,c,d,e' });
    expect(r.labels.widgetFields).toEqual(['a', 'b', 'c', 'd']);
    expect(r.warnings.map((w) => w.code)).toEqual(['LABEL_INVALID']);
  });
  it('trims entries and drops empty ones', () => {
    expect(parse({ 'dashboard.widget.fields': ' wanted , ,missing,' }).labels.widgetFields).toEqual(
      ['wanted', 'missing'],
    );
  });
  it('ignores the label when a key is malformed or nothing is left', () => {
    expect(codes({ 'dashboard.widget.fields': 'ok,bad key' })).toEqual(['LABEL_INVALID']);
    expect(codes({ 'dashboard.widget.fields': ' , ' })).toEqual(['LABEL_INVALID']);
  });
});

describe('dashboard.order', () => {
  it('accepts integers including negatives', () => {
    expect(parse({ 'dashboard.order': '10' }).labels.order).toBe(10);
    expect(parse({ 'dashboard.order': '-5' }).labels.order).toBe(-5);
    expect(parse({ 'dashboard.order': '0' }).labels.order).toBe(0);
  });
  it.each(['1.5', 'abc', '', '1e3', '99999999999999999999'])('ignores %j', (v) => {
    const r = parse({ 'dashboard.order': v });
    expect(r.labels.order).toBeUndefined();
    expect(r.warnings[0]?.code).toBe('LABEL_INVALID');
  });
});

describe('dashboard.keywords (up to 10)', () => {
  it('splits, trims and drops empty entries', () => {
    expect(parse({ 'dashboard.keywords': 'tv, series ,,' }).labels.keywords).toEqual([
      'tv',
      'series',
    ]);
  });
  it('accepts 10', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `k${i}`).join(',');
    expect(parse({ 'dashboard.keywords': ten }).labels.keywords).toHaveLength(10);
    expect(parse({ 'dashboard.keywords': ten }).warnings).toEqual([]);
  });
  it('keeps the first 10 of 11 and warns', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `k${i}`).join(',');
    const r = parse({ 'dashboard.keywords': eleven });
    expect(r.labels.keywords).toHaveLength(10);
    expect(r.labels.keywords?.[9]).toBe('k9');
    expect(r.warnings.map((w) => w.code)).toEqual(['LABEL_INVALID']);
  });
  it('treats an empty value as the empty default without a warning', () => {
    expect(parse({ 'dashboard.keywords': '' })).toEqual({ labels: {}, warnings: [] });
  });
});

describe('one bad label does not spoil the others', () => {
  it('keeps valid fields and warns once per invalid label', () => {
    const r = parse({
      'dashboard.enable': 'true',
      'dashboard.name': 'n'.repeat(41),
      'dashboard.order': 'x',
      'dashboard.group': 'Media',
    });
    expect(r.labels).toEqual({ enable: true, group: 'Media' });
    expect(r.warnings).toHaveLength(2);
  });
});
