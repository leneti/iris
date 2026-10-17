import { ExternalLink } from 'lucide-react';
import type { LinkEntry } from '@/lib/shared/contract';
import { cn } from '@/lib/utils';
import { Panel } from './panel';

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * One row per link: a badge, the name, the hostname under it, and the "leaves Iris" mark. Links
 * leave for the browser, never a frame. `touch` gives 48 px rows for a phone.
 */
export function LinksCard({ links, touch = false }: { links: LinkEntry[]; touch?: boolean }) {
  if (links.length === 0) return null;
  return (
    <Panel title="Links" meta="open in the browser">
      <ul>
        {links.map((l) => (
          <li key={l.url} className="border-t border-hairline-raised">
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              title={l.url}
              className={cn(
                'flex items-center gap-3 px-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                touch
                  ? 'min-h-12 py-1.5'
                  : 'min-h-11 py-1 transition-colors duration-150 hover:bg-hover-raised',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-tile bg-selected font-semibold text-text-2',
                  touch ? 'size-7 text-[11px]' : 'size-6 text-[10px]',
                )}
              >
                {l.abbr}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate', !touch && 'font-medium')}>{l.name}</span>
                <span className="block truncate text-xs text-text-3">{host(l.url)}</span>
              </span>
              <ExternalLink
                aria-label="Opens in the browser"
                className={cn('shrink-0 text-text-3', touch ? 'size-4' : 'size-3.5')}
              />
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
