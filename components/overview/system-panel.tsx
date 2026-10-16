'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useSystem } from '@/lib/client/api';
import {
  formatAge,
  formatBytes,
  formatDuration,
  formatPercent,
  formatRate,
} from '@/lib/client/format';
import type { SystemResponse } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';
import { useNow, secondsSince } from '@/components/jobs/time';
import { Panel, PanelNote } from './panel';

type Level = SystemResponse['cpu']['level'];

const FILL: Record<Level, string> = {
  ok: 'bg-meter-normal',
  warn: 'bg-meter-warning',
  bad: 'bg-meter-critical',
};
const TEXT: Record<Level, string> = {
  ok: 'text-text',
  warn: 'text-status-degraded-text',
  bad: 'text-status-unhealthy-text',
};

function MeterRow({
  name,
  sub,
  percent,
  level,
  stale,
}: {
  name: string;
  sub: string;
  percent: number | null;
  level: Level;
  stale: boolean;
}) {
  return (
    <div className="flex min-h-[42px] items-center gap-3 px-4 py-1">
      <div className="w-[140px] shrink-0">
        <div className="font-semibold">{name}</div>
        <div className="truncate text-[11px] text-text-3">{sub}</div>
      </div>
      <Progress
        aria-label={name}
        value={percent ?? 0}
        className="h-1.5 flex-1"
        indicatorClassName={stale ? 'bg-meter-normal' : FILL[level]}
      />
      <span
        className={cn(
          'w-11 text-right font-semibold tabular-nums',
          stale ? 'text-text-3' : TEXT[level],
        )}
      >
        {formatPercent(percent)}
      </span>
    </div>
  );
}

/** The phone's 2-column cell: name, a large figure, the meter, then the detail line. */
function MeterCell({
  name,
  sub,
  percent,
  level,
  stale,
  wide,
  second,
}: {
  name: string;
  sub: string;
  percent: number | null;
  level: Level;
  stale: boolean;
  /** Spans both columns (an odd last cell). */
  wide: boolean;
  /** In the right column: a hairline on its left. */
  second: boolean;
}) {
  return (
    <div
      className={cn(
        'border-t border-hairline-raised px-4 py-3',
        wide && 'col-span-2',
        second && !wide && 'border-l',
      )}
    >
      <div className="text-text-2">{name}</div>
      <div
        className={cn(
          'mt-0.5 text-xl font-semibold tabular-nums',
          stale ? 'text-text-3' : TEXT[level],
        )}
      >
        {formatPercent(percent).replace(' %', '%')}
      </div>
      <Progress
        aria-label={name}
        value={percent ?? 0}
        className="mt-1.5 h-1.5"
        indicatorClassName={stale ? 'bg-meter-normal' : FILL[level]}
      />
      <div className="mt-1.5 truncate text-xs text-text-3">{sub}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-[30px] items-center justify-between px-4">
      <span className="text-text-2">{label}</span>
      <span className="font-semibold tabular-nums">{children}</span>
    </div>
  );
}

function freeOf(free: number | null, total: number | null): string {
  return `${formatBytes(free)} free of ${formatBytes(total)}`;
}

/** CPU, memory, configured disks, network, temperature and uptime, from /api/system. */
export function SystemPanel({ variant = 'desktop' }: { variant?: 'desktop' | 'phone' }) {
  const { data } = useSystem();
  const now = useNow();
  if (!data) return <Panel title="System">{<PanelNote>Loading…</PanelNote>}</Panel>;

  const { state, fetchedAt } = data.source;
  const age = secondsSince(fetchedAt, now);
  const meta = state === 'ok' ? `Glances · ${formatAge(age)}` : 'Glances';
  if (state === 'not-configured') {
    return (
      <Panel title="System" meta={meta}>
        <PanelNote>Not configured</PanelNote>
      </Panel>
    );
  }
  // The server keeps the last values for a minute after Glances stops answering; they are muted.
  const stale = state !== 'ok';
  const { cpu, memory, disks, network, temperature } = data;
  const load = cpu.load?.[0];
  const phone = variant === 'phone';
  const celsius = temperature?.celsius;
  const cells = [
    {
      name: 'CPU',
      sub: [
        load != null ? `load ${load}` : null,
        celsius != null ? `${Math.round(celsius)} °C` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      percent: cpu.percent,
      level: cpu.level,
    },
    {
      name: 'Memory',
      sub: freeOf(memory.freeBytes, memory.totalBytes),
      percent: memory.percent,
      level: memory.level,
    },
    ...disks.map((d) => ({
      name: d.label,
      sub: freeOf(d.freeBytes, d.totalBytes),
      percent: d.percent,
      level: d.level,
    })),
  ];
  return (
    <Panel title="System" meta={meta}>
      {stale && (
        <p className="px-4 pb-2 text-status-degraded-text">
          Unreachable{age !== null ? ` · last data ${formatAge(age)}` : ''}
        </p>
      )}
      {phone ? (
        <div className="grid grid-cols-2">
          {cells.map((c, i) => (
            <MeterCell
              key={c.name}
              {...c}
              stale={stale}
              wide={cells.length % 2 === 1 && i === cells.length - 1}
              second={i % 2 === 1}
            />
          ))}
        </div>
      ) : (
        <div className="border-t border-hairline-raised">
          <MeterRow
            name="CPU"
            sub={[cpu.name, load != null ? `load ${load}` : null].filter(Boolean).join(' · ')}
            percent={cpu.percent}
            level={cpu.level}
            stale={stale}
          />
          <MeterRow
            name="Memory"
            sub={freeOf(memory.freeBytes, memory.totalBytes)}
            percent={memory.percent}
            level={memory.level}
            stale={stale}
          />
          {disks.map((d) => (
            <MeterRow
              key={d.label}
              name={d.label}
              sub={freeOf(d.freeBytes, d.totalBytes)}
              percent={d.percent}
              level={d.level}
              stale={stale}
            />
          ))}
        </div>
      )}
      <div className={cn('border-t border-hairline-raised py-1', stale && 'text-text-3')}>
        <Row label="Network">
          <span className="inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <ArrowDown aria-label="Download" className="size-3" />
              {formatRate(network.rxBitsPerSec)}
            </span>
            <span className="inline-flex items-center gap-1">
              <ArrowUp aria-label="Upload" className="size-3" />
              {formatRate(network.txBitsPerSec)}
            </span>
          </span>
        </Row>
        {temperature && !phone && (
          <Row label="CPU temperature">
            <span className={stale ? undefined : TEXT[temperature.level]}>
              {temperature.celsius === null ? '—' : `${Math.round(temperature.celsius)} °C`}
            </span>
          </Row>
        )}
        {!phone && <Row label="Uptime">{formatDuration(data.uptimeSeconds)}</Row>}
      </div>
    </Panel>
  );
}
