import type { Metadata } from 'next';

/**
 * Search-engine / webmaster verification, config-driven so a code can be
 * dropped in without a code change. Set the matching env var in Vercel
 * (Preview + Production) and redeploy; unset codes simply produce no tag.
 *
 * - Google Search Console: NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
 *   (Search Console > property polypad.family > HTML tag method — copy the
 *   content= value, e.g. "AbCdEf123...".)
 * - Bing Webmaster Tools: NEXT_PUBLIC_BING_SITE_VERIFICATION
 *   (Bing Webmaster > Add site > HTML meta tag — the msvalidate.01 content.)
 * - Yandex Webmaster: NEXT_PUBLIC_YANDEX_VERIFICATION
 * - Yahoo: NEXT_PUBLIC_YAHOO_SITE_VERIFICATION
 * - Pinterest: NEXT_PUBLIC_PINTEREST_SITE_VERIFICATION
 *   (Pinterest > Settings > Claim > website meta tag — the p:domain_verify
 *   content.)
 */
const read = (name: string): string | undefined => process.env[name] || undefined;

export function siteVerification(): Metadata['verification'] | undefined {
  const google = read('NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION');
  const yandex = read('NEXT_PUBLIC_YANDEX_VERIFICATION');
  const yahoo = read('NEXT_PUBLIC_YAHOO_SITE_VERIFICATION');
  const bing = read('NEXT_PUBLIC_BING_SITE_VERIFICATION');
  const pinterest = read('NEXT_PUBLIC_PINTEREST_SITE_VERIFICATION');
  const other: Record<string, string> = {};
  if (bing) other['msvalidate.01'] = bing;
  if (pinterest) other['p:domain_verify'] = pinterest;
  if (!google && !yandex && !yahoo && Object.keys(other).length === 0) return undefined;
  return {
    ...(google ? { google } : {}),
    ...(yandex ? { yandex } : {}),
    ...(yahoo ? { yahoo } : {}),
    ...(Object.keys(other).length ? { other } : {}),
  };
}
