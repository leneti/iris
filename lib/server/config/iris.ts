import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { LinkEntry, Warning } from '@/lib/shared/contract';
import { log } from '../log';

// ---- schema: every key and default of handoff §7.2 ----
const positive = z.number().positive();
const refresh = (n: number) => positive.default(n);

const IrisSchema = z.object({
  version: z.literal(1).default(1),
  title: z.string().default('Iris'),
  defaultGroup: z.string().default('Other'),
  groups: z.array(z.object({ name: z.string(), icon: z.string().optional() })).default([]),
  cron: z
    .object({
      timezone: z.string().default('Europe/London'),
      staleAfterMinutes: positive.default(60),
      graceMinutes: z.number().min(0).default(10),
      jobs: z
        .array(
          z.object({
            match: z.string(),
            schedule: z.string().optional(),
            label: z.string().optional(),
            graceMinutes: z.number().min(0).optional(),
          }),
        )
        .default([]),
    })
    .prefault({}),
  maintenance: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        schedule: z.string().optional(),
        label: z.string().optional(),
        graceMinutes: z.number().min(0).optional(),
      }),
    )
    .default([]),
  system: z
    .object({
      url: z.string(),
      interface: z.string().default('auto'),
      sensor: z.string().default('auto'),
      disks: z.array(z.object({ mount: z.string(), label: z.string() })).default([]),
      thresholds: z
        .object({ warn: z.number().default(80), bad: z.number().default(90) })
        .prefault({}),
    })
    .optional(),
  streams: z.object({ url: z.string(), showUsers: z.boolean().default(true) }).optional(),
  phone: z.object({ maxLiveFrames: z.number().int().min(1).default(3) }).prefault({}),
  weather: z
    .object({
      label: z.string(),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      timezone: z.string().default('auto'),
      units: z.enum(['metric', 'imperial']).default('metric'),
      refreshMinutes: positive.default(10),
    })
    .optional(),
  links: z.array(z.object({ name: z.string(), abbr: z.string(), url: z.string() })).default([]),
  // Service ids left off the Overview, the sidebar and Services; their health still counts.
  hidden: z.array(z.string()).default([]),
  // 'public': outside the zone, open services at their public address, the LAN port only as a
  // fallback. 'auto' uses the LAN port whenever Iris is opened outside the zone.
  addresses: z.enum(['auto', 'public']).default('auto'),
  widgets: z
    .object({
      refreshSeconds: z
        .object({
          default: refresh(60),
          qbittorrent: refresh(10),
          tautulli: refresh(15),
          radarr: refresh(300),
          prowlarr: refresh(300),
          gotify: refresh(300),
          cloudflared: refresh(300),
          coinmarketcap: refresh(1800),
        })
        .prefault({}),
      standalone: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            group: z.string().optional(),
            icon: z.string().optional(),
            type: z.literal('coinmarketcap'),
            currency: z.string().default('GBP'),
            coins: z.array(z.object({ symbol: z.string(), name: z.string() })).min(1),
            interval: z.enum(['1h', '24h', '7d', '30d']).default('24h'),
          }),
        )
        .default([]),
    })
    .prefault({}),
});

export type IrisConfig = z.infer<typeof IrisSchema>;

export const FILE_IRIS = 'iris.yaml';

export function defaultIrisConfig(): IrisConfig {
  return IrisSchema.parse({});
}

// ---- shared helpers (also used by services.ts) ----
export type ReadResult =
  | { state: 'missing' }
  | { state: 'invalid'; warning: Warning }
  | { state: 'ok'; data: unknown };

