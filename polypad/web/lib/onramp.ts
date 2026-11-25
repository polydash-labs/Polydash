// Fiat on-ramp config and links. Front end only, no contracts.
//
// Relay is the only buy-ETH path. MoonPay was removed (Nov 2026): the
// widget, the publishable-key config and the after-purchase flow are gone.
// Do not re-add a MoonPay path without a fresh decision.

export const SITE_URL = 'https://polypad.family';
export const ROBINHOOD_CHAIN_ID = 4663;
export const BASE_CHAIN_ID = 8453;
export const WETH_4663 = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
export const USDG_4663 = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';

const isAddr = (a?: string | null): a is string => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);

/** Relay card on-ramp straight to Robinhood Chain. ETH by default; USDG adds toCurrency. */
export function relayOnrampUrl(wallet?: string | null, usdg = false): string {
  const p = new URLSearchParams();
  if (isAddr(wallet)) p.set('toAddress', wallet);
  if (usdg) p.set('toCurrency', USDG_4663);
  const q = p.toString();
  return `https://relay.link/onramp/robinhood${q ? `?${q}` : ''}`;
}

/** Relay bridge Base → Robinhood Chain. amount is ETH (decimal string), omitted when empty. */
export function relayBridgeUrl(wallet?: string | null, amount?: string | number | null): string {
  const p = new URLSearchParams({ fromChainId: String(BASE_CHAIN_ID) });
  if (isAddr(wallet)) p.set('toAddress', wallet);
  const a = amount == null ? '' : String(amount).trim();
  if (a && Number(a) > 0) p.set('amount', a);
  return `https://relay.link/bridge/robinhood?${p.toString()}`;
}
