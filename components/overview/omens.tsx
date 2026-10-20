'use client';

import { useReading } from '@/components/reading/reading-context';
import type { Storage } from '@/lib/client/reading';
import { cn } from '@/lib/utils';
import { REGION } from './focus-region';
import { Heading, Quiet } from './heading';
import { Bar } from './placeholder';

const GROUP = 'mt-5 first:mt-0 lg:mt-[14px] lg:first:mt-0';
const SUB = 'mb-2 font-mono text-[11px] font-medium tracking-[.12em] text-faint uppercase lg:mb-1';
const OMEN = 'mb-[6px] font-serif text-[21px] leading-[1.3] lg:mb-1 lg:text-[20px]';
const NUM = 'font-mono text-[14px] text-muted';

/** One faint line as tall as a real omen. */
function Line() {
  return (
    <div data-slot="omen-placeholder" className={OMEN}>
      <Bar className="w-3/4" />
    </div>
  );
}

const PINK_FILL =
  'bg-[linear-gradient(90deg,rgb(242_91_208/.55),var(--color-pink))] shadow-[0_0_10px_var(--color-pink-glow)]';

/** The fullest disk as a bar under the host's figures; coral like the meters when wrong. */
function StorageBar({ storage, wrong }: { storage: Storage; wrong: boolean }) {
  return (
    <div
      data-slot="storage"
      className="mt-[10px] flex items-center gap-3 font-mono text-xs whitespace-nowrap"
    >
      <span className="tracking-[.06em] text-faint">storage</span>
      <i
        aria-hidden
        className="relative block h-2 min-w-[60px] flex-1 overflow-hidden rounded-full bg-surface-2"
      >
        <i
          data-slot="storage-fill"
          style={{ width: `${storage.percent}%` }}
          className={cn('absolute inset-y-0 left-0 rounded-full', wrong ? 'bg-down' : PINK_FILL)}
        />
      </i>
      {/* "used" says which end of the bar is filled. */}
      <span>
        <b className={cn('font-medium', storage.hot ? 'text-warn' : 'text-text')}>
          {storage.value}
        </b>{' '}
        <span className="text-faint">used</span>
      </span>
      {storage.space && <span className="text-muted">{storage.space}</span>}
    </div>
  );
}

/** Markets, the host and the sky, in the order they matter. */
export function Omens({ touch: _touch = false }: { touch?: boolean }) {
  const { omens, wrong } = useReading();
  const { markets, host, sky } = omens;
  const busy =
    (markets !== null && 'loading' in markets) ||
    'loading' in host ||
    (sky !== null && 'loading' in sky);
  return (
    <section aria-busy={busy || undefined} className="min-w-0">
      <Heading>Omens</Heading>
      {markets !== null && (
        <div className={GROUP}>
          <div className={SUB}>Markets · 24h</div>
          {'loading' in markets ? (
            <Line />
          ) : 'unavailable' in markets ? (
            <Quiet>not answering</Quiet>
          ) : (
            markets.lines.map((line, i) => (
              <div key={`${line.name}-${i}`} className={OMEN}>
                {line.name}{' '}
                {line.move && (
                  <span
                    className={cn(
                      'mr-[.3em] font-mono text-[13px] font-medium',
                      line.move.dir === 'rose' ? 'text-ok' : 'text-down',
                    )}
                  >
                    {line.move.dir} {line.move.pct}%
                  </span>
                )}
                {line.move && 'to '}
                <span className={NUM}>{line.price}</span>
              </div>
            ))
          )}
        </div>
      )}
      <div id="ov-host" tabIndex={-1} className={cn(GROUP, REGION)}>
        <div className={SUB}>The host</div>
        {'loading' in host ? (
          <Line />
        ) : 'unavailable' in host ? (
          <Quiet>—</Quiet>
        ) : (
          <>
            <div className={OMEN}>
              {host.word}
              {host.parts.length > 0 ? ': ' : ''}
              {host.parts.map((part, i) => (
                <span key={part}>
                  {i > 0 && (
                    <span className="font-mono text-[14px] whitespace-pre text-faint"> | </span>
                  )}
                  <span className={NUM}>{part}</span>
                </span>
              ))}
              .
            </div>
            {host.storage && <StorageBar storage={host.storage} wrong={wrong} />}
          </>
        )}
      </div>
      {sky !== null && (
        <div id="ov-sky" tabIndex={-1} className={cn(GROUP, REGION)}>
          {'loading' in sky ? (
            <>
              <div className={SUB}>The sky</div>
              <Line />
            </>
          ) : 'unavailable' in sky ? (
            <Quiet>The sky — not answering</Quiet>
          ) : (
            <>
              <div className={SUB}>The sky</div>
              <div className={OMEN}>{sky.text}</div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
