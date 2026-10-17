'use client';

import { useReading } from '@/components/reading/reading-context';
import { safeHref } from '@/lib/client/reading';
import { cn } from '@/lib/utils';

/** The configured links, then the names of the services watched quietly. */
export function Foot({ touch = false }: { touch?: boolean }) {
  const { links, quiet } = useReading().foot;
  if (links.length === 0 && quiet.length === 0) return null;
  return (
    <footer
      data-slot="overview-foot"
      className="mt-10 border-t border-line pt-5 pb-[30px] text-center lg:mt-auto lg:flex lg:flex-col lg:gap-[6px] lg:pt-3 lg:pb-[14px] lg:text-left"
    >
      {links.length > 0 && (
        <div className="flex flex-wrap justify-center gap-x-[22px] gap-y-2 lg:justify-start lg:gap-x-4 lg:text-[13px]">
          {links.map((link, i) => {
            const href = safeHref(link.url);
            const size = touch ? 'inline-flex min-h-11 items-center' : '';
            return href === null ? (
              <span key={i} className={cn('text-muted', size)}>
                {link.name}
              </span>
            ) : (
              <a
                key={i}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'rounded-sm text-muted underline decoration-line-strong underline-offset-4 outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-soft',
                  size,
                )}
              >
                {link.name}
              </a>
            );
          })}
        </div>
      )}
      {quiet.length > 0 && (
        <div className="mt-[14px] font-serif text-[17px] leading-[1.4] text-muted italic lg:mt-0 lg:text-[15px]">
          {quiet.length} more are watched quietly:{' '}
          <b className="font-mono text-[13px] font-normal text-text not-italic lg:text-xs">
            {quiet.join(', ')}
          </b>
        </div>
      )}
    </footer>
  );
}
