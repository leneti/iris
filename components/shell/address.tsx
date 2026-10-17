'use client';

function splitUrl(url: string): { origin: string; host: string; rest: string } | null {
  try {
    const u = new URL(url);
    return { origin: `${u.protocol}//`, host: u.host, rest: `${u.pathname}${u.search}${u.hash}` };
  } catch {
    return null;
  }
}

/** https:// muted, host strong, then the rest, as in the mockups. */
export function Address({ url }: { url: string }) {
  const parts = splitUrl(url);
  return (
    <span className="truncate font-mono text-xs text-text-3">
      {parts ? (
        <>
          {parts.origin}
          <span className="font-medium text-text">{parts.host}</span>
          {parts.rest}
        </>
      ) : (
        url
      )}
    </span>
  );
}
