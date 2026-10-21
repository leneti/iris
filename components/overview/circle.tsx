'use client';

import { ServiceIcon } from '@/components/service-icon';
import { useReading } from '@/components/reading/reading-context';
import type { Chip, ChipState, CircleGroup } from '@/lib/client/reading';
import { cn } from '@/lib/utils';
import { Heading, Quiet } from './heading';
import { REGION } from './focus-region';
import { Bar } from './placeholder';

/** Away from the phone, as many columns as the Overview's right side has room for. */
const WIDE = 'grid-cols-1 @min-[300px]:grid-cols-2 @min-[540px]:grid-cols-3';

const DOT: Record<ChipState, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  down: 'bg-down',
  idle: 'bg-faint',
};

function label(chip: Chip): string {
  const parts = [chip.name];
  if (chip.figure) parts.push(chip.figure);
  if (chip.state === 'down') parts.push('down');
  if (chip.state === 'warn') parts.push('degraded');
  return parts.join(', ');
}

/**
 * The small word or figure at a chip's right edge. On the phone the name has priority: a word
 * ("degraded", "Healthy") is shortened or dropped, since the dot's colour and the accessible
 * label already carry the state. Null: nothing shown.
 */
export function chipTag(chip: Chip, touch: boolean): string | null {
  if (chip.state === 'down') return 'down';
  if (chip.state === 'warn') return touch ? '!' : 'degraded';
  if (!chip.figure) return null;
  if (touch && !/^[\d↑↓]/.test(chip.figure)) return null;
  return chip.figure;
}

function ChipView({
  chip,
  touch,
  onOpenService,
  onHover,
}: {
  chip: Chip;
  touch: boolean;
  onOpenService: (id: string) => void;
  onHover: (on: boolean) => void;
}) {
  const down = chip.state === 'down';
  const degraded = chip.state === 'warn';
  const tag = chipTag(chip, touch);
  return (
    <button
      type="button"
      aria-label={label(chip)}
      onClick={() => onOpenService(chip.id)}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={cn(
        'flex min-w-0 cursor-pointer items-center gap-[9px] rounded-[12px] border px-[10px] py-[7px] text-left',
        'transition-[border-color,box-shadow] duration-200',
        'hover:border-pink/60 hover:shadow-[0_0_22px_-8px_var(--color-pink-glow)]',
        'focus-visible:border-pink/60 focus-visible:outline-2 focus-visible:outline-pink-soft',
        down ? 'border-down bg-down/8' : 'border-line bg-surface',
        touch && 'min-h-11 gap-[7px] px-[9px] py-[10px]',
      )}
    >
      <ServiceIcon service={chip.service} size={22} />
      <span className="min-w-0 flex-1 shrink truncate font-medium">{chip.name}</span>
      {tag !== null && (
        <em
          className={cn(
            'shrink-[8] truncate font-mono text-xs not-italic',
            down ? 'text-down' : degraded ? 'text-warn' : 'text-faint',
          )}
        >
          {tag}
        </em>
      )}
      <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', DOT[chip.state])} />
    </button>
  );
}

function Group({
  group,
  single,
  touch,
  onOpenService,
  onHover,
}: {
  group: CircleGroup;
  single: boolean;
  touch: boolean;
  onOpenService: (id: string) => void;
  onHover: (on: boolean) => void;
}) {
  return (
    <div data-slot="group" className="mb-[14px] lg:mb-2">
      <h4 className="mb-[6px] font-mono text-[11px] font-medium tracking-[.08em] text-faint lowercase lg:mb-1">
        {group.name}
      </h4>
      <div className={cn('grid gap-[6px]', single ? 'grid-cols-1' : touch ? 'grid-cols-2' : WIDE)}>
        {group.chips.map((chip) => (
          <ChipView
            key={chip.id}
            chip={chip}
            touch={touch}
            onOpenService={onOpenService}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );
}

const PLACEHOLDER_CHIPS = 6;

/** A block of a fixed height for the circle when not even the services are known. */
function Placeholder({ touch }: { touch: boolean }) {
  return (
    <div
      aria-hidden
      data-slot="circle-placeholder"
      className={cn('grid h-[200px] content-start gap-[6px]', touch ? 'grid-cols-2' : WIDE)}
    >
      {Array.from({ length: PLACEHOLDER_CHIPS }, (_, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center gap-[9px] rounded-[12px] border border-line/60 bg-surface/60 px-[10px] py-[7px] motion-safe:animate-pulse',
            touch ? 'min-h-11' : 'h-[38px]',
          )}
        >
          <Bar className="size-[22px] rounded-full" />
          <Bar className="w-3/5" />
        </div>
      ))}
    </div>
  );
}

/** The services as chips, grouped; one-service groups share a row. */
export function Circle({
  onOpenService,
  onHover,
  touch = false,
}: {
  onOpenService: (id: string) => void;
  onHover: (on: boolean) => void;
  touch?: boolean;
}) {
  const { circle } = useReading();
  if ('unavailable' in circle) {
    return (
      <section id="ov-circle" tabIndex={-1} className={cn(REGION, 'mt-10 lg:mt-[22px]')}>
        <Quiet>The circle — not answering</Quiet>
      </section>
    );
  }
  if ('loading' in circle) {
    return (
      <section id="ov-circle" tabIndex={-1} aria-busy="true" className={REGION}>
        <Heading>The circle</Heading>
        <Placeholder touch={touch} />
      </section>
    );
  }
  return (
    <section id="ov-circle" tabIndex={-1} className={REGION}>
      <Heading>
        The circle{' '}
        {circle.shown !== null && (
          <em className="ml-[2px] font-serif text-[15px] font-normal tracking-normal text-faint normal-case italic">
            {circle.shown} shown
          </em>
        )}
      </Heading>
      {circle.rows.map((row, i) =>
        row.kind === 'group' ? (
          <Group
            key={i}
            group={row.group}
            single={false}
            touch={touch}
            onOpenService={onOpenService}
            onHover={onHover}
          />
        ) : (
          <div
            key={i}
            data-slot="pair"
            className={cn('grid gap-x-[6px]', touch ? 'grid-cols-2' : WIDE)}
          >
            {row.groups.map((group) => (
              <Group
                key={group.name}
                group={group}
                single
                touch={touch}
                onOpenService={onOpenService}
                onHover={onHover}
              />
            ))}
          </div>
        ),
      )}
    </section>
  );
}
