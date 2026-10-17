import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A bordered block with a small uppercase title row that names the source and its age. */
export function Panel({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'overflow-hidden rounded-panel border border-hairline-raised bg-raised',
        className,
      )}
    >
      <div className="flex min-h-10 items-center justify-between gap-2 px-4">
        <h2 className="text-[11px] font-semibold tracking-[0.06em] text-text-2 uppercase">
          {title}
        </h2>
        {meta !== undefined && (
          // Text is cut short; a control (the phone's interval select) keeps its focus ring.
          <span className={cn('text-xs text-text-3', typeof meta === 'string' && 'truncate')}>
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export function PanelNote({ children }: { children: ReactNode }) {
  return <p className="px-4 pb-4 text-text-2">{children}</p>;
}
