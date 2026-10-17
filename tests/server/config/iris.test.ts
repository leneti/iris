import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';

vi.mock('@/lib/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { fillZone, loadIrisConfig, resolveLinks, type IrisConfig } from '@/lib/server/config/iris';

const tmp = join(process.cwd(), '.tmp');
function dirWith(files: Record<string, string>): string {
  mkdirSync(tmp, { recursive: true });
  const dir = mkdtempSync(join(tmp, 'cfg-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
function cfg(patch: Partial<IrisConfig>): IrisConfig {
  return { ...loadIrisConfig(dirWith({})).config, ...patch };
}

test('examples/iris.yaml loads with no warnings', () => {
  expect(loadIrisConfig('examples').warnings).toEqual([]);
});

test('a missing iris.yaml gives defaults', () => {
  const { config, warnings } = loadIrisConfig(dirWith({}));
  expect(config.defaultGroup).toBe('Other');
  expect(config.version).toBe(1);
  expect(config.phone.maxLiveFrames).toBe(3);
  expect(config.cron).toMatchObject({ staleAfterMinutes: 60, graceMinutes: 10 });
  expect(config.widgets.refreshSeconds).toEqual({
    default: 60,
    qbittorrent: 10,
    tautulli: 15,
    radarr: 300,
    prowlarr: 300,
    gotify: 300,
    cloudflared: 300,
    coinmarketcap: 1800,
  });
  expect(warnings).toEqual([]);
});

test('system block gets its defaults', () => {
  const { config } = loadIrisConfig(dirWith({ 'iris.yaml': 'system:\n  url: http://x\n' }));
  expect(config.system).toEqual({
    url: 'http://x',
    interface: 'auto',
    sensor: 'auto',
    disks: [],
    thresholds: { warn: 80, bad: 90 },
  });
});

test('an unknown key is a warning, not a failure', () => {
  const { config, warnings } = loadIrisConfig(
    dirWith({
      'iris.yaml': 'title: Mine\nphone:\n  maxLiveFrames: 2\n  bogus: 1\nextra: 1\n',
    }),
  );
  expect(config.title).toBe('Mine');
  expect(config.phone.maxLiveFrames).toBe(2);
  expect(warnings.map((w) => w.code)).toEqual(['CONFIG_UNKNOWN_KEY', 'CONFIG_UNKNOWN_KEY']);
  expect(warnings.map((w) => w.message).join()).toMatch(/phone\.bogus/);
});

test('an invalid iris.yaml gives defaults and a warning', () => {
  const a = loadIrisConfig(dirWith({ 'iris.yaml': 'phone: [1\n' }));
  expect(a.warnings[0]?.code).toBe('CONFIG_INVALID');
  expect(a.config.defaultGroup).toBe('Other');
  const b = loadIrisConfig(dirWith({ 'iris.yaml': 'version: 2\n' }));
  expect(b.warnings[0]?.code).toBe('CONFIG_INVALID');
});

test('non-http link is dropped with a warning', () => {
  const r = resolveLinks(
    cfg({ links: [{ name: 'Bad', abbr: 'BD', url: 'javascript:alert(1)' }] }),
    'example.invalid',
  );
  expect(r.links).toEqual([]);
  expect(r.warnings[0]?.code).toBe('LINK_INVALID');
});

test('links: zone filled, long abbr and unset zone dropped', () => {
  const r = resolveLinks(
    cfg({
      links: [
        { name: 'Staging', abbr: 'PS', url: 'https://staging.{zone}/' },
        { name: 'Long', abbr: 'ABCD', url: 'https://a.example.invalid/' },
      ],
    }),
    'example.invalid',
  );
  expect(r.links).toEqual([
    { name: 'Staging', abbr: 'PS', url: 'https://staging.example.invalid/' },
  ]);
  expect(r.warnings.map((w) => w.code)).toEqual(['LINK_INVALID']);
  const u = resolveLinks(
    cfg({ links: [{ name: 'S', abbr: 'S', url: 'https://s.{zone}/' }] }),
    undefined,
  );
  expect(u.links).toEqual([]);
  expect(u.warnings[0]?.code).toBe('LINK_INVALID');
});

test('{zone} is filled', () => {
  expect(fillZone('https://staging.{zone}/', 'example.invalid')).toBe(
    'https://staging.example.invalid/',
  );
  expect(fillZone('https://a.example.invalid/', undefined)).toBe('https://a.example.invalid/');
  expect(fillZone('https://a.{zone}/', undefined)).toBeNull();
});
