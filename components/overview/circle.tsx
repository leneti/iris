'use client';

import { ServiceIcon } from '@/components/service-icon';
import { useReading } from '@/components/reading/reading-context';
import type { Chip, ChipState, CircleGroup } from '@/lib/client/reading';
import { cn } from '@/lib/utils';
import { Heading, Quiet } from './heading';
import { REGION } from './focus-region';

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
        'flex min-w-0 cursor-pointer items-center gap-[9px] rounded-[12px] border px-[10px] py-[7px] text-left outline-none',
        'transition-[border-color,box-shadow] duration-200',
        'hover:border-pink/60 hover:shadow-[0_0_22px_-8px_var(--color-pink-glow)]',
        'focus-visible:border-pink/60 focus-visible:outline-2 focus-visible:outline-pink-soft',
        down ? 'border-down bg-down/8' : 'border-line bg-surface',
        touch && 'min-h-11 py-[10px]',
      )}
    >
      <ServiceIcon service={chip.service} size={22} />
      <span className="min-w-0 flex-1 truncate font-medium">{chip.name}</span>
      {(down || chip.figure) && (
        <em className={cn('font-mono text-xs not-italic', down ? 'text-down' : 'text-faint')}>
          {down ? 'down' : chip.figure}
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
      <div
        className={cn(
          'grid gap-[6px]',
          single ? 'grid-cols-1' : touch ? 'grid-cols-2' : 'grid-cols-3',
        )}
      >
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
  return (
    <section id="ov-circle" tabIndex={-1} className={REGION}>
      <Heading>
        The circle{' '}
        <em className="ml-[2px] font-serif text-[15px] font-normal tracking-normal text-faint normal-case italic">
          {circle.shown} shown
        </em>
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
            className={cn('grid gap-x-[6px]', touch ? 'grid-cols-2' : 'grid-cols-3')}
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
