// API contract shared by the browser and the server (handoff §8.1-§8.6 and the host status file).
// No `server-only` import here: the client bundle uses these schemas too.
import { z } from 'zod';

const iso = z.iso.datetime({ offset: true });
const isoOrNull = iso.nullable();
const obj = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);

// ---- shared enums ----
export const ServiceStatus = z.enum([
  'healthy',
  'starting',
  'degraded',
  'unhealthy',
  'stopped',
  'unknown',
]);
export type ServiceStatus = z.infer<typeof ServiceStatus>;

export const IconRef = z.discriminatedUnion('kind', [
  obj({
    kind: z.literal('dashboard-icons'),
    slug: z.string(),
    src: z.string(),
    // Present only when the catalogue has them: `light` is the src for the light theme
    // (`<slug>-dark` file), `dark` the src for the dark theme (`<slug>-light` file).
    variants: obj({ light: z.string().optional(), dark: z.string().optional() }).optional(),
  }),
  obj({ kind: z.literal('local'), file: z.string(), src: z.string() }),
  obj({ kind: z.literal('lucide'), name: z.string() }),
]);
export type IconRef = z.infer<typeof IconRef>;

// ---- 8.1 services ----
export const EmbedInfo = obj({
  mode: z.enum(['auto', 'true', 'false']),
  verdict: z.enum(['allowed', 'blocked', 'unknown']),
  reason: z
    .enum([
      'x-frame-options',
      'csp-frame-ancestors',
      'mixed-content',
      'label',
      'no-url',
      'probe-failed',
    ])
    .nullable(),
  checkedAt: isoOrNull,
});
export type EmbedInfo = z.infer<typeof EmbedInfo>;

export const ServiceEntry = obj({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  description: z.string().nullable(),
  keywords: z.array(z.string()),
  order: z.number(),
  icon: IconRef,
  url: z.string().nullable(),
  urlSource: z.enum(['label', 'traefik-router', 'manual', 'none']),
  lan: obj({
    port: z.number().int(),
    path: z.string(),
    source: z.enum(['label', 'published-port']),
  }).nullable(),
  embed: EmbedInfo,
  container: z.string().nullable(),
  discovery: z.enum(['label', 'manual']),
  // Iris 0.2: listed in iris.yaml `hidden`. Absent means shown.
  hidden: z.literal(true).optional(),
});
export type ServiceEntry = z.infer<typeof ServiceEntry>;

// The spec example shows the group icon as a plain "lucide:name" string.
export const GroupEntry = obj({
  name: z.string(),
  icon: z.string().nullable(),
  services: z.array(ServiceEntry),
});
export type GroupEntry = z.infer<typeof GroupEntry>;

export const LinkEntry = obj({
  name: z.string(),
  abbr: z.string().max(3),
  url: z.string(),
});
export type LinkEntry = z.infer<typeof LinkEntry>;

export const Warning = obj({
  code: z.string(),
  serviceId: z.string().optional(),
  message: z.string(),
});
export type Warning = z.infer<typeof Warning>;

export const ServicesResponse = obj({
  generatedAt: iso,
  sources: obj({ docker: z.string(), manual: z.string() }),
  groups: z.array(GroupEntry),
  links: z.array(LinkEntry),
  warnings: z.array(Warning),
});
export type ServicesResponse = z.infer<typeof ServicesResponse>;

// ---- 8.2 status ----
export const ServiceStatusEntry = obj({
  status: ServiceStatus,
  docker: obj({
    state: z.string(),
    health: z.string(),
    failingStreak: z.number().int(),
    statusText: z.string(),
  }).nullable(),
  http: obj({
    ok: z.boolean(),
    code: z.number().int().nullable(),
    latencyMs: z.number().nullable(),
    reason: z.enum(['timeout', 'upstream-error', 'route-missing']).nullable(),
    checkedAt: iso,
  }).nullable(),
  changedAt: isoOrNull,
});
export type ServiceStatusEntry = z.infer<typeof ServiceStatusEntry>;

