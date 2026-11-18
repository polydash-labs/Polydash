/**
 * Server-only switch for fund routes. Funds are public by default (owner
 * request, Nov 9 2026). Set FUND_ROUTES_ENABLED=disabled to hide them again.
 */
export function fundsPublicEnabled(): boolean {
  return process.env.FUND_ROUTES_ENABLED !== 'disabled';
}
