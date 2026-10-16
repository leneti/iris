import type { GroupEntry, ServiceEntry, ServicesResponse } from '@/lib/shared/contract';

export function svc(id: string, name: string, group = 'Media'): ServiceEntry {
  return {
    id,
    name,
    group,
    description: null,
    keywords: [],
    order: 0,
    icon: { kind: 'lucide', name: 'box' },
    url: `https://${id}.example.invalid/`,
    urlSource: 'label',
    lan: { port: 8080, path: '/', source: 'label' },
    embed: { mode: 'auto', verdict: 'allowed', reason: null, checkedAt: null },
    container: id,
    discovery: 'label',
  };
}

export function group(name: string, services: ServiceEntry[]): GroupEntry {
  return { name, icon: null, services };
}

export function servicesResponse(groups: GroupEntry[]): ServicesResponse {
  return {
    generatedAt: '2026-10-16T10:00:00.000Z',
    sources: { docker: 'ok', manual: 'ok' },
    groups,
    links: [],
    warnings: [],
  };
}
