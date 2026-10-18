'use client';

import { useReading } from '@/components/reading/reading-context';
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

/** Markets, the host and the sky, in the order they matter. */
export function Omens({ touch: _touch = false }: { touch?: boolean }) {
  const { markets, host, sky } = useReading().omens;
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
          <div className={OMEN}>
            {host.word}
            {host.parts.length > 0 ? ': ' : ''}
            {host.parts.map((part, i) => (
              <span key={part}>
                {i > 0 && ', '}
                <span className={NUM}>{part}</span>
              </span>
            ))}
            .
          </div>
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
