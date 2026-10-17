'use client';

import { Ball } from '@/components/ball/ball';
import { StaticBall } from '@/components/ball/static-ball';
import { useReading } from '@/components/reading/reading-context';
import { SectionBoundary } from '@/components/section-boundary';
import { safeHref, type Meter, type Segment } from '@/lib/client/reading';
import { cn } from '@/lib/utils';
import { focusRegion } from './focus-region';

const FOCUS = 'rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 outline-pink-soft';
const UNDERLINE = 'underline underline-offset-[5px] decoration-1';
const KIND = {
  fact: `text-pink-soft ${UNDERLINE} decoration-pink/50`,
  bad: `text-down italic ${UNDERLINE} decoration-down`,
  strain: `text-warn ${UNDERLINE} decoration-warn`,
} as const;

/**
 * A reading link is inline text; on the phone its box grows 6 px above and below (padding on an
 * inline box does not move the lines) so the tap target is at least 44 px tall.
 */
const TAP = 'py-[6px] sm:py-0';
/** An inline-block button's padding does count in the line, so a negative margin cancels it. */
const TAP_BUTTON = 'py-[4px] -my-[4px] sm:my-0 sm:py-0';

function SegmentView({
  segment,
  onOpenService,
}: {
  segment: Segment;
  onOpenService: (id: string) => void;
}) {
  const { text, kind, target } = segment;
  const tone = kind ? KIND[kind] : '';
  if (!target) return kind ? <span className={tone}>{text}</span> : <>{text}</>;

  if ('tab' in target) {
    return (
      <button
        type="button"
        onClick={() => onOpenService(target.tab)}
        className={cn('cursor-pointer', FOCUS, TAP_BUTTON, tone)}
      >
        {text}
      </button>
    );
  }
  if ('anchor' in target) {
    const { anchor } = target;
    return (
      <a
        href={`#ov-${anchor}`}
        onClick={(e) => {
          e.preventDefault();
          focusRegion(anchor);
        }}
        className={cn(FOCUS, TAP, tone)}
      >
        {text}
      </a>
    );
  }
  // A config-supplied link is only a link when it is http(s).
  const href = safeHref(target.href);
  if (href === null) return <span className={tone}>{text}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(FOCUS, TAP, tone)}>
      {text}
    </a>
  );
}

function MeterView({ meter, wrong }: { meter: Meter; wrong: boolean }) {
  return (
    <span data-slot="meter" className="flex items-center gap-2 whitespace-nowrap">
      {meter.label}
      <i
        aria-hidden
        className="relative inline-block h-1 w-7 overflow-hidden rounded-[2px] bg-surface-2 sm:w-11"
      >
        <i
          data-slot="meter-fill"
          style={{ width: `${meter.percent ?? 0}%` }}
          className={cn('absolute inset-y-0 left-0', wrong ? 'bg-down' : 'bg-pink')}
        />
      </i>
      <b className={cn('font-medium', meter.hot ? 'text-warn' : 'text-text')}>{meter.value}</b>
    </span>
  );
}

const PINK_HAZE =
  'bg-[radial-gradient(closest-side,rgb(242_91_208/.24),rgb(242_91_208/.08)_55%,transparent_100%)]';
const CORAL_HAZE =
  'bg-[radial-gradient(closest-side,rgb(255_110_122/.22),rgb(255_110_122/.07)_55%,transparent_100%)]';

/** The haze, the ball, the meters, the eyebrow and the reading. */
export function Stage({
  onOpenService,
  hover,
  variant = 'desktop',
}: {
  onOpenService: (id: string) => void;
  hover: boolean;
  touch?: boolean;
  variant?: 'desktop' | 'phone';
}) {
  const reading = useReading();
  const phone = variant === 'phone';
  const { wrong } = reading;
  const ball = { ...reading.ball, hoverStrength: hover ? 1 : 0.6, variant };

  return (
    <section data-slot="overview-stage" className="flex flex-col">
      <div
        className={cn(
          'relative mt-2 overflow-hidden lg:mt-0 lg:overflow-visible',
          phone ? 'h-[300px]' : 'h-[420px]',
        )}
      >
        <div
          aria-hidden
          data-slot="haze"
          className={cn(
            'pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-[background] duration-[600ms]',
            phone ? 'size-[420px]' : 'h-[620px] w-[800px]',
            wrong ? CORAL_HAZE : PINK_HAZE,
          )}
        />
        <div
          data-slot="ballbox"
          className={cn(
            'absolute top-0 left-1/2',
            phone ? 'size-[300px] -ml-[150px]' : 'size-[420px] -ml-[210px]',
          )}
        >
          <SectionBoundary name="ball" fallback={<StaticBall color={reading.ball.color} />}>
            <Ball {...ball} />
          </SectionBoundary>
        </div>
      </div>
      <div className="mt-[2px] flex flex-wrap justify-center gap-x-3 gap-y-[6px] font-mono text-[11px] text-faint sm:gap-x-[22px] sm:text-xs">
        <span className="flex items-center gap-2 whitespace-nowrap">
          colour <b className="font-medium text-text">{reading.colour}</b>
        </span>
        <MeterView meter={reading.meters.cpu} wrong={wrong} />
        <MeterView meter={reading.meters.memory} wrong={wrong} />
      </div>
      <div
        data-slot="eyebrow"
        className={cn(
          'mt-4 text-center font-mono text-[11px] font-medium tracking-[.16em] uppercase lg:mt-[22px]',
          wrong ? 'text-down' : 'text-pink-soft',
        )}
      >
        {reading.eyebrow}
      </div>
      <p
        data-slot="reading"
        className={cn(
          'mt-[10px] text-center font-serif leading-[1.28] tracking-[-.005em] text-balance',
          phone ? 'text-[25px]' : reading.long ? 'text-[26px]' : 'text-[28px] lg:text-[30px]',
        )}
      >
        {reading.segments.map((s, i) => (
          <SegmentView key={i} segment={s} onOpenService={onOpenService} />
        ))}
      </p>
    </section>
  );
}
