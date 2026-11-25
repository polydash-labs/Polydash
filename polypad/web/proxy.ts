import { NextResponse, type NextRequest } from 'next/server';

const REDIRECTS: [RegExp, string][] = [
  [/^\/staking\/?$/i, '/stake'],
  [/^\/mint\/?$/i, '/nfts'],
];

// Security headers for every page and API route. (Set here because next.config is platform-managed.)
// Enforced CSP is limited to framing and base/object lockdown. The broader policy runs report-only so
// it can't break wallets (WalletConnect relay, injected providers), the chain RPC, explorer/Sourcify
// links, remote token logos, presigned uploads or the analytics script.
const CSP_ENFORCED = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apps.abacus.ai",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https:",
  "worker-src 'self' blob:",
  "media-src 'self' https: data: blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS: [string, string][] = [
  ['Content-Security-Policy', CSP_ENFORCED],
  ['Content-Security-Policy-Report-Only', CSP_REPORT_ONLY],
  ['X-Frame-Options', 'DENY'],
  ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
];

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const target = REDIRECTS.find(([re]) => re.test(path))?.[1];
  const res = target ? NextResponse.redirect(new URL(target, req.url), 308) : NextResponse.next();
  for (const [k, v] of SECURITY_HEADERS) res.headers.set(k, v);
  return res;
}

export const config = {
  // Everything except hashed build assets (immutable files, no need to run the proxy for them).
  matcher: ['/((?!_next/static|_next/image).*)'],
};
