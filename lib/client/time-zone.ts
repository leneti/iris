/** The cookie that tells the server which zone the browser is in, so its greeting matches. */
export const TZ_COOKIE = 'iris-tz';

const ONE_YEAR_S = 365 * 24 * 3600;

/** The value when it names an IANA zone this runtime knows, otherwise undefined. */
export function validTimeZone(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string' || value === '' || value.length > 64) return undefined;
  try {
    const zone = decodeURIComponent(value);
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/** The browser's own zone, or undefined when it cannot say. */
export function browserTimeZone(): string | undefined {
  try {
    return validTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return undefined;
  }
}

/** Keeps the zone for a year so the next page load is rendered for it. */
export function rememberTimeZone(zone: string): void {
  try {
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(zone)}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`;
  } catch {
    // Cookies are off; the server keeps using its own zone for the first render.
  }
}
