'use client';

import { HealthMark } from '@/components/health-mark';
import { JobsPill } from '@/components/jobs/jobs-pill';
import type { CronResponse, ServiceStatus, StatusResponse } from '@/lib/shared/contract';

export type StripView =
  | { kind: 'builtin'; name: string }
  | { kind: 'service'; url: string | null; homeOnly: boolean };

const ORDER: ServiceStatus[] = [
  'healthy',
  'degraded',
  'starting',
  'unhealthy',
  'stopped',
  'unknown',
];

function splitUrl(url: string): { origin: string; host: string; rest: string } | null {
  try {
    const u = new URL(url);
    return { origin: `${u.protocol}//`, host: u.host, rest: `${u.pathname}${u.search}${u.hash}` };
  } catch {
    return null;
  }
}

/** https:// muted, host strong, then the rest, as in the mockups. */
export function Address({ url }: { url: string }) {
  const parts = splitUrl(url);
  return (
    <span className="truncate font-mono text-xs text-text-3">
      {parts ? (
        <>
          {parts.origin}
          <span className="font-medium text-text">{parts.host}</span>
          {parts.rest}
        </>
      ) : (
        url
      )}
    </span>
  );
}

/** 32 px strip under the tab bar: address (or built-in view name), health counts, Jobs pill. */
export function StatusStrip({
  view,
  summary,
  cron,
  onOpenJobs,
}: {
  view: StripView;
  summary: StatusResponse['summary'] | undefined;
  cron: CronResponse | undefined;
  onOpenJobs: () => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-4 border-y border-hairline bg-chrome px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {view.kind === 'builtin' ? (
          <>
            <span className="text-xs text-text-3">Built-in view</span>
            <span className="text-xs font-medium">{view.name}</span>
          </>
        ) : view.url ? (
          <Address url={view.url} />
        ) : (
          <span className="text-xs text-text-3">
            {view.homeOnly ? 'Home network only' : 'No address'}
          </span>
        )}
      </div>
      <ul aria-label="Service health" className="flex shrink-0 items-center gap-3">
        {summary &&
          ORDER.filter((s) => summary[s] > 0).map((s) => (
            <li key={s} className="flex items-center gap-1 text-xs tabular-nums text-text-2">
              <HealthMark status={s} />
              {summary[s]}
            </li>
          ))}
      </ul>
      <JobsPill cron={cron} onOpen={onOpenJobs} />
    </div>
  );
}
