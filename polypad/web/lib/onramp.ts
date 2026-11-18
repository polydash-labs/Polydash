// Fiat on-ramp config and links. Front end only, no contracts.

/**
 * MoonPay publishable key. PLACEHOLDER until the live pk_live_ key arrives:
 * set NEXT_PUBLIC_MOONPAY_API_KEY in .env and redeploy. No flow code changes needed.
 */
export const MOONPAY_PLACEHOLDER_KEY = 'YOUR_MOONPAY_PUBLISHABLE_KEY';
export const MOONPAY_API_KEY = process.env.NEXT_PUBLIC_MOONPAY_API_KEY || MOONPAY_PLACEHOLDER_KEY;
export const moonpayKeyIsPlaceholder = () => !MOONPAY_API_KEY.startsWith('pk_');

/** MoonPay currency codes (MoonPay Supported currencies docs). */
export const MOONPAY_ETH_BASE = 'eth_base'; // ETH on Base, then bridge with Relay
export const MOONPAY_USDG_ROBINHOOD = 'usdg_robinhood'; // USDG on Robinhood Chain, then swap to ETH
export type MoonpayCode = typeof MOONPAY_ETH_BASE | typeof MOONPAY_USDG_ROBINHOOD;

/** MoonPay consumer buy flow. Plain link: apiKey/walletAddress params need a partner key and signing. */
export const MOONPAY_BUY_URL = 'https://buy.moonpay.com/';

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

/** Where MoonPay sends the user back: the same page on polypad.family. */
export function moonpayRedirectUrl(): string {
  if (typeof window === 'undefined') return SITE_URL;
  return `${SITE_URL}${window.location.pathname}`;
}
