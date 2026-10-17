import 'server-only';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Warning } from '@/lib/shared/contract';
import { loadEnv } from '../env';
import {
  FILE_IRIS,
  fillZone,
  isHttpUrl,
  readIrisConfig,
  readYamlFile,
  schemaProblem,
  unknownKeyWarnings,
  type IrisLoad,
} from './iris';

export const FILE_SERVICES = 'services.yaml';

const ServicesSchema = z.object({
  version: z.literal(1).default(1),
  services: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        group: z.string().optional(),
        icon: z.string().optional(),
        description: z.string().optional(),
        keywords: z.array(z.string()).default([]),
        order: z.number().default(0),
        container: z.string().optional(),
        url: z.string().optional(),
        embed: z.union([z.boolean(), z.literal('auto')]).default('auto'),
        widget: z.looseObject({ type: z.string() }).optional(),
      }),
    )
    .default([]),
});

export interface ManualService {
  id: string;
  name: string;
  group?: string;
  icon?: string;
  description?: string;
  keywords: string[];
  order: number;
  container?: string;
  /** Final http(s) address, or null for `none`, a missing url, or one that could not be used. */
  url: string | null;
  embed: 'auto' | 'true' | 'false';
  widget?: { type: string } & Record<string, unknown>;
}

export interface ManualLoad {
  services: ManualService[];
  warnings: Warning[];
  state: 'ok' | 'missing' | 'invalid';
}

export function loadManualServices(dir: string, zone: string | undefined): ManualLoad {
  const read = readYamlFile(dir, FILE_SERVICES);
  if (read.state === 'missing') return { services: [], warnings: [], state: 'missing' };
  if (read.state === 'invalid') return { services: [], warnings: [read.warning], state: 'invalid' };
  const result = ServicesSchema.safeParse(read.data);
  if (!result.success)
    return {
      services: [],
      warnings: [schemaProblem(FILE_SERVICES, result.error)],
      state: 'invalid',
    };

  const warnings = unknownKeyWarnings(FILE_SERVICES, read.data, result.data);
  const seen = new Set<string>();
  const services: ManualService[] = [];
  for (const s of result.data.services) {
    if (seen.has(s.id)) {
      warnings.push({
        code: 'SERVICE_DUPLICATE',
        serviceId: s.id,
        message: `${FILE_SERVICES}: id "${s.id}" appears more than once; the first entry is used`,
      });
      continue;
    }
    seen.add(s.id);
    let url: string | null = null;
    if (s.url !== undefined && s.url !== 'none') {
      const filled = fillZone(s.url, zone);
      if (filled !== null && isHttpUrl(filled)) url = filled;
      else
        warnings.push({
          code: 'SERVICE_URL_INVALID',
          serviceId: s.id,
          message:
            filled === null
              ? `Service "${s.id}" needs {zone} but IRIS_ZONE is not set; it has no address`
              : `Service "${s.id}" has an address that is not http or https; it has no address`,
        });
    }
    const { embed, ...rest } = s;
    services.push({ ...rest, url, embed: embed === 'auto' ? 'auto' : embed ? 'true' : 'false' });
  }
  return { services, warnings, state: 'ok' };
}

// ---- watcher ----
export interface ConfigSnapshot {
  iris: ReturnType<typeof import('./iris').loadIrisConfig>;
  manual: ReturnType<typeof loadManualServices>;
}

export interface ConfigWatcher {
  get(): ConfigSnapshot;
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

/** Reloads a file when its mtime changes; a file that fails to parse keeps the last good config. */
export function createConfigWatcher(
  dir: string,
  zone: string | undefined = loadEnv().zone,
): ConfigWatcher {
  let irisSig: number | undefined;
  let servSig: number | undefined;
  let iris: IrisLoad | undefined;
  let manual: ManualLoad | undefined;
  let goodIris: IrisLoad | undefined;
  let goodManual: ManualLoad | undefined;

  return {
    get() {
      const d = mtime(join(dir, FILE_IRIS));
      if (iris === undefined || d !== irisSig) {
        irisSig = d;
        const next = readIrisConfig(dir);
        if (next.ok) goodIris = next;
        iris = next.ok || !goodIris ? next : { ...goodIris, warnings: next.warnings };
      }
      const s = mtime(join(dir, FILE_SERVICES));
      if (manual === undefined || s !== servSig) {
        servSig = s;
        const next = loadManualServices(dir, zone);
        if (next.state !== 'invalid') goodManual = next;
        manual =
          next.state !== 'invalid' || !goodManual
            ? next
            : { ...goodManual, warnings: next.warnings, state: 'invalid' };
      }
      return {
        iris: { config: iris.config, warnings: iris.warnings },
        manual,
      };
    },
  };
}

declare global {
  // oxlint-disable-next-line no-var -- `var` is the only way to declare a global property.
  var __irisConfig: ConfigWatcher | undefined;
}

/**
 * The process-wide config watcher, built on first use from the environment. A singleton on
 * `globalThis`, so the pollers, the route handlers and HMR all share one.
 */
export function getConfigWatcher(): ConfigWatcher {
  if (globalThis.__irisConfig === undefined) {
    const env = loadEnv();
    globalThis.__irisConfig = createConfigWatcher(env.configDir, env.zone);
  }
  return globalThis.__irisConfig;
}