export function readYamlFile(dir: string, file: string): ReadResult {
  let text: string;
  try {
    text = readFileSync(join(dir, file), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' };
    return invalid(file, 'cannot be read');
  }
  try {
    return { state: 'ok', data: parse(text) ?? {} };
  } catch (error) {
    // Never echo YAML content: only the position of the first problem.
    const pos = (error as { linePos?: [{ line: number }] }).linePos?.[0];
    return invalid(file, `is not valid YAML${pos ? ` (line ${pos.line})` : ''}`);
  }
}

export function invalid(file: string, reason: string): ReadResult & { state: 'invalid' } {
  const message = `${file} ${reason}`;
  log.warn('config file ignored', { file, reason });
  return { state: 'invalid', warning: { code: 'CONFIG_INVALID', message } };
}

export function schemaProblem(file: string, error: z.ZodError): Warning {
  const issue = error.issues[0];
  const where = issue?.path.join('.') || '(top level)';
  log.warn('config file ignored', { file, path: where });
  return {
    code: 'CONFIG_INVALID',
    message: `${file} is invalid at ${where}: ${issue?.message ?? ''}`,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keys present in the raw input but dropped by the schema. */
export function unknownKeyWarnings(
  file: string,
  raw: unknown,
  parsed: unknown,
  path: string[] = [],
): Warning[] {
  if (Array.isArray(raw) && Array.isArray(parsed))
    return raw.flatMap((item, i) => unknownKeyWarnings(file, item, parsed[i], [...path, `${i}`]));
  if (!isRecord(raw) || !isRecord(parsed)) return [];
  return Object.keys(raw).flatMap((key) =>
    key in parsed
      ? unknownKeyWarnings(file, raw[key], parsed[key], [...path, key])
      : [
          {
            code: 'CONFIG_UNKNOWN_KEY',
            message: `${file}: unknown key ${[...path, key].join('.')} is ignored`,
          },
        ],
  );
}

// ---- iris.yaml ----
export type IrisLoad = { config: IrisConfig; warnings: Warning[]; ok: boolean };

/** Like loadIrisConfig, but says whether the file parsed (the watcher keeps the last good one). */
export function readIrisConfig(dir: string): IrisLoad {
  const read = readYamlFile(dir, FILE_IRIS);
  if (read.state === 'missing') return { config: defaultIrisConfig(), warnings: [], ok: true };
  if (read.state === 'invalid')
    return { config: defaultIrisConfig(), warnings: [read.warning], ok: false };
  const result = IrisSchema.safeParse(read.data);
  if (!result.success)
    return {
      config: defaultIrisConfig(),
      warnings: [schemaProblem(FILE_IRIS, result.error)],
      ok: false,
    };
  return {
    config: result.data,
    warnings: unknownKeyWarnings(FILE_IRIS, read.data, result.data),
    ok: true,
  };
}

export function loadIrisConfig(dir: string): { config: IrisConfig; warnings: Warning[] } {
  const { config, warnings } = readIrisConfig(dir);
  return { config, warnings };
}

// ---- {zone} and links ----
/** Replaces `{zone}`. Null when the address needs the zone and it is not set. */
export function fillZone(url: string, zone: string | undefined): string | null {
  if (!url.includes('{zone}')) return url;
  return zone ? url.replaceAll('{zone}', zone) : null;
}

export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveLinks(
  config: Pick<IrisConfig, 'links'>,
  zone: string | undefined,
): { links: LinkEntry[]; warnings: Warning[] } {
  const links: LinkEntry[] = [];
  const warnings: Warning[] = [];
  for (const link of config.links) {
    const url = fillZone(link.url, zone);
    const problem =
      url === null
        ? 'needs {zone} but IRIS_ZONE is not set'
        : !isHttpUrl(url)
          ? 'is not an http or https address'
          : link.abbr.length === 0 || link.abbr.length > 3
            ? 'needs an abbreviation of 1 to 3 characters'
            : null;
    if (problem || url === null) {
      warnings.push({
        code: 'LINK_INVALID',
        message: `Link "${link.name}" ${problem} and was dropped`,
      });
      continue;
    }
    links.push({ name: link.name, abbr: link.abbr, url });
  }
  return { links, warnings };
}
