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
 * Live Phase 2 addresses on Robinhood Chain (chain ID 4663).
 * Source commit e4ceacaab5175bc4e7724fafe3fedc8831085563.
 * Recorded here so the deployment is in the repo. The getter below does not
 * return them until NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS is set, and fund
 * routes stay off unless FUND_ROUTES_ENABLED is exactly `enabled`.
 */
export const PHASE2_SOURCE_COMMIT = 'e4ceacaab5175bc4e7724fafe3fedc8831085563' as const;
export const FUND_INVEST_FACTORY_ADDRESS = '0xd3c6ae470c25989cC8d2876c1855fB570B98894E' as const;
export const FUND_SWAP_FACET_ADDRESS = '0xA2620b14d1A39d4afbEAA4b87a7E7871050b50a0' as const;
export const FUND_ROUTER_ADAPTER_ADDRESS = '0xA5187f8e56Dd0784624D833CEE3bF6f2Aa5E7581' as const;
export const FUND_ALLOWLIST_ADDRESS = '0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19' as const;

/**
 * Live Phase 3 addresses on Robinhood Chain (chain ID 4663).
 * Source commit 0848c9c6271537ad5601415ad9f43fed5280169c.
 * Recorded only. These constants are not read by the fund pages, and
 * FUND_ROUTES_ENABLED stays off.
 */
export const PHASE3_SOURCE_COMMIT = '0848c9c6271537ad5601415ad9f43fed5280169c' as const;
export const STRATEGY_TEMPLATE_ADDRESS = '0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba' as const;
export const FUND_SWAP_FACET_PHASE3_ADDRESS = '0x40Ef3ae910A46aDDC14f45F0983060161884f045' as const;
export const FUND_FACTORY_PHASE3_ADDRESS = '0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B' as const;

/**
 * Phase 2 factory the fund pages will call once an operator sets
 * `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS`. An empty value, the zero address,
 * or the Phase 1 factory address keeps the pages on the raise factory only.
 * The recorded live address is not selected by default.
 */
export function getFundInvestFactoryAddress(): `0x${string}` | null {
  const raw = process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS?.trim();
  if (!raw || raw.toLowerCase() === ZERO) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  if (raw.toLowerCase() === FUND_FACTORY_ADDRESS.toLowerCase()) return null;
  if (raw.toLowerCase() === getFundFactoryAddress().toLowerCase()) return null;
  return raw as `0x${string}`;
}
