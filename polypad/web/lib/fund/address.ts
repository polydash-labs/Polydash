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
