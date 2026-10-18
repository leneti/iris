import 'server-only';

// Android tablets leave `Mobi` out of the user agent; iPads say neither `iPhone` nor `iPod`.
const MOBILE_UA = /Mobi|iPhone|iPod/;

/**
 * Whether the request comes from a phone, for the first render only: the client hint when the
 * browser sent one (it does so on secure origins), else the user agent. The real screen decides
 * after hydration.
 */
export function isPhoneRequest(headers: Pick<Headers, 'get'>): boolean {
  const hint = headers.get('sec-ch-ua-mobile');
  if (hint !== null) return hint.trim() === '?1';
  return MOBILE_UA.test(headers.get('user-agent') ?? '');
}
