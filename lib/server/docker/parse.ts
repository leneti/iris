import 'server-only';
import { z } from 'zod';

// Handoff §7.1 step 2 and D1.2 "Residual exposure": the list reply carries every container's
// command line, mounts and network addresses. Parse it into a whitelist and drop the rest at once.

export type ContainerSummary = {
  name: string;
  service: string | null;
  /** Only `iris.*` and `traefik.http.routers.*.rule` labels. */
  labels: Record<string, string>;
  state: string;
  statusText: string;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  failingStreak: number;
  /** Published TCP host port numbers, once each, ascending. The bound address is dropped. */
  publicPorts: number[];
};

const KEPT_LABEL = /^(iris\.|traefik\.http\.routers\.[^.]+\.rule$)/;
const COMPOSE_SERVICE = 'com.docker.compose.service';

const RawContainer = z.object({
  Names: z.array(z.string()).min(1),
  State: z.string().catch(''),
  Status: z.string().catch(''),
  Labels: z.record(z.string(), z.unknown()).nullish(),
  Ports: z
    .array(z.object({ PublicPort: z.number().int().optional(), Type: z.string().optional() }))
    .nullish()
    .catch(null),
  Health: z
    .object({
      Status: z.string().optional(),
      FailingStreak: z.number().int().min(0).optional(),
    })
    .nullish()
    .catch(null),
});

const HEALTH = new Set(['healthy', 'unhealthy', 'starting']);

function summarise(item: unknown): ContainerSummary | null {
  const parsed = RawContainer.safeParse(item);
  if (!parsed.success) return null;
  const { Names, State, Status, Labels, Ports, Health } = parsed.data;
  const rawName = Names[0]?.replace(/^\/+/, '') ?? '';
  if (rawName === '') return null;

  const labels: Record<string, string> = {};
  let service: string | null = null;
  for (const [key, value] of Object.entries(Labels ?? {})) {
    if (typeof value !== 'string') continue;
    if (key === COMPOSE_SERVICE) service = value || null;
    else if (KEPT_LABEL.test(key)) labels[key] = value;
  }

  const ports = new Set<number>();
  for (const port of Ports ?? [])
    if (port.Type === 'tcp' && port.PublicPort !== undefined && port.PublicPort > 0)
      ports.add(port.PublicPort);

  const healthWord = Health?.Status ?? '';
  return {
    name: rawName,
    service,
    labels,
    state: State,
    statusText: Status,
    health: HEALTH.has(healthWord) ? (healthWord as 'healthy' | 'unhealthy' | 'starting') : 'none',
    failingStreak: Health?.FailingStreak ?? 0,
    publicPorts: [...ports].sort((a, b) => a - b),
  };
}

/** Throws when the reply is not a list; entries that cannot be read are skipped. */
export function parseContainers(raw: unknown): ContainerSummary[] {
  if (!Array.isArray(raw)) throw new Error('Docker reply is not a list of containers');
  return raw.flatMap((item) => summarise(item) ?? []);
}
