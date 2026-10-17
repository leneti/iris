'use client';

import { useReadingWrong } from '@/components/reading/reading-context';
import { cn } from '@/lib/utils';

/** A lowercase "iris"; the second i is pink, or coral when the reading is wrong. */
export function Wordmark({ className }: { className?: string }) {
  const wrong = useReadingWrong();
  return (
    <span className={cn('font-display text-[22px] font-bold tracking-[-0.02em]', className)}>
      ir
      <span data-slot="wordmark-i" className={wrong ? 'text-down' : 'text-pink'}>
        i
      </span>
      s
    </span>
  );
}
