import 'server-only';
import { z } from 'zod';
import type { Warning } from '@/lib/shared/contract';

// Label schema: handoff §5. Invalid values are ignored (the default applies) with a warning.

export const WIDGET_TYPES = [
  'seerr',
  'tautulli',
  'radarr',
  'sonarr',
  'prowlarr',
  'autobrr',
  'gotify',
  'qbittorrent',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export type IrisLabels = {
  enable?: boolean;
  name?: string;
  group?: string;
  icon?: string;
  url?: string | 'none';
  router?: string;
  lanPort?: number | 'none';
  lanPath?: string;
  embed?: 'auto' | 'true' | 'false';
  widget?: WidgetType | 'none';
  widgetUrl?: string;
  widgetFields?: string[];
  order?: number;
  description?: string;
  keywords?: string[];
  healthUrl?: string | 'none';
  healthPath?: string;
};

const MAX_WIDGET_FIELDS = 4;
const MAX_KEYWORDS = 10;
const MAX_URL_LENGTH = 2048;
const MAX_PATH_LENGTH = 512;

/** True for IPv4 and bracketed IPv6 hostnames, as `URL.hostname` spells them after normalising. */
export function isIpHostname(hostname: string): boolean {
  return hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

// `new URL` rewrites decimal, octal and hex IPv4 spellings (2130706433, 0x7f.1) to dotted form,
// so checking the parsed hostname covers them too.
function isPlainHttpUrl(value: string): boolean {
  if (value.length > MAX_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  return url.hostname !== '' && !isIpHostname(url.hostname);
}

const httpUrl = z.string().refine(isPlainHttpUrl);
const urlOrNone = z.union([z.literal('none'), httpUrl]);
const path = z
  .string()
  .max(MAX_PATH_LENGTH)
  .regex(/^\/(?!\/)[^\s]*$/);
const text = (max: number) => z.string().min(1).max(max);
const integer = z
  .string()
  .regex(/^-?\d{1,15}$/)
  .transform(Number);
const port = z
  .string()
  .regex(/^\d{1,5}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));
const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const icon = z.union([
  slug,
  z.string().regex(/^local:[A-Za-z0-9_][A-Za-z0-9._-]*$/),
  z.string().regex(/^lucide:[a-z0-9][a-z0-9-]*$/),
]);
const fieldKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/);

function list(item: z.ZodString) {
  return z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== ''),
    )
    .pipe(z.array(item).min(1));
}

type Spec = {
  label: string;
  field: keyof IrisLabels;
  expect: string;
  schema: z.ZodType<unknown>;
  /** The list is cut to this many entries, with a warning. */
  max?: number;
  /** An empty value means "not set" and is not a warning. */
  emptyOk?: boolean;
};

const SPECS: Spec[] = [
  {
    label: 'enable',
    field: 'enable',
    expect: 'true or false',
    schema: z.enum(['true', 'false']).transform((v) => v === 'true'),
  },
  { label: 'name', field: 'name', expect: 'text of 1 to 40 characters', schema: text(40) },
  { label: 'group', field: 'group', expect: 'text of 1 to 32 characters', schema: text(32) },
  {
    label: 'icon',
    field: 'icon',
    expect: 'a slug, local:<file> or lucide:<name>',
    schema: icon,
  },
  {
    label: 'url',
    field: 'url',
    expect: 'an http or https address with a host name, or none',
    schema: urlOrNone,
  },
  {
    label: 'router',
    field: 'router',
    expect: 'a Traefik router name',
    schema: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
  },
  {
    label: 'lan.port',
    field: 'lanPort',
    expect: 'a whole number from 1 to 65535, or none',
    schema: z.union([z.literal('none'), port]),
  },
  { label: 'lan.path', field: 'lanPath', expect: 'a path starting with /', schema: path },
  {
    label: 'embed',
    field: 'embed',
    expect: 'auto, true or false',
    schema: z.enum(['auto', 'true', 'false']),
  },
  {
    label: 'widget.url',
    field: 'widgetUrl',
    expect: 'an http or https address with a host name',
    schema: httpUrl,
  },
  {
    label: 'widget.fields',
    field: 'widgetFields',
    expect: 'comma-separated field keys',
    schema: list(fieldKey),
    max: MAX_WIDGET_FIELDS,
  },
  { label: 'order', field: 'order', expect: 'a whole number', schema: integer },
  {
    label: 'description',
    field: 'description',
    expect: 'text of up to 80 characters',
    schema: z.string().max(80),
    emptyOk: true,
  },
  {
    label: 'keywords',
    field: 'keywords',
    expect: 'comma-separated words',
    schema: list(z.string()),
    max: MAX_KEYWORDS,
    emptyOk: true,
  },
  {
    label: 'health.url',
    field: 'healthUrl',
    expect: 'an http or https address with a host name, or none',
    schema: urlOrNone,
  },
  { label: 'health.path', field: 'healthPath', expect: 'a path starting with /', schema: path },
];

const WIDGET_SCHEMA = z.enum([...WIDGET_TYPES, 'none']);

export function parseLabels(
  serviceId: string,
  labels: Record<string, string>,
): { labels: IrisLabels; warnings: Warning[] } {
  const out: Record<string, unknown> = {};
  const warnings: Warning[] = [];
  const warn = (code: string, message: string) => warnings.push({ code, serviceId, message });

  for (const spec of SPECS) {
    const raw = labels[`iris.${spec.label}`];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value === '' && spec.emptyOk) continue;
    const parsed = spec.schema.safeParse(value);
    if (!parsed.success) {
      warn('LABEL_INVALID', `iris.${spec.label} must be ${spec.expect}; the default is used`);
      continue;
    }
    let result = parsed.data;
    if (spec.max !== undefined && Array.isArray(result) && result.length > spec.max) {
      warn(
        'LABEL_INVALID',
        `iris.${spec.label} allows up to ${spec.max} entries; the first ${spec.max} are used`,
      );
      result = result.slice(0, spec.max);
    }
    out[spec.field] = result;
  }

  const widget = labels['iris.widget']?.trim();
  if (widget !== undefined) {
    const parsed = WIDGET_SCHEMA.safeParse(widget);
    if (parsed.success) out.widget = parsed.data;
    else warn('WIDGET_UNKNOWN', 'iris.widget names a widget type that is not supported');
  }

  return { labels: out as IrisLabels, warnings };
}
