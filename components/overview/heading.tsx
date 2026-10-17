import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A section heading: mono, spaced capitals between two fading rules. */
export function Heading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        'mt-10 mb-4 flex items-center gap-[14px] font-mono text-xs font-medium tracking-[.16em] text-muted uppercase lg:mt-[22px] lg:mb-3',
        'before:h-px before:flex-1 before:bg-gradient-to-r before:from-transparent before:to-line-strong',
        'after:h-px after:flex-1 after:bg-gradient-to-l after:from-transparent after:to-line-strong',
        className,
      )}
    >
      {children}
    </h2>
  );
}

/** A quiet line for a part whose source is not answering. */
export function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('font-serif text-[15px] text-faint italic', className)}>{children}</p>;
}
