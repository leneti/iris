import 'server-only';
import { z } from 'zod';
import { createTtlCache } from '../cache';
import { getConfigWatcher } from '../config/services';
import { httpRequest } from '../http';
import { log } from '../log';
import type { SystemResponse } from '@/lib/shared/contract';

// The System panel (handoff D1.11, §8.4). Glances is read on demand through the TTL cache: one
// GET per endpoint under /api/4/, at most once per 10 s however many browsers ask. The cache holds
// the parsed snapshot (with mount points and names); `buildSystem` is the only place that turns
// it into the response, so nothing but the configured labels can leave.

export type Level = 'ok' | 'warn' | 'bad';
export type Thresholds = { warn: number; bad: number };

const TTL_MS = 10_000;
/** D1.11: when Glances is unreachable the last values are kept this long. */
const KEEP_MS = 60_000;
const TIMEOUT_MS = 4000;
const MAX_BYTES = 1024 * 1024;
const ENDPOINTS = ['quicklook', 'mem', 'fs', 'network', 'sensors', 'uptime', 'load'] as const;

export function levelFor(percent: number | null, t: Thresholds): Level {
  if (percent === null) return 'ok';
  if (percent >= t.bad) return 'bad';
  if (percent >= t.warn) return 'warn';
  return 'ok';
}

export function tempLevel(c: number | null, warn: number | null, crit: number | null): Level {
  if (c === null) return 'ok';
  if (crit !== null && c >= crit) return 'bad';
  if (warn !== null && c >= warn) return 'warn';
  return 'ok';
}

// ---- tolerant parsing: anything missing or of the wrong type becomes null (§14.2) ----

const num = z.number().finite().nullable().catch(null);
const str = z.string().nullable().catch(null);
const list = <T extends z.ZodType>(item: T) => z.array(item.catch(null as never)).catch([]);

const QuicklookSchema = z.object({
  cpu: num,
  cpu_name: str,
  percpu: z.array(z.unknown()).nullable().catch(null),
});
const LoadSchema = z.object({ min1: num, min5: num, min15: num, cpucore: num });
const MemSchema = z.object({ total: num, available: num, used: num, percent: num });
const FsSchema = list(z.object({ mnt_point: str, size: num, used: num, free: num, percent: num }));
const NetSchema = list(
  z.object({
    interface_name: str,
    bytes_recv_rate_per_sec: num,
    bytes_sent_rate_per_sec: num,
    bytes_recv: num,
    bytes_sent: num,
    time_since_update: num,
  }),
);
const SensorSchema = list(
  z.object({ label: str, value: num, warning: num, critical: num, unit: str, type: str }),
);

type Snapshot = {
  cpu: { percent: number | null; name: string | null; cores: number | null };
  load: [number | null, number | null, number | null] | null;
  mem: z.infer<typeof MemSchema>;
  fs: NonNullable<z.infer<typeof FsSchema>>;
  net: Array<{ name: string; rx: number | null; tx: number | null }>;
  sensors: Array<{ label: string; celsius: number; warn: number | null; crit: number | null }>;
  uptimeSeconds: number | null;
};

function parseUptime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const m = /^\s*(?:(\d+) days?, )?(\d+):(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

function rate(perSec: number | null, total: number | null, elapsed: number | null): number | null {
  if (perSec !== null) return perSec * 8;
  if (total !== null && elapsed !== null && elapsed > 0) return (total / elapsed) * 8;
  return null;
}

function toSnapshot(raw: Record<(typeof ENDPOINTS)[number], unknown>): Snapshot {
  const q = QuicklookSchema.parse(raw.quicklook ?? {});
  const l = LoadSchema.parse(raw.load ?? {});
  const hasLoad = l.min1 !== null || l.min5 !== null || l.min15 !== null;
  return {
    cpu: {
      percent: q.cpu,
      name: q.cpu_name,
      cores: l.cpucore ?? (q.percpu ? q.percpu.length || null : null),
    },
    load: hasLoad ? [l.min1, l.min5, l.min15] : null,
    mem: MemSchema.parse(raw.mem ?? {}),
    fs: (FsSchema.parse(raw.fs ?? []) ?? []).filter((d) => d !== null),
    net: NetSchema.parse(raw.network ?? [])
      .filter((i) => i !== null && i.interface_name !== null)
      .map((i) => ({
        name: i!.interface_name!,
        rx: rate(i!.bytes_recv_rate_per_sec, i!.bytes_recv, i!.time_since_update),
        tx: rate(i!.bytes_sent_rate_per_sec, i!.bytes_sent, i!.time_since_update),
      })),
    sensors: SensorSchema.parse(raw.sensors ?? [])
      .filter((s) => s !== null && s.label !== null && s.value !== null)
      .filter((s) => s!.unit === 'C' || (s!.type ?? '').startsWith('temperature'))
      .map((s) => ({ label: s!.label!, celsius: s!.value!, warn: s!.warning, crit: s!.critical })),
    uptimeSeconds: parseUptime(raw.uptime),
  };
}

async function fetchEndpoint(base: string, name: string): Promise<unknown> {
  const res = await httpRequest({
    url: `${base}/api/4/${name}`,
    headers: { accept: 'application/json' },
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
  });
  if (res.status !== 200) throw new Error(`glances ${name} answered ${res.status}`);
  return JSON.parse(res.body.toString('utf8'));
}

/** Throws only when no endpoint answered; a missing endpoint is just missing figures. */
async function fetchSnapshot(base: string): Promise<Snapshot> {
  const results = await Promise.allSettled(ENDPOINTS.map((n) => fetchEndpoint(base, n)));
  const raw = {} as Record<(typeof ENDPOINTS)[number], unknown>;
  let answered = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      raw[ENDPOINTS[i]!] = r.value;
      answered++;
    }
  });
  if (answered === 0) throw (results[0] as PromiseRejectedResult).reason;
  return toSnapshot(raw);
}

