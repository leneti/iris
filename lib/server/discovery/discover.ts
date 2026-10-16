import 'server-only';
import type { EmbedInfo, IconRef, LinkEntry, ServiceEntry, Warning } from '@/lib/shared/contract';
import { isHttpUrl, resolveLinks, type DashboardConfig } from '../config/dashboard';
import type { ManualService, loadManualServices } from '../config/services';
import type { ContainerSummary } from '../docker/parse';
import { parseLabels, WIDGET_TYPES, type DashboardLabels, type WidgetType } from './labels';
import { buildRouterMap } from './routers';

// Handoff §7.1 steps 3-6 and §8.1.

export type IconInput = {
  label?: string;
  serviceName: string;
  containerName: string | null;
  groupIcon: string;
};

export type HealthTarget =
  | { kind: 'url'; url: string }
  | { kind: 'traefik'; host: string; path: string }
  | { kind: 'none' };

export type WidgetSpec = {
  type: WidgetType | 'cloudflared';
  url: string | null;
  host: string | null;
  fields: string[] | null;
};

export type ResolvedService = ServiceEntry & {
  health: HealthTarget;
  widget: WidgetSpec | null;
  containerName: string | null;
};

export type DiscoverInput = {
  containers: ContainerSummary[];
  config: DashboardConfig;
  manual: ReturnType<typeof loadManualServices>;
  zone: string | undefined;
  resolveIcon: (s: IconInput) => IconRef;
  /** Whether the Docker list could be read; the caller knows, discovery only reports it. */
  docker?: 'ok' | 'unreachable';
};

export type DiscoverResult = {
  groups: { name: string; icon: string; services: ResolvedService[] }[];
  links: LinkEntry[];
  warnings: Warning[];
  sources: { docker: 'ok' | 'unreachable'; manual: 'ok' | 'missing' | 'invalid' };
};

const DEFAULT_GROUP_ICON = 'lucide:layout-grid';
const DEFAULT_ORDER = 100;
const MAX_WIDGET_FIELDS = 4;
// The browser supplies the real origin of a LAN address; this one only proves that the path
// cannot change it.
const LAN_ORIGIN = 'http://lan.invalid';
const ROUTER_RULE_LABEL = /^traefik\.http\.routers\.([A-Za-z0-9][A-Za-z0-9_-]*)\.rule$/;

