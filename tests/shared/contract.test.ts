import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import * as c from '@/lib/shared/contract';

const load = (name: string): any =>
  JSON.parse(readFileSync(new URL(`../fixtures/contract/${name}.json`, import.meta.url), 'utf8'));

const schemas: Record<string, { safeParse: (v: unknown) => { success: boolean } }> = {
  services: c.ServicesResponse,
  status: c.StatusResponse,
  cron: c.CronResponse,
  system: c.SystemResponse,
  streams: c.StreamsResponse,
  widgets: c.WidgetsResponse,
  hostStatus: c.HostStatusFile,
};

test.each(Object.keys(schemas))('%s example parses', (name) => {
  expect(schemas[name]!.safeParse(load(name)).success).toBe(true);
});

describe('strictness', () => {
  const services = load('services');
  test('ServiceEntry rejects unknown keys', () => {
    expect(
      c.ServiceEntry.safeParse({ ...services.groups[0].services[0], labels: {} }).success,
    ).toBe(false);
  });
  test('responses reject unknown top-level keys', () => {
    for (const name of Object.keys(schemas)) {
      expect(schemas[name]!.safeParse({ ...load(name), extra: 1 }).success).toBe(false);
    }
  });
  test('host status accepts null times and nextRun', () => {
    const h = load('hostStatus');
    h.backup = { ...h.backup, lastStart: null, lastEnd: null, nextRun: null };
    h.updater = { ...h.updater, lastRun: null, nextRun: null };
    expect(c.HostStatusFile.safeParse(h).success).toBe(true);
  });
  test('EmbedInfo.mode is auto, true or false', () => {
    const embed = services.groups[0].services[0].embed;
    expect(c.EmbedInfo.safeParse({ ...embed, mode: 'false' }).success).toBe(true);
    expect(c.EmbedInfo.safeParse({ ...embed, mode: 'bogus' }).success).toBe(false);
  });
  test('IconRef variants', () => {
    expect(c.IconRef.safeParse({ kind: 'lucide', name: 'x' }).success).toBe(true);
    expect(
      c.IconRef.safeParse({ kind: 'local', file: 'a.svg', src: '/api/icons/l/a.svg' }).success,
    ).toBe(true);
    expect(c.IconRef.safeParse({ kind: 'lucide', name: 'x', src: 's' }).success).toBe(false);
  });
  test('dashboard-icons IconRef takes optional theme variants', () => {
    const base = { kind: 'dashboard-icons', slug: 'sonarr', src: '/api/icons/di/sonarr' };
    expect(c.IconRef.safeParse(base).success).toBe(true);
    expect(
      c.IconRef.safeParse({
        ...base,
        variants: { light: '/api/icons/di/sonarr-dark', dark: '/api/icons/di/sonarr-light' },
      }).success,
    ).toBe(true);
    expect(c.IconRef.safeParse({ ...base, variants: { dark: 'x' } }).success).toBe(true);
    expect(c.IconRef.safeParse({ ...base, variants: {} }).success).toBe(true);
    expect(c.IconRef.safeParse({ ...base, variants: { sepia: 'x' } }).success).toBe(false);
    expect(
      c.IconRef.safeParse({ kind: 'lucide', name: 'x', variants: { dark: 'x' } }).success,
    ).toBe(false);
  });
  test('Stat allows atLeast true only', () => {
    const base = { key: 'messages', label: 'Messages', value: 5, unit: null };
    expect(c.Stat.safeParse({ ...base, atLeast: true }).success).toBe(true);
    expect(c.Stat.safeParse({ ...base, atLeast: false }).success).toBe(false);
  });
});

// Ruling R49: the browser parses tolerantly (unknown keys dropped) so an additive field never
// breaks a page that is already open; the strict schemas above stay the server-side check.
describe('parseTolerant', () => {
  test('drops unknown keys at the top level, in arrays, records and discriminated unions', () => {
    const services = load('services');
    const service = services.groups[0].services[0];
    const noisy = {
      ...services,
      added: 1,
      groups: [
        {
          ...services.groups[0],
          added: 1,
          services: [
            { ...service, added: { deep: true }, icon: { ...service.icon, added: 'x' } },
            ...services.groups[0].services.slice(1),
          ],
        },
        ...services.groups.slice(1),
      ],
    };
    expect(c.ServicesResponse.safeParse(noisy).success).toBe(false);
    const parsed = c.parseTolerant(c.ServicesResponse, noisy);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(services);

    const status = load('status');
    const firstId = Object.keys(status.services)[0]!;
    const noisyStatus = {
      ...status,
      added: 1,
      services: { ...status.services, [firstId]: { ...status.services[firstId], added: 1 } },
    };
    expect(c.parseTolerant(c.StatusResponse, noisyStatus).data).toEqual(status);
  });
  test.each(Object.keys(schemas))('%s: a conforming body is returned unchanged', (name) => {
    const body = load(name);
    expect(c.parseTolerant(schemas[name] as never, body).data).toEqual(body);
  });
  test('still rejects a wrong type, a missing field and a bad enum value', () => {
    const status = load('status');
    expect(
      c.parseTolerant(c.StatusResponse, { ...status, added: 1, docker: 'maybe' }).success,
    ).toBe(false);
    const { docker: _docker, ...missing } = status;
    expect(c.parseTolerant(c.StatusResponse, { ...missing, added: 1 }).success).toBe(false);
    expect(c.parseTolerant(c.StatusResponse, 'text').success).toBe(false);
    expect(c.parseTolerant(c.StatusResponse, null).success).toBe(false);
  });
  test('does not modify its input', () => {
    const status = { ...load('status'), added: 1 };
    const copy = structuredClone(status);
    c.parseTolerant(c.StatusResponse, status);
    expect(status).toEqual(copy);
  });
});
