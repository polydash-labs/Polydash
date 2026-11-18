// Token staking factories (isomorphic). Pools from BOTH factories are listed together on /stake.
// New pools are created only through STAKING_FACTORY_NEW (fee-on-transfer reward token fix).
import type { Address } from 'viem';

/** Original V2 factory. Its existing pools stay live (stake, claim, exit). Not used for new pools. */
export const STAKING_FACTORY_OLD = '0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0' as Address;
export const STAKING_FACTORY_OLD_FROM_BLOCK = 83_000_000;
/** Upgraded factory (Sourcify exact match, deployed at block 112291143). All new pools go here. */
export const STAKING_FACTORY_NEW = '0x4C87aff7009DE1c58E052FEe202349a10b28Be9c' as Address;
export const STAKING_FACTORY_NEW_FROM_BLOCK = 112_291_143;

export const STAKING_FACTORIES: { address: Address; fromBlock: number }[] = [
  { address: STAKING_FACTORY_OLD, fromBlock: STAKING_FACTORY_OLD_FROM_BLOCK },
  { address: STAKING_FACTORY_NEW, fromBlock: STAKING_FACTORY_NEW_FROM_BLOCK },
];