// ---- snapshot to response ----

const round = (v: number | null): number | null => (v === null ? null : Math.round(v));
const CPU_SENSOR = /package|core|cpu|tctl|tdie/i;
const VIRTUAL_IFACE = /^(lo|docker|veth|br-|virbr)/;

function percentOf(percent: number | null, used: number | null, size: number | null) {
  if (percent !== null) return Math.round(percent);
  return used !== null && size !== null && size > 0 ? Math.round((used / size) * 100) : null;
}

type SystemConfig = NonNullable<
  ReturnType<ReturnType<typeof getConfigWatcher>['get']>['dashboard']['config']['system']
>;

function pickSensor(s: Snapshot, wanted: string) {
  if (wanted !== 'auto') return s.sensors.find((x) => x.label === wanted);
  const cpu = s.sensors.filter((x) => CPU_SENSOR.test(x.label));
  return cpu.sort((a, b) => b.celsius - a.celsius)[0];
}

function pickInterface(s: Snapshot, wanted: string) {
  if (wanted !== 'auto') return s.net.find((x) => x.name === wanted);
  return s.net
    .filter((x) => !VIRTUAL_IFACE.test(x.name))
    .sort((a, b) => (b.rx ?? 0) + (b.tx ?? 0) - ((a.rx ?? 0) + (a.tx ?? 0)))[0];
}

function build(
  snap: Snapshot | null,
  cfg: SystemConfig,
  source: SystemResponse['source'],
  now: Date,
): SystemResponse {
  const t = cfg.thresholds;
  const cpuPercent = round(snap?.cpu.percent ?? null);
  const memPercent = percentOf(
    snap?.mem.percent ?? null,
    snap?.mem.used ?? null,
    snap?.mem.total ?? null,
  );
  const sensor = snap ? pickSensor(snap, cfg.sensor) : undefined;
  const iface = snap ? pickInterface(snap, cfg.interface) : undefined;
  const celsius = sensor ? Math.round(sensor.celsius) : null;
  return {
    generatedAt: now.toISOString(),
    source,
    cpu: {
      percent: cpuPercent,
      name: snap?.cpu.name ? snap.cpu.name.replace(/\s+/g, ' ').trim().slice(0, 40) : null,
      cores: snap?.cpu.cores ?? null,
      load: snap?.load ?? null,
      level: levelFor(cpuPercent, t),
    },
    memory: {
      percent: memPercent,
      usedBytes: snap?.mem.used ?? null,
      freeBytes: snap?.mem.available ?? null,
      totalBytes: snap?.mem.total ?? null,
      level: levelFor(memPercent, t),
    },
    disks: cfg.disks.map((d) => {
      const fs = snap?.fs.find((x) => x.mnt_point === d.mount);
      const percent = fs ? percentOf(fs.percent, fs.used, fs.size) : null;
      return {
        label: d.label,
        percent,
        usedBytes: fs?.used ?? null,
        freeBytes: fs?.free ?? null,
        totalBytes: fs?.size ?? null,
        level: levelFor(percent, t),
      };
    }),
    network: { rxBitsPerSec: round(iface?.rx ?? null), txBitsPerSec: round(iface?.tx ?? null) },
    temperature: sensor
      ? {
          label: 'CPU',
          celsius,
          warnCelsius: sensor.warn,
          critCelsius: sensor.crit,
          level: tempLevel(celsius, sensor.warn, sensor.crit),
        }
      : null,
    uptimeSeconds: snap?.uptimeSeconds ?? null,
  };
}

const EMPTY_CONFIG = { interface: 'auto', sensor: 'auto', thresholds: { warn: 80, bad: 90 } };

const cache = createTtlCache();
let wasDown = false;

export async function getSystem(
  now: Date,
  cfg: SystemConfig | undefined = getConfigWatcher().get().dashboard.config.system,
): Promise<SystemResponse> {
  if (cfg === undefined || cfg.url.trim() === '') {
    return build(
      null,
      { ...EMPTY_CONFIG, ...cfg, url: '', disks: [] },
      { state: 'not-configured', fetchedAt: null },
      now,
    );
  }
  const base = cfg.url.trim().replace(/\/+$/, '');
  const r = await cache.get(`glances:${base}`, TTL_MS, () => fetchSnapshot(base));
  const down = r.error !== null;
  // One line per outage, name only: an error message can carry the address.
  if (down && !wasDown)
    log.warn('glances unreachable', {
      error: r.error instanceof Error ? r.error.name : typeof r.error,
    });
  if (!down && wasDown) log.info('glances recovered');
  wasDown = down;

  const fresh = r.fetchedAt !== null && now.getTime() - r.fetchedAt <= KEEP_MS;
  const snap = !down || fresh ? r.value : null;
  return build(
    snap,
    cfg,
    {
      state: down ? 'unreachable' : 'ok',
      fetchedAt: r.fetchedAt === null ? null : new Date(r.fetchedAt).toISOString(),
    },
    now,
  );
}
