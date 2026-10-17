'use client';

import { useReading } from '@/components/reading/reading-context';
import type { HourRow } from '@/lib/client/reading';
import { cn } from '@/lib/utils';
import { REGION } from './focus-region';
import { Heading, Quiet } from './heading';

const ROW = 'relative flex items-baseline gap-[10px] text-[14px]';
const DOT =
  'before:absolute before:-left-[22px] before:top-[11px] before:size-[9px] before:rounded-full before:border';
const OPEN = `${DOT} before:border-pink before:bg-bg`;
const DONE = `${DOT} before:border-ok before:bg-ok`;
const FAIL = `${DOT} before:border-down before:bg-down before:shadow-[0_0_0_3px_rgb(255_110_122/.2)]`;
const IDLE = `${DOT} before:border-faint before:bg-bg`;

function Row({ row }: { row: HourRow }) {
  if (row.kind === 'gap') {
    return <li className="py-2 font-serif text-[15px] text-faint italic lg:py-1">{row.text}</li>;
  }
  if (row.kind === 'now') {
    return (
      <li
        className={cn(
          ROW,
          'py-[7px] font-semibold text-pink-soft lg:py-[5px]',
          'before:absolute before:top-1/2 before:-left-[26px] before:-mt-2 before:size-[17px] before:rounded-full before:bg-pink before:shadow-[0_0_0_4px_var(--color-pink-glow),0_0_18px_var(--color-pink)]',
          'after:order-3 after:h-px after:flex-1 after:bg-gradient-to-r after:from-pink after:to-transparent',
        )}
      >
        <span className="w-[42px] flex-none font-mono text-[13px] font-medium">{row.time}</span>
        <span className="min-w-0">now</span>
      </li>
    );
  }
  const failed = row.kind === 'fail' || (row.kind === 'next' && row.failed);
  const dot = failed ? FAIL : row.kind === 'done' ? DONE : row.kind === 'idle' ? IDLE : OPEN;
  return (
    <li className={cn(ROW, 'py-1 lg:py-[3px]', dot)}>
      <span className="w-[42px] flex-none font-mono text-[13px] font-medium text-muted">
        {row.time}
      </span>
      <span className={cn('min-w-0 flex-1', failed && 'text-down')}>{row.name}</span>
      <small className={cn('font-mono text-xs', failed ? 'text-down' : 'text-faint')}>
        {row.note}
      </small>
    </li>
  );
}

/** Maintenance, the quiet hours, now, and what is next. */
export function Hours({ touch: _touch = false }: { touch?: boolean }) {
  const { hours } = useReading();
  return (
    <section id="ov-hours" tabIndex={-1} className={cn(REGION, 'min-w-0')}>
      <Heading>The hours</Heading>
      {'unavailable' in hours ? (
        <Quiet>the schedule isn&apos;t answering</Quiet>
      ) : (
        <ul
          className={cn(
            'relative pl-[22px]',
            'before:absolute before:top-2 before:bottom-2 before:left-1 before:w-px before:bg-line-strong',
          )}
        >
          {hours.rows.map((row, i) => (
            <Row key={i} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
