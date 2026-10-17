import { defaultIrisConfig, type IrisConfig } from '@/lib/server/config/iris';
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
          'iris.enable': 'true',
          [`traefik.http.routers.${s.id}.rule`]: `Host(\`${s.id}.example.invalid\`)`,
          'iris.widget': s.type,
          ...(s.url ? { 'iris.widget.url': s.url } : {}),
          ...(s.fields ? { 'iris.widget.fields': s.fields } : {}),
        },
      }),
    ),
    config: defaultIrisConfig(),
    manual: { services: [], warnings: [], state: 'missing' },
    zone: 'example.invalid',
    resolveIcon: (i) => ({ kind: 'lucide', name: i.serviceName }),
  });
  return state;
}

export const irisConfig: IrisConfig = defaultIrisConfig();
