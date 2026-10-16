import { ExternalLink } from 'lucide-react';
import type { LinkEntry } from '@/lib/shared/contract';

/** One compact 36 px button per link, four to a row. Links leave for the browser, never a frame. */
export function LinksRow({ links }: { links: LinkEntry[] }) {
  if (links.length === 0) return null;
  return (
    <section aria-label="Links">
      <h2 className="flex h-[22px] items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-text-2 uppercase">
        Links
        <span className="font-normal tabular-nums">{links.length}</span>
      </h2>
      <ul className="mt-1 grid grid-cols-4 gap-2">
        {links.map((l) => (
          <li key={l.url} className="min-w-0">
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              title={l.url}
              className="flex h-9 items-center gap-2 rounded-menu border border-hairline-raised bg-raised px-2 outline-none hover:bg-hover-raised focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-tile bg-selected px-1 text-[10px] font-semibold text-text-2"
              >
                {l.abbr}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
              <ExternalLink aria-label="Opens in the browser" className="size-3.5 text-text-3" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
