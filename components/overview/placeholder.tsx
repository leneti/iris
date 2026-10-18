import { cn } from '@/lib/utils';

/**
 * A faint bar standing in for text that has not arrived. It holds a non-breaking space in the
 * surrounding font, so a row of bars is exactly as tall as a row of words; there is no visible
 * "loading" text. The pulse is for people who have not asked for less motion.
 */
export function Bar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block rounded-[3px] bg-surface-2/70 align-baseline select-none motion-safe:animate-pulse',
        className,
      )}
    >
      &nbsp;
    </span>
  );
}
