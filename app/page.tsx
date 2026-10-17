import { headers } from 'next/headers';
import { AppShell } from '@/components/shell/app-shell';
import { addressMode } from '@/lib/client/address';
import { getConfigWatcher } from '@/lib/server/config/services';
import { loadEnv } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const host = (await headers()).get('host');
  // Only the mode and the phone's frame limit reach the client; the zone stays on the server.
  return (
    <AppShell
      mode={addressMode(host, loadEnv().zone)}
      phoneMaxLive={getConfigWatcher().get().iris.config.phone.maxLiveFrames}
    />
  );
}