export const StatusResponse = obj({
  generatedAt: iso,
  docker: z.enum(['ok', 'unreachable']),
  services: z.record(z.string(), ServiceStatusEntry),
  summary: obj({
    healthy: z.number().int(),
    starting: z.number().int(),
    degraded: z.number().int(),
    unhealthy: z.number().int(),
    stopped: z.number().int(),
    unknown: z.number().int(),
  }),
});
export type StatusResponse = z.infer<typeof StatusResponse>;

// ---- 8.3 cron ----
export const CronSource = obj({
  id: z.string(),
  state: z.enum(['ok', 'unreachable', 'stale', 'not-configured']),
  fetchedAt: isoOrNull,
});
export type CronSource = z.infer<typeof CronSource>;

export const CronJob = obj({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['user', 'maintenance']),
  schedule: obj({
    expr: z.string().nullable(),
    label: z.string().nullable(),
    configured: z.boolean(),
    source: z.enum(['config', 'host-status']).nullable(),
  }),
  lastRun: isoOrNull,
  result: z.enum(['success', 'warning', 'failed', 'unknown']),
  summary: z.string().nullable(),
  link: z.string().nullable(),
  previousDue: isoOrNull,
  nextDue: isoOrNull,
  flag: z.enum(['ok', 'warning', 'overdue', 'failed', 'unknown']),
});
export type CronJob = z.infer<typeof CronJob>;

export const CronResponse = obj({
  generatedAt: iso,
  timezone: z.string(),
  sources: z.array(CronSource),
  jobs: z.array(CronJob),
  summary: obj({
    ok: z.number().int(),
    warning: z.number().int(),
    overdue: z.number().int(),
    failed: z.number().int(),
    unknown: z.number().int(),
  }),
});
export type CronResponse = z.infer<typeof CronResponse>;

// Host status file (8.3). Time fields and updater.nextRun are nullable (decision of 2026-10-16).
export const HostStatusFile = obj({
  version: z.literal(1),
  generatedAt: iso,
  timezone: z.string(),
  userJobs: z.array(obj({ folder: z.string(), name: z.string(), schedule: z.string().nullable() })),
  unmatchedCrontabLines: z.number().int(),
  backup: obj({
    schedule: z.string().nullable(),
    lastStart: isoOrNull,
    lastEnd: isoOrNull,
    result: z.enum(['success', 'failed', 'unknown']),
    nextRun: isoOrNull,
  }),
  updater: obj({
    schedule: z.string().nullable(),
    lastRun: isoOrNull,
    result: z.enum(['succeeded', 'failed', 'paused', 'unknown']),
    paused: z.boolean(),
    nextRun: isoOrNull,
  }),
});
export type HostStatusFile = z.infer<typeof HostStatusFile>;

// ---- 8.4 system ----
const Level = z.enum(['ok', 'warn', 'bad']);
const n = z.number().nullable();

export const SystemResponse = obj({
  generatedAt: iso,
  source: obj({
    state: z.enum(['ok', 'unreachable', 'not-configured']),
    fetchedAt: isoOrNull,
  }),
  cpu: obj({
    percent: n,
    name: z.string().nullable(),
    cores: n,
    load: z.tuple([n, n, n]).nullable(),
    level: Level,
  }),
  memory: obj({
    percent: n,
    usedBytes: n,
    freeBytes: n,
    totalBytes: n,
    level: Level,
  }),
  disks: z.array(
    obj({
      label: z.string(),
      percent: n,
      usedBytes: n,
      freeBytes: n,
      totalBytes: n,
      level: Level,
    }),
  ),
  network: obj({ rxBitsPerSec: n, txBitsPerSec: n }),
  temperature: obj({
    label: z.literal('CPU'),
    celsius: n,
    warnCelsius: n,
    critCelsius: n,
    level: Level,
  }).nullable(),
  uptimeSeconds: n,
});
export type SystemResponse = z.infer<typeof SystemResponse>;

// ---- 8.5 streams ----
export const StreamSession = obj({
  id: z.string(),
  title: z.string(),
  mediaType: z.string(),
  user: z.string().nullable(),
  player: z.string(),
  state: z.enum(['playing', 'paused', 'buffering']),
  progressPercent: z.number(),
  decision: z.enum(['direct-play', 'copy', 'transcode']),
  location: z.enum(['lan', 'wan']),
});
export type StreamSession = z.infer<typeof StreamSession>;

