// Destinations treated as a sale for the "No selling" promise (lowercase).
// Post-graduation trades settle through the Uniswap V4 PoolManager; the launch contract itself is the
// bonding-curve market (curve sells also emit Sold). Add verified router addresses here as they are confirmed.
export const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
export const POLYPAD_HOOKS = ['0x4d3066bbff889023def912d2fde36c44357fa0cc', '0x04990e6671c98e1b43034e52366af11396d960cc'];
export const KNOWN_ROUTERS: string[] = [POOL_MANAGER, ...POLYPAD_HOOKS];

/** Polypad CommitVaults (current and legacy): deposits there are not sales. */
export const COMMIT_VAULTS = ['0xf013bf17d511e2f65d0da4bd320948646f567ae4', '0x8f125c9ec7acd52b9cd39f2a7441085559d84104'];

export const STAKING_V2_FACTORY = '0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0';
