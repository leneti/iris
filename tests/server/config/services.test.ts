import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';

vi.mock('@/lib/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import {
  createConfigWatcher,
  getConfigWatcher,
  loadManualServices,
} from '@/lib/server/config/services';

const tmp = join(process.cwd(), '.tmp');
function dirWith(files: Record<string, string>): string {
  mkdirSync(tmp, { recursive: true });
  const dir = mkdtempSync(join(tmp, 'cfg-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
function put(dir: string, name: string, text: string, mtimeSec: number) {
  const p = join(dir, name);
  writeFileSync(p, text);
  utimesSync(p, mtimeSec, mtimeSec);
}

test('examples/services.yaml loads with no warnings', () => {
  const r = loadManualServices('examples', 'example.invalid');
  expect(r.state).toBe('ok');
  expect(r.warnings).toEqual([]);
  expect(r.services.map((s) => s.id)).toEqual(['vpn-gateway', 'edge-tunnel', 'example-link']);
});

test('missing services.yaml is reported as missing', () => {
  expect(loadManualServices(dirWith({}), 'example.invalid')).toEqual({
    services: [],
    warnings: [],
    state: 'missing',
  });
});

test('broken services.yaml is invalid, not thrown', () => {
  const dir = dirWith({ 'services.yaml': 'services: [\n' });
  const r = loadManualServices(dir, 'example.invalid');
  expect(r.state).toBe('invalid');
  expect(r.warnings[0]?.code).toBe('CONFIG_INVALID');
  expect(
    loadManualServices(dirWith({ 'services.yaml': 'services: [{id: a}]\n' }), undefined).state,
  ).toBe('invalid');
});

test('url handling: none, zone, bad scheme, duplicate id', () => {
  const dir = dirWith({
    'services.yaml': `version: 1
services:
  - { id: a, name: A, url: none }
  - { id: b, name: B, url: "https://b.{zone}/", embed: false }
  - { id: c, name: C, url: "ftp://c.example.invalid/" }
  - { id: a, name: Dup }
`,
  });
  const withZone = loadManualServices(dir, 'example.invalid');
  expect(withZone.services.map((s) => [s.id, s.url, s.embed])).toEqual([
    ['a', null, 'auto'],
    ['b', 'https://b.example.invalid/', 'false'],
    ['c', null, 'auto'],
  ]);
  expect(withZone.warnings.map((w) => [w.code, w.serviceId])).toEqual([
    ['SERVICE_URL_INVALID', 'c'],
    ['SERVICE_DUPLICATE', 'a'],
  ]);
  const noZone = loadManualServices(dir, undefined);
  expect(noZone.services[1]?.url).toBeNull();
  expect(noZone.warnings.map((w) => w.code)).toContain('SERVICE_URL_INVALID');
});

test('watcher reloads on mtime change and keeps the last good config', () => {
  const dir = dirWith({});
  put(dir, 'dashboard.yaml', 'title: One\n', 1000);
  put(dir, 'services.yaml', 'services:\n  - { id: a, name: A, url: none }\n', 1000);
  const w = createConfigWatcher(dir, 'example.invalid');
  expect(w.get().dashboard.config.title).toBe('One');
  expect(w.get().manual.services).toHaveLength(1);

  put(dir, 'dashboard.yaml', 'title: Two\n', 2000);
  expect(w.get().dashboard.config.title).toBe('Two');

  put(dir, 'dashboard.yaml', 'title: [broken\n', 3000);
  put(dir, 'services.yaml', 'services: [\n', 3000);
  const bad = w.get();
  expect(bad.dashboard.config.title).toBe('Two');
  expect(bad.dashboard.warnings.map((x) => x.code)).toContain('CONFIG_INVALID');
  expect(bad.manual.services).toHaveLength(1);
  expect(bad.manual.state).toBe('invalid');

  put(dir, 'dashboard.yaml', 'title: Three\n', 4000);
  expect(w.get().dashboard.config.title).toBe('Three');
});

test('watcher without a good config falls back to defaults', () => {
  const dir = dirWith({ 'dashboard.yaml': 'title: [x\n' });
  const w = createConfigWatcher(dir, undefined);
  expect(w.get().dashboard.config.title).toBe('Iris');
  expect(w.get().manual.state).toBe('missing');
});

test('getConfigWatcher is one lazy process-wide watcher built from the environment', () => {
  const dir = dirWith({});
  put(dir, 'dashboard.yaml', 'title: Shared\n', 1000);
  globalThis.__irisConfig = undefined;
  vi.stubEnv('DASHBOARD_CONFIG_DIR', dir);
  try {
    const a = getConfigWatcher();
    expect(getConfigWatcher()).toBe(a);
    expect(globalThis.__irisConfig).toBe(a);
    expect(a.get().dashboard.config.title).toBe('Shared');
  } finally {
    vi.unstubAllEnvs();
    globalThis.__irisConfig = undefined;
  }
});
