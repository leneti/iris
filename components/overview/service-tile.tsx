import { HealthMark } from '@/components/health-mark';
import { ServiceIcon } from '@/components/shell/sidebar-row';
import type { ServiceEntry, ServiceStatus, ServiceWidget } from '@/lib/shared/contract';
import { Figures, isFailed, Unavailable } from './figures';
import { cn } from '@/lib/utils';

export function ServiceTile({
  service,
  status,
  open,
  widget,
  onOpen,
}: {
  service: ServiceEntry;
  status: ServiceStatus;
  open: boolean;
  widget: ServiceWidget | undefined;
  onOpen: (id: string) => void;
}) {
  const muted = status === 'stopped';
  const failed = widget !== undefined && isFailed(widget.state);
  const figures = widget?.state === 'ok' && widget.stats.length > 0 ? widget.stats : null;
  const marks = (
    <>
      {open && (
        <span
          aria-label="Open in a tab"
          className="size-1.5 shrink-0 rounded-full bg-accent-mark"
        />
      )}
      <HealthMark status={status} />
    </>
  );
  const icon = (
    <span className={cn('flex', muted && 'opacity-50')}>
      <ServiceIcon service={service} size={28} />
    </span>
  );

  const base =
    'w-full rounded-panel border border-hairline-raised bg-raised text-left outline-none transition-colors duration-150 hover:border-hairline-strong hover:bg-hover-raised focus-visible:ring-2 focus-visible:ring-ring';

  // With figures (or a failed read) the tile is a card: a header row, then the figures strip.
  if (figures || failed) {
    return (
      <button
        type="button"
        data-slot="service-tile"
        data-muted={muted}
        onClick={() => onOpen(service.id)}
        className={cn(base, 'flex flex-col gap-2.5 p-3', muted && 'text-text-2')}
      >
        <span className="flex items-center gap-2.5">
          {icon}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{service.name}</span>
            {service.description && (
              <span className="block truncate text-xs text-text-3">{service.description}</span>
            )}
          </span>
          {marks}
        </span>
        <span className="block">
          {figures ? (
            <Figures stats={figures} />
          ) : (
            <span className="flex min-h-[52px] items-center rounded-tile border border-hairline-raised bg-well px-2.5">
              <Unavailable />
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-slot="service-tile"
      data-muted={muted}
      onClick={() => onOpen(service.id)}
      className={cn(
        base,
        'flex min-h-[52px] items-center gap-2.5 px-3 py-2',
        muted && 'text-text-2',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{service.name}</span>
        {service.description && (
          <span className="block truncate text-xs text-text-3">{service.description}</span>
        )}
      </span>
      {marks}
    </button>
  );
}
