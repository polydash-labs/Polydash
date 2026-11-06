/** Recorded FundFactory on Robinhood Chain (chain ID 4663). */
export const FUND_FACTORY_ADDRESS = '0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878' as const;

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * Factory the fund pages read and call.
 * `NEXT_PUBLIC_FUND_FACTORY_ADDRESS` overrides the recorded address.
 * An empty or zero value keeps the recorded address, so a missing env var
 * does not turn the fund pages off.
 */
export function getFundFactoryAddress(): `0x${string}` {
  const raw = process.env.NEXT_PUBLIC_FUND_FACTORY_ADDRESS?.trim();
  if (!raw || raw === ZERO) return FUND_FACTORY_ADDRESS;
  return raw as `0x${string}`;
}

/**
 * Phase 2 factory. Not deployed. An empty value, the zero address, or the
 * Phase 1 factory address keeps the fund pages on the raise factory only.
 */
export function getFundInvestFactoryAddress(): `0x${string}` | null {
  const raw = process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS?.trim();
  if (!raw || raw.toLowerCase() === ZERO) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  if (raw.toLowerCase() === FUND_FACTORY_ADDRESS.toLowerCase()) return null;
  if (raw.toLowerCase() === getFundFactoryAddress().toLowerCase()) return null;
  return raw as `0x${string}`;
}
