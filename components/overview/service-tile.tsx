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

  return (
    <button
      type="button"
      data-slot="service-tile"
      data-muted={muted}
      onClick={() => onOpen(service.id)}
      className={cn(
        'flex min-h-[52px] w-full flex-col justify-center rounded-menu border border-hairline-raised bg-raised px-3 py-2 text-left outline-none hover:bg-hover-raised focus-visible:ring-2 focus-visible:ring-ring',
        muted && 'text-text-2',
      )}
    >
      {figures || failed ? (
        <>
          <span className="flex h-7 items-center gap-2.5">
            {icon}
            <span className="min-w-0 flex-1 truncate font-semibold">{service.name}</span>
            {marks}
          </span>
          <span className="mt-1.5 block min-h-[30px]">
            {figures ? <Figures stats={figures} /> : <Unavailable />}
          </span>
        </>
      ) : (
        <span className="flex items-center gap-2.5">
          {icon}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{service.name}</span>
            {service.description && (
              <span className="block truncate text-xs text-text-3">{service.description}</span>
            )}
          </span>
          {marks}
        </span>
      )}
    </button>
  );
}
