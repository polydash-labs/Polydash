/**
 * Server-only switch for fund routes. Unset or any other value keeps them off.
 * This is not a NEXT_PUBLIC variable, so a client bundle or an Abacus resync
 * of the public env does not turn the routes on.
 */
export function fundsPublicEnabled(): boolean {
  return process.env.FUND_ROUTES_ENABLED === 'enabled';
}
