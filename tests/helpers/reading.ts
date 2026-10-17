// Pure, node-safe builders for the reading model. Placeholder names only.
import type { ReadingInput } from '@/lib/client/reading';
import type {
  CronJob,
  CronResponse,
  ServiceEntry,
  ServicesResponse,
  ServiceStatus,
  StatusResponse,
  SystemResponse,
  WidgetsResponse,
} from '@/lib/shared/contract';

const GENERATED = '2026-10-17T12:00:00+00:00';

/** "alpha" -> "Alpha". */
export const nameOf = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

export function service(id: string, group: string, hidden = false): ServiceEntry {
  return {
    id,
    name: nameOf(id),
    group,
    description: null,
    keywords: [],
    order: 0,
    icon: { kind: 'lucide', name: 'box' },
    url: `https://${id}.example.invalid/`,
    urlSource: 'manual',
    lan: null,
    embed: { mode: 'auto', verdict: 'allowed', reason: null, checkedAt: null },
    container: id,
    discovery: 'manual',
    ...(hidden ? { hidden: true as const } : {}),
  };
}

/** A group is [name, ids]; an id starting with "~" is hidden ("~delta"). */
export type GroupSpec = readonly [string, readonly string[]];

export function servicesOf(spec: readonly GroupSpec[]): ServicesResponse {
  return {
    generatedAt: GENERATED,
    sources: { docker: 'ok', manual: 'ok' },
    groups: spec.map(([name, ids]) => ({
      name,
      icon: null,
      services: ids.map((id) =>
        id.startsWith('~') ? service(id.slice(1), name, true) : service(id, name),
      ),
    })),
    links: [{ name: 'Example Wiki', abbr: 'EW', url: 'https://wiki.example.invalid/' }],
    warnings: [],
  };
}

export function statusOf(
  ids: readonly string[],
  states: Record<string, ServiceStatus> = {},
): StatusResponse {
  const summary = { healthy: 0, starting: 0, degraded: 0, unhealthy: 0, stopped: 0, unknown: 0 };
  const services: StatusResponse['services'] = {};
  for (const id of ids) {
    const status = states[id] ?? 'healthy';
    summary[status] += 1;
    services[id] = { status, docker: null, http: null, changedAt: null };
  }
  return { generatedAt: GENERATED, docker: 'ok', services, summary };
}

const idsOf = (s: ServicesResponse): string[] =>
  s.groups.flatMap((g) => g.services.map((x) => x.id));

export function systemOf(
  fig: {
    cpu?: number | null;
    memory?: number | null;
    disks?: { label: string; percent: number | null }[];
    temp?: number | null;
    uptime?: number | null;
    state?: SystemResponse['source']['state'];
  } = {},
): SystemResponse {
  const has = <K extends keyof typeof fig>(k: K) => k in fig;
  const none = { usedBytes: null, freeBytes: null, totalBytes: null, level: 'ok' as const };
  const temp = has('temp') ? (fig.temp ?? null) : 54;
  return {
    generatedAt: GENERATED,
    source: { state: fig.state ?? 'ok', fetchedAt: null },
    cpu: {
      percent: has('cpu') ? (fig.cpu ?? null) : 23,
      name: null,
      cores: null,
      load: null,
      level: 'ok',
    },
    memory: { percent: has('memory') ? (fig.memory ?? null) : 61, ...none },
    disks: (fig.disks ?? [{ label: 'Media disk', percent: 40 }]).map((d) => ({ ...d, ...none })),
    network: { rxBitsPerSec: null, txBitsPerSec: null },
    temperature: {
      label: 'CPU',
      celsius: temp,
      warnCelsius: null,
      critCelsius: null,
      level: 'ok',
    },
    uptimeSeconds: has('uptime') ? (fig.uptime ?? null) : 1_051_200,
  };
}

export function job(over: Partial<CronJob> & Pick<CronJob, 'id' | 'kind'>): CronJob {
  return {
    name: over.id,
    schedule: { expr: null, label: null, configured: true, source: 'config' },
    lastRun: null,
    result: 'success',
    summary: null,
    link: null,
    previousDue: null,
    nextDue: null,
    flag: 'ok',
    ...over,
  };
}

