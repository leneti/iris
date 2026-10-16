import { defaultDashboardConfig, type DashboardConfig } from '@/lib/server/config/dashboard';
import { discover } from '@/lib/server/discovery/discover';
import type { AppState } from '@/lib/server/state';
import { createState } from '@/lib/server/state';
import { container } from './iris';

export type WidgetService = { id: string; type: string; url?: string; fields?: string };

/** An app state whose discovery holds one service per entry, each with a widget label. */
export function stateWith(services: WidgetService[]): AppState {
  const state = createState();
  state.discovery = discover({
    containers: services.map((s) =>
      container(s.id, {
        labels: {
          'dashboard.enable': 'true',
          [`traefik.http.routers.${s.id}.rule`]: `Host(\`${s.id}.example.invalid\`)`,
          'dashboard.widget': s.type,
          ...(s.url ? { 'dashboard.widget.url': s.url } : {}),
          ...(s.fields ? { 'dashboard.widget.fields': s.fields } : {}),
        },
      }),
    ),
    config: defaultDashboardConfig(),
    manual: { services: [], warnings: [], state: 'missing' },
    zone: 'example.invalid',
    resolveIcon: (i) => ({ kind: 'lucide', name: i.serviceName }),
  });
  return state;
}

export const dashboard: DashboardConfig = defaultDashboardConfig();
