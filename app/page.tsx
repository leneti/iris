import { cookies, headers } from 'next/headers';
import { AppShell } from '@/components/shell/app-shell';
import { addressMode } from '@/lib/client/address';
import { TZ_COOKIE, validTimeZone } from '@/lib/client/time-zone';
import { getConfigWatcher } from '@/lib/server/config/services';
import { loadEnv } from '@/lib/server/env';
import { isPhoneRequest } from '@/lib/server/request';
import { getSeed } from '@/lib/server/seed';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [h, jar, seed] = await Promise.all([headers(), cookies(), getSeed()]);
  const host = h.get('host');
  const config = getConfigWatcher().get().iris.config;
  // Only the mode and the phone's frame limit reach the client; the zone stays on the server.
  return (
    <AppShell
      mode={addressMode(host, loadEnv().zone, config.addresses)}
      phoneMaxLive={config.phone.maxLiveFrames}
      seed={seed}
      timeZone={validTimeZone(jar.get(TZ_COOKIE)?.value)}
      phoneHint={isPhoneRequest(h)}
    />
  );
}
