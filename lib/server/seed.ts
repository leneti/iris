import 'server-only';
import { ENDPOINTS } from '@/lib/shared/endpoints';
import { getConfigWatcher } from './config/services';
import { getCronResponse } from './cron/response';
import { loadEnv, type ServerEnv } from './env';
import { getWidgets } from './integrations/registry';
import { getSystem } from './panels/glances';
import { buildServicesResponse, buildStatusResponse, getState } from './state';

// The page's first render carries the data the Overview needs, so the HTML the server sends
// already holds the circle and the sentence and nothing moves when the browser's polls answer.
// Services and status come from the pollers' memory and cost nothing. The other three call
// upstreams: they are started together and given one shared budget, and whichever has not
// answered by then is left out. The browser fetches it as it always did.

/** How long the page waits for the upstream-backed sources, in total. */
export const SEED_BUDGET_MS = 300;

/** SWR fallback data by endpoint URL, and the server's clock the data was built at (epoch ms). */
export type Seed = { now: number; data: Record<string, unknown> };

type Loader = () => unknown;

/** The value as the API route would send it: through JSON, so a `Date` is the string it becomes. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/**
 * Runs the loaders and collects what they return. `instant` loaders are awaited in full;
 * `budgeted` ones only until `budgetMs` has passed since they started. A loader that throws or
 * rejects, or answers late, is left out: a seed failure never breaks the page.
 */
export async function buildSeed(
  now: number,
  sources: { instant: Record<string, Loader>; budgeted: Record<string, Loader> },
  budgetMs: number = SEED_BUDGET_MS,
): Promise<Seed> {
  const data: Record<string, unknown> = {};
  let open = true;
  const run = async (url: string, load: Loader): Promise<void> => {
    try {
      const value = asJson(await load());
      if (open && value !== undefined) data[url] = value;
    } catch {
      // Leave the key out; the browser fetches it.
    }
  };

  await Promise.all(Object.entries(sources.instant).map(([url, load]) => run(url, load)));

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  const answered = Promise.all(
    Object.entries(sources.budgeted).map(([url, load]) => run(url, load)),
  );
  await Promise.race([answered, expired]);
  clearTimeout(timer);
  open = false;
  return { now, data };
}

let env: ServerEnv | undefined;

/** The seed for `/`: the same builders as the five API routes, called with one `now`. */
export function getSeed(now: number = Date.now()): Promise<Seed> {
  return buildSeed(now, {
    instant: {
      [ENDPOINTS.services]: () => buildServicesResponse(getState(), now),
      [ENDPOINTS.status]: () => buildStatusResponse(getState(), now),
    },
    budgeted: {
      [ENDPOINTS.cron]: () => getCronResponse(new Date(now)),
      [ENDPOINTS.system]: () => getSystem(new Date(now)),
      [ENDPOINTS.widgets]: () => {
        env ??= loadEnv();
        return getWidgets(getState(), getConfigWatcher().get().iris.config, env, now);
      },
    },
  });
}