function routerNames(labels: Record<string, string>): string[] {
  const names: string[] = [];
  for (const key of Object.keys(labels)) {
    const name = ROUTER_RULE_LABEL.exec(key)?.[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

/**
 * Joins a path to an origin with `new URL` and returns the normalised path, or null when the
 * result would leave that origin (a `\` is a `/` in a special URL, so `/\host` escapes).
 */
function pathOnOrigin(path: string, origin: string): string | null {
  try {
    const base = new URL(origin);
    const url = new URL(path, base);
    if (url.origin !== base.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function titleCase(id: string): string {
  return id
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function embedInfo(mode: EmbedInfo['mode'], hasAddress: boolean): EmbedInfo {
  if (mode === 'false') return { mode, verdict: 'blocked', reason: 'label', checkedAt: null };
  if (!hasAddress) return { mode, verdict: 'blocked', reason: 'no-url', checkedAt: null };
  return { mode, verdict: 'unknown', reason: null, checkedAt: null };
}

type Warn = (code: string, message: string) => void;

function resolveHost(
  container: ContainerSummary,
  serviceId: string,
  labels: DashboardLabels,
  routerMap: ReturnType<typeof buildRouterMap>,
  ruleRouters: ReadonlySet<string>,
  warn: Warn,
): string | null {
  if (labels.router !== undefined) {
    const hit = routerMap.get(labels.router);
    if (hit) return hit.host;
    warn(
      ruleRouters.has(labels.router) ? 'ROUTER_NO_HOST' : 'ROUTER_NOT_FOUND',
      ruleRouters.has(labels.router)
        ? `Router "${labels.router}" has no plain Host rule, so it gives no address`
        : `Router "${labels.router}" named by dashboard.router was not found`,
    );
    return null;
  }

  const own = routerNames(container.labels);
  if (own.length === 0) {
    // Without any router there is only a problem when the address was meant to come from one.
    if (labels.url === undefined) warn('ROUTER_NOT_FOUND', 'No router rule found');
    return null;
  }
  const chosen = own.includes(serviceId) ? serviceId : own.length === 1 ? own[0] : undefined;
  if (chosen === undefined) {
    warn(
      'ROUTER_AMBIGUOUS',
      'Several routers and none is named like the service; set dashboard.router',
    );
    return null;
  }
  const host = buildRouterMap([{ container: container.name, labels: container.labels }]).get(
    chosen,
  )?.host;
  if (host === undefined) {
    warn('ROUTER_NO_HOST', `Router "${chosen}" has no plain Host rule, so it gives no address`);
    return null;
  }
  return host;
}

/** True for the zone itself and its subdomains; false when no zone is set. */
function inZone(hostname: string, zone: string | undefined): boolean {
  const z = zone?.trim().toLowerCase().replace(/\.$/, '');
  if (!z) return false;
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return h === z || h.endsWith(`.${z}`);
}

function labelWidget(labels: DashboardLabels, host: string | null, warn: Warn): WidgetSpec | null {
  if (labels.widget === undefined || labels.widget === 'none') return null;
  const url = labels.widgetUrl ?? null;
  if (url === null && host === null) {
    warn('WIDGET_NO_TARGET', 'The widget has no router and no dashboard.widget.url; it is dropped');
    return null;
  }
  return {
    type: labels.widget,
    url,
    host: url === null ? host : null,
    fields: labels.widgetFields ?? null,
  };
}

function manualWidget(widget: ManualService['widget'], warn: Warn): WidgetSpec | null {
  if (widget === undefined) return null;
  const type = widget.type;
  if (type === 'cloudflared') return { type, url: null, host: null, fields: null };
  if (!(WIDGET_TYPES as readonly string[]).includes(type)) {
    warn('WIDGET_UNKNOWN', 'widget.type names a widget type that is not supported');
    return null;
  }
  const rawUrl = widget.url;
  let url: string | null = null;
  if (typeof rawUrl === 'string') {
    if (isHttpUrl(rawUrl)) url = rawUrl;
    else warn('WIDGET_URL_INVALID', 'widget.url is not an http or https address; it is ignored');
  }
  if (url === null) {
    warn('WIDGET_NO_TARGET', 'The widget has no widget.url; it is dropped');
    return null;
  }
  const rawFields = widget.fields;
  const fields =
    Array.isArray(rawFields) &&
    rawFields.length > 0 &&
    rawFields.every((f) => typeof f === 'string')
      ? (rawFields as string[]).slice(0, MAX_WIDGET_FIELDS)
      : null;
  return { type: type as WidgetType, url, host: null, fields };
}

export function discover(input: DiscoverInput): DiscoverResult {
  const { config, manual, zone, resolveIcon } = input;
  const warnings: Warning[] = [];
  const groupIcons = new Map<string, string>();
  for (const g of config.groups)
    if (!groupIcons.has(g.name)) groupIcons.set(g.name, g.icon ?? DEFAULT_GROUP_ICON);
  const groupIcon = (name: string) => groupIcons.get(name) ?? DEFAULT_GROUP_ICON;

  // Step 3: the router map comes from every container, listed or not.
  const sorted = [...input.containers].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const routerMap = buildRouterMap(sorted.map((c) => ({ container: c.name, labels: c.labels })));
  const ruleRouters = new Set(sorted.flatMap((c) => routerNames(c.labels)));

  const services: ResolvedService[] = [];
  const ids = new Set<string>();

  // Step 4: only dashboard.enable=true is listed.
  for (const container of sorted) {
    const id = container.service ?? container.name;
    const rawEnable = container.labels['dashboard.enable'];
    if (rawEnable === undefined) continue;
    const gate = parseLabels(id, { 'dashboard.enable': rawEnable });
    warnings.push(...gate.warnings);
    if (gate.labels.enable !== true) continue;

    if (ids.has(id)) {
      warnings.push({
        code: 'SERVICE_DUPLICATE',
        serviceId: id,
        message: `More than one container has the Compose service "${id}"; the first is used`,
      });
      continue;
    }
    ids.add(id);

    const { labels, warnings: labelWarnings } = parseLabels(id, container.labels);
    warnings.push(...labelWarnings);
    const warn: Warn = (code, message) => warnings.push({ code, serviceId: id, message });

    const host = resolveHost(container, id, labels, routerMap, ruleRouters, warn);

    let url: string | null = null;
    let urlSource: ServiceEntry['urlSource'] = 'none';
    if (labels.url === 'none') {
      // no public address
    } else if (labels.url !== undefined) {
      url = labels.url;
      urlSource = 'label';
    } else if (host !== null) {
      url = `https://${host}/`;
      urlSource = 'traefik-router';
    }

    let lan: ServiceEntry['lan'] = null;
    if (labels.lanPort !== 'none') {
      const port =
        labels.lanPort ??
        (container.publicPorts.length === 1 ? container.publicPorts[0] : undefined);
      if (port !== undefined) {
        let path = '/';
        if (labels.lanPath !== undefined) {
          const safe = pathOnOrigin(labels.lanPath, LAN_ORIGIN);
          if (safe === null)
            warn(
              'LABEL_INVALID',
              'dashboard.lan.path must stay on the same address; the default is used',
            );
          else path = safe;
        }
        lan = { port, path, source: labels.lanPort !== undefined ? 'label' : 'published-port' };
      }
    }

    // Router host first. A service on a file-provider route (Plex) has only its public address,
    // which Traefik can serve only when it is in the zone.
    const labelHost =
      labels.url !== undefined && labels.url !== 'none' ? hostnameOf(labels.url) : null;
    const probeHost = host ?? (labelHost !== null && inZone(labelHost, zone) ? labelHost : null);
    let health: HealthTarget = { kind: 'none' };
    if (labels.healthUrl === 'none') {
      // explicit: no HTTP probe
    } else if (labels.healthUrl !== undefined) {
      health = { kind: 'url', url: labels.healthUrl };
    } else if (probeHost !== null) {
      const host = probeHost;
      let path = '/';
      if (labels.healthPath !== undefined) {
        const safe = pathOnOrigin(labels.healthPath, `http://${host}`);
        if (safe === null)
          warn(
            'LABEL_INVALID',
            'dashboard.health.path must stay on the same address; the default is used',
          );
        else path = safe;
      }
      health = { kind: 'traefik', host, path };
    }

    const group = labels.group ?? config.defaultGroup;
    const mode = labels.embed ?? 'auto';
    services.push({
      id,
      name: labels.name ?? titleCase(id),
      group,
      description: labels.description ?? null,
      keywords: labels.keywords ?? [],
      order: labels.order ?? DEFAULT_ORDER,
      icon: resolveIcon({
        ...(labels.icon !== undefined ? { label: labels.icon } : {}),
        serviceName: id,
        containerName: container.name,
        groupIcon: groupIcon(group),
      }),
      url,
      urlSource,
      lan,
      embed: embedInfo(mode, url !== null || lan !== null),
      container: container.name,
      discovery: 'label',
      health,
      widget: labelWidget(labels, host, warn),
      containerName: container.name,
    });
  }

  // Step 5: manual entries; labels win on an id clash.
  warnings.push(...manual.warnings);
  for (const m of manual.services) {
    if (ids.has(m.id)) {
      warnings.push({
        code: 'SERVICE_ID_CLASH',
        serviceId: m.id,
        message: `services.yaml entry "${m.id}" shares its id with a labelled container; the labels win`,
      });
      continue;
    }
    ids.add(m.id);
    const warn: Warn = (code, message) => warnings.push({ code, serviceId: m.id, message });
    const group = m.group ?? config.defaultGroup;
    services.push({
      id: m.id,
      name: m.name,
      group,
      description: m.description ?? null,
      keywords: m.keywords,
      order: m.order,
      icon: resolveIcon({
        ...(m.icon !== undefined ? { label: m.icon } : {}),
        serviceName: m.id,
        containerName: m.container ?? null,
        groupIcon: groupIcon(group),
      }),
      url: m.url,
      urlSource: m.url === null ? 'none' : 'manual',
      lan: null,
      embed: embedInfo(m.embed, m.url !== null),
      container: m.container ?? null,
      discovery: 'manual',
      // No router or health label here, so only Docker health applies.
      health: { kind: 'none' },
      widget: manualWidget(m.widget, warn),
      containerName: m.container ?? null,
    });
  }

  // Step 6: groups in dashboard.yaml order, unknown ones alphabetically; services by order, name.
  const byGroup = new Map<string, ResolvedService[]>();
  for (const s of services) {
    const list = byGroup.get(s.group);
    if (list) list.push(s);
    else byGroup.set(s.group, [s]);
  }
  const configured = [...groupIcons.keys()];
  const groupNames = [...byGroup.keys()].sort((a, b) => {
    const ia = configured.indexOf(a);
    const ib = configured.indexOf(b);
    if (ia >= 0 || ib >= 0) return ia < 0 ? 1 : ib < 0 ? -1 : ia - ib;
    return a.localeCompare(b, 'en');
  });
  const groups = groupNames.map((name) => ({
    name,
    icon: groupIcon(name),
    services: (byGroup.get(name) ?? []).sort(
      (a, b) =>
        a.order - b.order ||
        a.name.localeCompare(b.name, 'en') ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
  }));

  const resolved = resolveLinks(config, zone);
  warnings.push(...resolved.warnings);

  return {
    groups,
    links: resolved.links,
    warnings,
    sources: { docker: input.docker ?? 'ok', manual: manual.state },
  };
}

/** Strips the server-only fields; what remains is the `/api/services` entry (§8.1). */
export function toPublicService(s: ResolvedService): ServiceEntry {
  const { health: _health, widget: _widget, containerName: _containerName, ...entry } = s;
  return entry;
}
