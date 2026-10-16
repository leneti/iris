'use client';

import { Pause, Play, Radio } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useStreams } from '@/lib/client/api';
import { formatRate } from '@/lib/client/format';
import type { StreamSession } from '@/lib/shared/contract';
import { Panel, PanelNote } from './panel';

const DECISION: Record<StreamSession['decision'], string> = {
  'direct-play': 'Direct play',
  copy: 'Copy',
  transcode: 'Transcode',
};

function StateIcon({ state }: { state: StreamSession['state'] }) {
  const cls = 'size-3';
  if (state === 'paused') return <Pause aria-label="Paused" className={cls} />;
  if (state === 'buffering') return <Radio aria-label="Buffering" className={cls} />;
  return <Play aria-label="Playing" className={cls} />;
}

/** Tautulli's current sessions, from /api/streams. */
export function NowPlayingPanel() {
  const { data } = useStreams();
  if (!data) return <Panel title="Now playing">{<PanelNote>Loading…</PanelNote>}</Panel>;

  const { state } = data.source;
  if (state !== 'ok') {
    const text =
      state === 'not-configured'
        ? 'Not configured'
        : state === 'unauthorized'
          ? 'Not authorised: check the Tautulli key'
          : 'Unreachable';
    return (
      <Panel title="Now playing">
        <PanelNote>{text}</PanelNote>
      </Panel>
    );
  }
  const meta =
    data.streamCount === 0
      ? undefined
      : `${data.streamCount} ${data.streamCount === 1 ? 'stream' : 'streams'} · ${formatRate(data.totalBitsPerSec)}`;
  return (
    <Panel title="Now playing" meta={meta}>
      {data.sessions.length === 0 ? (
        <PanelNote>Nothing is playing</PanelNote>
      ) : (
        <ul>
          {data.sessions.map((s) => (
            <li key={s.id} className="border-t border-hairline-raised px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-semibold">{s.title}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-text-2">
                  <StateIcon state={s.state} />
                  {DECISION[s.decision]}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-text-2">
                <span className="truncate">
                  {s.user !== null ? `${s.user} · ${s.player}` : s.player}
                </span>
                <span className="tabular-nums">{Math.round(s.progressPercent)}%</span>
              </div>
              <Progress
                aria-label={s.title}
                value={s.progressPercent}
                className="mt-2 h-1"
                indicatorClassName="bg-meter-normal"
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
