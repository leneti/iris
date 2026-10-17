// Fixture scenarios: patches of the base fixture data, chosen once per process start by
// IRIS_FIXTURE_SCENARIO (read only by dev/fixtures/server.ts). Pure functions: every patch works
// on a deep copy. Runs under `node --experimental-strip-types`: no enums, no parameter properties.

export const SCENARIOS = ['normal', 'down', 'failed', 'strained', 'alt', 'outage'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function parseScenario(raw: string | undefined): Scenario {
  if (raw === undefined || raw === '') return 'normal';
  if ((SCENARIOS as readonly string[]).includes(raw)) return raw as Scenario;
  throw new Error(`Unknown fixture scenario "${raw}". Use one of: ${SCENARIOS.join(', ')}.`);
}

const copy = <T>(value: T): T => structuredClone(value);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const hasDown = (s: Scenario): boolean => s === 'down' || s === 'alt';
const hasFailed = (s: Scenario): boolean => s === 'failed' || s === 'alt';
const hasStrained = (s: Scenario): boolean => s === 'strained' || s === 'alt';

/** `down`: the container "moviebox" turns unhealthy. */
export function containersFor(s: Scenario, list: unknown[]): unknown[] {
  const out = copy(list);
  if (!hasDown(s)) return out;
  for (const c of out) {
    if (!isRecord(c) || !Array.isArray(c.Names) || !c.Names.includes('/moviebox')) continue;
    c.Health = { Status: 'unhealthy', FailingStreak: 3 };
    c.Status = 'Up 3 hours (unhealthy)';
  }
  return out;
}

/** Every scenario but the base data heals `price-watch`; `failed` and `alt` break it again. */
export function cronJobsFor<T extends { name: string; status: string }>(
  s: Scenario,
  jobs: T[],
): T[] {
  const out = copy(jobs);
  for (const job of out)
    if (job.name === 'price-watch') job.status = hasFailed(s) ? 'failed' : 'success';
  return out;
}

export function hostStatusFor(s: Scenario, file: Record<string, unknown>): Record<string, unknown> {
  const out = copy(file);
  if (hasFailed(s) && isRecord(out.backup)) out.backup.result = 'failed';
  return out;
}

export function glancesFor(s: Scenario, name: string, data: unknown): unknown {
  const out = copy(data);
  if (!hasStrained(s)) return out;
  if (name === 'quicklook' && isRecord(out)) out.cpu = 84;
  if (name === 'mem' && isRecord(out)) out.percent = 86;
  if (name === 'fs' && Array.isArray(out)) {
    for (const d of out) if (isRecord(d) && d.mnt_point === '/example/media') d.percent = 93;
  }
  if (name === 'sensors' && Array.isArray(out)) {
    for (const x of out) if (isRecord(x) && x.label === 'Package id 0') x.value = 83;
  }
  return out;
}

/** `outage`: the upstreams answer 500 (the host status file is written stale instead). */
export function upstreamFails(s: Scenario): {
  docker: boolean;
  cron: boolean;
  glances: boolean;
  external: boolean;
} {
  const down = s === 'outage';
  return { docker: down, cron: down, glances: down, external: down };
}
