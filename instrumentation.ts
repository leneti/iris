// Starts the Docker and health pollers once per server process (handoff D1.4).
// The Edge runtime never gets the pollers: everything below is imported dynamically, behind the
// runtime check, so the Edge bundle of this file stays free of Node-only code.

declare global {
  // oxlint-disable-next-line no-var -- `var` is the only way to declare a global property.
  var __irisPollers: { stop(): void } | undefined;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // HMR re-runs this module; the global survives it.
  if (globalThis.__irisPollers) return;

  const [{ loadEnv }, { getConfigWatcher }, { fetchContainers }, { probe }, { getIconStore }] =
    await Promise.all([
      import('./lib/server/env'),
      import('./lib/server/config/services'),
      import('./lib/server/docker/client'),
      import('./lib/server/health/probe'),
      import('./lib/server/icons/store'),
    ]);
  const { startPollers } = await import('./lib/server/poller');

  // Another register() call may have won while the imports were loading.
  if (globalThis.__irisPollers) return;
  const env = loadEnv();
  globalThis.__irisPollers = startPollers({
    env,
    fetchContainers,
    probe: (target, e) => probe(target, e),
    config: getConfigWatcher(),
    icons: getIconStore(),
  });
}