export const StreamsResponse = obj({
  generatedAt: iso,
  source: obj({
    state: z.enum(['ok', 'unreachable', 'unauthorized', 'not-configured']),
    fetchedAt: isoOrNull,
  }),
  streamCount: z.number().int(),
  transcodeCount: z.number().int(),
  totalBitsPerSec: n,
  sessions: z.array(StreamSession),
});
export type StreamsResponse = z.infer<typeof StreamsResponse>;

// ---- 8.6 widgets ----
export const Stat = obj({
  key: z.string(),
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  // null, 'bytes-per-second', 'percent' or a currency code.
  unit: z.string().nullable(),
  atLeast: z.literal(true).optional(),
  changePercent: obj({
    '1h': n,
    '24h': n,
    '7d': n,
    '30d': n,
  }).optional(),
});
export type Stat = z.infer<typeof Stat>;

export const WidgetState = z.enum([
  'ok',
  'unreachable',
  'unauthorized',
  'rate-limited',
  'not-configured',
]);
export type WidgetState = z.infer<typeof WidgetState>;

export const ServiceWidget = obj({
  type: z.string(),
  state: WidgetState,
  fetchedAt: isoOrNull,
  stats: z.array(Stat),
});
export type ServiceWidget = z.infer<typeof ServiceWidget>;

export const StandaloneWidget = obj({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  icon: IconRef,
  type: z.string(),
  state: WidgetState,
  fetchedAt: isoOrNull,
  interval: z.enum(['1h', '24h', '7d', '30d']),
  stats: z.array(Stat),
});
export type StandaloneWidget = z.infer<typeof StandaloneWidget>;

export const Weather = obj({
  state: WidgetState,
  fetchedAt: isoOrNull,
  label: z.string(),
  temperature: n,
  unit: z.enum(['celsius', 'fahrenheit']),
  condition: z
    .enum([
      'clear',
      'partly-cloudy',
      'cloudy',
      'fog',
      'drizzle',
      'rain',
      'snow',
      'showers',
      'thunderstorm',
    ])
    .nullable(),
  isDay: z.boolean().nullable(),
});
export type Weather = z.infer<typeof Weather>;

export const WidgetsResponse = obj({
  generatedAt: iso,
  services: z.record(z.string(), ServiceWidget),
  standalone: z.array(StandaloneWidget),
  weather: Weather.nullable(),
});
export type WidgetsResponse = z.infer<typeof WidgetsResponse>;

// ---- tolerant parsing for the browser (Ruling R49) ----
// The schemas above are strict, which is what the server's own tests want: a field nobody
// declared is a bug. The browser, though, may be an old page talking to a newer server after a
// deploy, and an added field must not freeze it. `parseTolerant` keeps this file the only
// source of truth: it parses strictly, drops exactly the keys zod reports as unrecognised,
// and parses again. Every other mismatch (type, enum, missing field) still fails.
const MAX_STRIP_PASSES = 4;

type Unrecognised = { path: PropertyKey[]; keys: string[] };

function unrecognised(issues: readonly z.core.$ZodIssue[]): Unrecognised[] {
  return issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys' ? [{ path: [...issue.path], keys: [...issue.keys] }] : [],
  );
}

function withoutKeys(input: unknown, drops: Unrecognised[]): unknown {
  const copy: unknown = structuredClone(input);
  for (const { path, keys } of drops) {
    let at: unknown = copy;
    for (const step of path) at = (at as Record<PropertyKey, unknown> | null | undefined)?.[step];
    if (typeof at !== 'object' || at === null) continue;
    for (const key of keys) delete (at as Record<string, unknown>)[key];
  }
  return copy;
}

export function parseTolerant<T>(schema: z.ZodType<T>, input: unknown): z.ZodSafeParseResult<T> {
  let body = input;
  let result = schema.safeParse(body);
  for (let pass = 0; pass < MAX_STRIP_PASSES && !result.success; pass++) {
    const drops = unrecognised(result.error.issues);
    if (drops.length === 0) break;
    body = withoutKeys(body, drops);
    result = schema.safeParse(body);
  }
  return result;
}
