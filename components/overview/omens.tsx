'use client';

import { useReading } from '@/components/reading/reading-context';
import { cn } from '@/lib/utils';
import { REGION } from './focus-region';
import { Heading, Quiet } from './heading';

const GROUP = 'mt-5 first:mt-0 lg:mt-[14px] lg:first:mt-0';
const SUB = 'mb-2 font-mono text-[11px] font-medium tracking-[.12em] text-faint uppercase lg:mb-1';
const OMEN = 'mb-[6px] font-serif text-[21px] leading-[1.3] lg:mb-1 lg:text-[20px]';
const NUM = 'font-mono text-[14px] text-muted';

/** Markets, the host and the sky, in the order they matter. */
export function Omens({ touch: _touch = false }: { touch?: boolean }) {
  const { markets, host, sky } = useReading().omens;
  return (
    <section className="min-w-0">
      <Heading>Omens</Heading>
      {markets !== null && (
        <div className={GROUP}>
          <div className={SUB}>Markets · 24h</div>
          {'unavailable' in markets ? (
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
        {'unavailable' in host ? (
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
          {'unavailable' in sky ? (
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