export function cronOf(jobs: CronJob[], timezone = 'Europe/London'): CronResponse {
  return {
    generatedAt: GENERATED,
    timezone,
    sources: [{ id: 'host', state: 'ok', fetchedAt: GENERATED }],
    jobs,
    summary: { ok: jobs.length, warning: 0, overdue: 0, failed: 0, unknown: 0 },
  };
}

const change = (v: number | null) => ({ '1h': null, '24h': v, '7d': null, '30d': null });

export function widgetsOf(): WidgetsResponse {
  return {
    generatedAt: GENERATED,
    services: {},
    standalone: [
      {
        id: 'markets',
        name: 'Markets',
        group: 'Markets',
        icon: { kind: 'lucide', name: 'chart-line' },
        type: 'coinmarketcap',
        state: 'ok',
        fetchedAt: GENERATED,
        interval: '24h',
        stats: [
          { key: 'aaa', label: 'AAA', value: 50.5, unit: 'USD', changePercent: change(1.2) },
          { key: 'bbb', label: 'BBB', value: 2000, unit: 'USD', changePercent: change(-0.5) },
        ],
      },
    ],
    weather: {
      state: 'ok',
      fetchedAt: GENERATED,
      label: 'Hometown',
      temperature: 15.2,
      unit: 'celsius',
      condition: 'cloudy',
      isDay: true,
    },
  };
}

/** 13:00 local on 2026-10-17; alpha, beta (Media), gamma, hidden delta (Home), all healthy. */
export function calm(over: Partial<ReadingInput> = {}): ReadingInput {
  const services = servicesOf([
    ['Media', ['alpha', 'beta']],
    ['Home', ['gamma', '~delta']],
  ]);
  return {
    services,
    status: statusOf(idsOf(services)),
    cron: cronOf([
      job({
        id: 'nightly-backup',
        kind: 'maintenance',
        lastRun: '2026-10-17T01:30:00+00:00',
        result: 'success',
      }),
      job({
        id: 'feed-sync',
        kind: 'user',
        lastRun: '2026-10-17T10:15:00+00:00',
        nextDue: '2026-10-17T15:00:00+00:00',
      }),
    ]),
    system: systemOf(),
    widgets: widgetsOf(),
    now: new Date(2026, 9, 17, 13, 0),
    unavailable: new Set(),
    ...over,
  };
}

/** Replace the services (and a healthy status for them). */
export function withServices(input: ReadingInput, spec: readonly GroupSpec[]): ReadingInput {
  const services = servicesOf(spec);
  return { ...input, services, status: statusOf(idsOf(services)) };
}

/** Mark services unhealthy. */
export function withDown(input: ReadingInput, ...ids: string[]): ReadingInput {
  const status = input.status;
  if (!status) throw new Error('withDown needs a status');
  const services = { ...status.services };
  for (const id of ids) {
    services[id] = { status: 'unhealthy', docker: null, http: null, changedAt: null };
  }
  return { ...input, status: { ...status, services } };
}

export function withStatus(input: ReadingInput, id: string, status: ServiceStatus): ReadingInput {
  const cur = input.status;
  if (!cur) throw new Error('withStatus needs a status');
  return {
    ...input,
    status: {
      ...cur,
      services: {
        ...cur.services,
        [id]: { status, docker: null, http: null, changedAt: null },
      },
    },
  };
}

export function withJob(input: ReadingInput, id: string, patch: Partial<CronJob>): ReadingInput {
  const cron = input.cron;
  if (!cron) throw new Error('withJob needs a cron');
  return {
    ...input,
    cron: { ...cron, jobs: cron.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) },
  };
}

export function withSystem(input: ReadingInput, fig: Parameters<typeof systemOf>[0]): ReadingInput {
  return { ...input, system: systemOf(fig) };
}

export function withCron(input: ReadingInput, jobs: CronJob[], timezone?: string): ReadingInput {
  return { ...input, cron: cronOf(jobs, timezone) };
}
