import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  glancesFor,
  hostStatusFor,
  parseScenario,
  SCENARIOS,
  type Scenario,
} from '../../dev/fixtures/scenarios';
import { hostStatus, startFixtures, type Fixtures } from '../../dev/fixtures/server';

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      })
      .on('error', reject);
  });
}

async function withScenario<T>(
  scenario: Scenario | undefined,
  run: (fx: Fixtures, statusFile: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'iris-scenario-'));
  const statusFile = join(dir, 'host-status.json');
  const fx = await startFixtures({
    port: { docker: 0, traefik: 0, cron: 0, glances: 0, tautulli: 0 },
    lanApps: 'none',
    hostStatusFile: statusFile,
    ...(scenario ? { scenario } : {}),
  });
  try {
    return await run(fx, statusFile);
  } finally {
    await fx.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

type Job = { name: string; status: string };
const jobs = async (fx: Fixtures): Promise<Job[]> =>
  (JSON.parse((await get(fx.ports.cron, '/cron-status')).body) as { jobs: Job[] }).jobs;
const priceWatch = (list: Job[]): string | undefined =>
  list.find((j) => j.name === 'price-watch')?.status;
type Container = {
  Names: string[];
  Health: { Status: string; FailingStreak: number };
  Status: string;
};
const moviebox = async (fx: Fixtures): Promise<Container> =>
  (
    JSON.parse((await get(fx.ports.docker, '/v1.52/containers/json?all=true')).body) as Container[]
  ).find((c) => c.Names.includes('/moviebox'))!;
const glances = async (fx: Fixtures, name: string): Promise<unknown> =>
  JSON.parse((await get(fx.ports.glances, `/api/4/${name}`)).body);

describe('fixture scenarios', () => {
  test('parseScenario defaults to normal and rejects unknown names', () => {
    expect(parseScenario(undefined)).toBe('normal');
    expect(parseScenario('')).toBe('normal');
    for (const name of SCENARIOS) expect(parseScenario(name)).toBe(name);
    expect(() => parseScenario('bogus')).toThrow(/normal, down, failed, strained, alt, outage/);
  });

  test('without a scenario the base data is unchanged', async () => {
    await withScenario(undefined, async (fx) => {
      expect(priceWatch(await jobs(fx))).toBe('failed');
      expect((await moviebox(fx)).Health.Status).toBe('healthy');
    });
  });

  test('normal has no failed job', async () => {
    await withScenario('normal', async (fx) => {
      expect((await jobs(fx)).some((j) => j.status === 'failed')).toBe(false);
      expect((await moviebox(fx)).Health.Status).toBe('healthy');
      expect((await glances(fx, 'quicklook')) as { cpu: number }).toMatchObject({ cpu: 23 });
    });
  });

  test('down marks moviebox unhealthy', async () => {
    await withScenario('down', async (fx) => {
      const c = await moviebox(fx);
      expect(c.Health).toEqual({ Status: 'unhealthy', FailingStreak: 3 });
      expect(c.Status).toBe('Up 3 hours (unhealthy)');
    });
  });

  test('failed fails price-watch and the backup', async () => {
    await withScenario('failed', async (fx) => {
      expect(priceWatch(await jobs(fx))).toBe('failed');
    });
    const now = Date.now();
    const patched = hostStatusFor('failed', hostStatus(now)) as { backup: { result: string } };
    expect(patched.backup.result).toBe('failed');
    expect((hostStatus(now) as { backup: { result: string } }).backup.result).toBe('success');
  });

  test('strained crosses all four thresholds', async () => {
    await withScenario('strained', async (fx) => {
      expect(((await glances(fx, 'quicklook')) as { cpu: number }).cpu).toBeGreaterThan(70);
      expect(((await glances(fx, 'mem')) as { percent: number }).percent).toBeGreaterThan(80);
      const sensors = (await glances(fx, 'sensors')) as { label: string; value: number }[];
      expect(sensors.find((s) => s.label === 'Package id 0')!.value).toBeGreaterThan(80);
      const fs = (await glances(fx, 'fs')) as { percent: number }[];
      expect(fs.some((d) => d.percent > 90)).toBe(true);
    });
  });

  test('alt combines down, failed and strained', async () => {
    await withScenario('alt', async (fx, statusFile) => {
      expect((await moviebox(fx)).Health.Status).toBe('unhealthy');
      expect(priceWatch(await jobs(fx))).toBe('failed');
      expect(((await glances(fx, 'quicklook')) as { cpu: number }).cpu).toBe(84);
      const written = JSON.parse(readFileSync(statusFile, 'utf8')) as {
        backup: { result: string };
      };
      expect(written.backup.result).toBe('failed');
    });
  });

  test('outage answers 500 from docker, cron and glances', async () => {
    await withScenario('outage', async (fx) => {
      expect((await get(fx.ports.docker, '/v1.52/containers/json')).status).toBe(500);
      expect((await get(fx.ports.cron, '/cron-status')).status).toBe(500);
      expect((await get(fx.ports.glances, '/api/4/quicklook')).status).toBe(500);
      expect((await get(fx.ports.traefik, '/v1/forecast')).status).toBe(500);
    });
  });

  test('outage hostStatus is older than 15 minutes', async () => {
    await withScenario('outage', async (_fx, statusFile) => {
      const written = JSON.parse(readFileSync(statusFile, 'utf8')) as { generatedAt: string };
      expect(Date.now() - Date.parse(written.generatedAt)).toBeGreaterThan(15 * 60_000);
    });
  });

  test('patches do not mutate their input', () => {
    const base = [{ label: 'Package id 0', value: 54 }];
    glancesFor('strained', 'sensors', base);
    expect(base[0]!.value).toBe(54);
  });

  test('no production code reads IRIS_FIXTURE_SCENARIO', () => {
    let hits = '';
    try {
      hits = execFileSync(
        'grep',
        [
          '-rl',
          'IRIS_FIXTURE_SCENARIO',
          'app',
          'lib',
          'components',
          'proxy.ts',
          'instrumentation.ts',
        ],
        { encoding: 'utf8', cwd: join(import.meta.dirname, '..', '..') },
      );
    } catch (error) {
      // grep exits 1 when nothing matches
      if ((error as { status?: number }).status !== 1) throw error;
    }
    expect(hits).toBe('');
  });
});
