/** Recorded FundFactory on Robinhood Chain (chain ID 4663). */
export const FUND_FACTORY_ADDRESS = '0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878' as const;

/** Deployed Phase 2 v1 factory. The site must not read or call it. */
export const PHASE2_V1_FACTORY = '0x0849195DCBCD4a06265563dC3ebC4eb1a656aabe' as const;

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
 * Invest factory override. Empty, zero, the Phase 1 factory, and the deployed
 * Phase 2 v1 factory are ignored. Phase 2 v2 has no address yet.
 */
export function getFundInvestFactoryAddress(): `0x${string}` | null {
  const raw = process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS?.trim();
  if (!raw || raw.toLowerCase() === ZERO) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  const lowered = raw.toLowerCase();
  if (lowered === FUND_FACTORY_ADDRESS.toLowerCase()) return null;
  if (lowered === getFundFactoryAddress().toLowerCase()) return null;
  if (lowered === PHASE2_V1_FACTORY.toLowerCase()) return null;
  return raw as `0x${string}`;
}
