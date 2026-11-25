/**
 * Robinhood Chain (4663) definition and the minimal ABIs the keeper needs.
 * Only view functions and the three keeper calls are included.
 */
import { defineChain, type Chain } from 'viem';
import type { Address } from 'viem';

export const ROBINHOOD_CHAIN: Chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
});

/** Deployed contracts (Robinhood Chain mainnet). Public addresses, not secrets. */
export const VAULT_ADDRESS = '0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193' as Address;
export const REWARDS_POOL_ADDRESS = '0x608d106Bb58A804fcd45823e0C6087801dee2aCa' as Address;
export const POLYDASH_ADDRESS = '0x319525528f42167eF7fC18b77b889958080568e4' as Address;

/** Phase 6 PolydashTwapFeed: self-observing TWAP feed for the POLYDASH/WETH
 *  Uniswap V4 pool. The keeper pokes it once per cycle so the fund contracts
 *  always have a fresh price (see keeper.ts). */
export const TWAP_FEED_ADDRESS = '0x5FDE0DB5AAFa8E20E76ca0D763C2c3eD49Af84fC' as Address;

/** Generic V4 TWAP feeds (deployed 2026-11-12 via script/DeployGenericV4.s.sol).
 *  The keeper pokes each once per cycle so each feed has a full 30-min TWAP
 *  window by the time its allowlist proposal executes (Sat Nov 14 14:35 PST).
 *  The USDG/WETH V3 reference feed is NOT poked: it reads the V3 pool's own
 *  observations. */
export const TIBBIR_TWAP_FEED_ADDRESS = '0x02a860B295c0266b735AcF566A522AE8929002e0' as Address;
export const TORCH_TWAP_FEED_ADDRESS = '0xc1d960dE6697D318fcDa85dEc0A4D35914fdD3f0' as Address;
export const FOBO_TWAP_FEED_ADDRESS = '0x0314809D9e6D73Dc13512E91391dadE06D4e8e2d' as Address;
export const ORBIO_TWAP_FEED_ADDRESS = '0x463A5d50AAf56dB5FF87361c5bC0D1edfe96a285' as Address;

/** HOOKR V4 TWAP feed (deployed 2026-11-17 as part of the HOOKR/HMM/DELTA/BOW
 *  allowlist batch, proposal #16). V4 feeds need poking, unlike the V3 feeds
 *  (HMM/DELTA/BOW), which read the V3 pool's own observations. */
export const HOOKR_TWAP_FEED_ADDRESS = '0x0D502c9D4a097Bcb3A43bBB12617F1948933a7bF' as Address;

/** FRONG V4 TWAP feed (deployed 2026-11-19, proposal #17). V4 feeds need
 *  poking, unlike the V3 feeds, which read the V3 pool's own observations. */
export const FRONG_TWAP_FEED_ADDRESS = '0xd05D70CDabf720127CC292Bf8dD234FBC9264750' as Address;

/** OAK + HEY V4 TWAP feeds (deployed 2026-11-19 as part of the
 *  AI/INDEX/ROBINCAT/UP/OAK/HEY allowlist batch, proposals #22/#23). V4 feeds
 *  need poking, unlike the V3 feeds, which read the V3 pool's own observations. */
export const OAK_TWAP_FEED_ADDRESS = '0xA7ca134be22091d2d26a04D78CE6075Bb00Dac0A' as Address;
export const HEY_TWAP_FEED_ADDRESS = '0xAC226fAb95e21e048a947B27b3d26c843C27Ec71' as Address;

/** GIGATENEV V4 TWAP feed (deployed 2026-11-20 as part of the
 *  GIGATENEV allowlist batch, proposal #24). V4 feeds need poking,
 *  unlike the V3 feeds, which read the V3 pool's own observations. */
export const GIGA_TWAP_FEED_ADDRESS = '0xeF56C8702Da7eee05a93AE7dF4d0E0a65043Cf90' as Address;

/** Batch 5 V4 TWAP feeds (deployed 2026-11-21, proposals #25–42). V4 feeds
 *  need poking, unlike the V3 feeds, which read the V3 pool's own observations. */
export const MOW_TWAP_FEED_ADDRESS = '0x260d83427b142B5B4f62B4A981782e17ec1dE0ef' as Address;
export const STONKBROKER_TWAP_FEED_ADDRESS = '0x97a9d0d5cCd7615C958d7E45cb75775CB7A92b14' as Address;
export const BUN_TWAP_FEED_ADDRESS = '0xCC688999d19AaeC8C7c1FB297E29df98bb9B7Ff8' as Address;
export const WTH_TWAP_FEED_ADDRESS = '0xe3877eC52DEB1Cd79656370f7fE2794A352f26b9' as Address;
export const GAGE_TWAP_FEED_ADDRESS = '0xF78Bc5BcC48C4A41a34df1B3E47D4241e0191ae2' as Address;
export const FOREVER_TWAP_FEED_ADDRESS = '0xBE56118eC9E02Cc5A280d5DC08939bdaB229C6f1' as Address;
export const ZZZ_TWAP_FEED_ADDRESS = '0x8281429c37fDD15A7a8b45Da172D798c19545Ad3' as Address;
export const FABLES_TWAP_FEED_ADDRESS = '0x9189A4F52756A5dd1377022abd0508b272fAD3ed' as Address;
export const GLDSTN_TWAP_FEED_ADDRESS = '0x8cABfc7720dbc496ab2A6C255e793dFaF70A8f93' as Address;
export const VRAX_TWAP_FEED_ADDRESS = '0xb37052308E870B744557dccB2d52d70E656Ba851' as Address;
export const NET_TWAP_FEED_ADDRESS = '0x056d7BDF8F889d594c7622b483a0622F672b6021' as Address;
export const PRIORS_TWAP_FEED_ADDRESS = '0xF0e5E933a28d85DaC6FF17589535887C62C3A263' as Address;
export const PIZZA_TWAP_FEED_ADDRESS = '0x5741dfc02E12A80B8ce117ce3CbD5270b08ED73a' as Address;
export const SLOP_TWAP_FEED_ADDRESS = '0x1b826051d0c270C449ea4A033f7f11d693a14903' as Address;

/** Every TWAP feed the keeper pokes once per cycle (best-effort per feed). */
export const TWAP_FEED_ADDRESSES: Address[] = [
  TWAP_FEED_ADDRESS,
  TIBBIR_TWAP_FEED_ADDRESS,
  TORCH_TWAP_FEED_ADDRESS,
  FOBO_TWAP_FEED_ADDRESS,
  ORBIO_TWAP_FEED_ADDRESS,
  HOOKR_TWAP_FEED_ADDRESS,
  FRONG_TWAP_FEED_ADDRESS,
  OAK_TWAP_FEED_ADDRESS,
  HEY_TWAP_FEED_ADDRESS,
  GIGA_TWAP_FEED_ADDRESS,
  MOW_TWAP_FEED_ADDRESS,
  STONKBROKER_TWAP_FEED_ADDRESS,
  BUN_TWAP_FEED_ADDRESS,
  WTH_TWAP_FEED_ADDRESS,
  GAGE_TWAP_FEED_ADDRESS,
  FOREVER_TWAP_FEED_ADDRESS,
  ZZZ_TWAP_FEED_ADDRESS,
  FABLES_TWAP_FEED_ADDRESS,
  GLDSTN_TWAP_FEED_ADDRESS,
  VRAX_TWAP_FEED_ADDRESS,
  NET_TWAP_FEED_ADDRESS,
  PRIORS_TWAP_FEED_ADDRESS,
  PIZZA_TWAP_FEED_ADDRESS,
  SLOP_TWAP_FEED_ADDRESS,
];

/** Minimal TWAP feed ABI: the keeper call plus the views used for monitoring. */
export const twapFeedAbi = [
  { type: 'function', name: 'poke', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint64' }, { type: 'int256' }, { type: 'int24' }] },
  { type: 'function', name: 'observationCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'latestPrice',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }, { type: 'uint64' }],
  },
  {
    type: 'event',
    name: 'Poked',
    inputs: [
      { name: 'timestamp', type: 'uint64', indexed: true },
      { name: 'tickCumulative', type: 'int256', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
    ],
  },
] as const;

/** Launch factories whose buyback config must point at the vault (owner-only). */
export const FACTORY_A_ADDRESS = '0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2' as Address;
export const FACTORY_B_ADDRESS = '0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2' as Address;

export const buybackVaultAbi = [
  // views
  { type: 'function', name: 'pendingEth', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'heldForStakers', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'obsTime', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'lastBuyTime', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'targetActive', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'rewardsTarget', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'totalBurned', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalEthSpent', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalReleased', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'buyCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maxBuyEth', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'spotSqrtPriceX96', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160' }] },
  // keeper calls (anyone may call these)
  { type: 'function', name: 'observePrice', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [
      { name: 'ethIn', type: 'uint256' },
      { name: 'burned', type: 'uint256' },
      { name: 'toStakers', type: 'uint256' },
    ],
  },
  { type: 'function', name: 'releaseToTarget', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] },
  // events (for decoding receipts)
  {
    type: 'event',
    name: 'BoughtAndBurned',
    inputs: [
      { name: 'caller', type: 'address', indexed: true },
      { name: 'ethIn', type: 'uint256', indexed: false },
      { name: 'polydashBurned', type: 'uint256', indexed: false },
      { name: 'polydashToStakers', type: 'uint256', indexed: false },
      { name: 'sqrtPriceBefore', type: 'uint160', indexed: false },
      { name: 'sqrtPriceAfter', type: 'uint160', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RewardsReleased',
    inputs: [
      { name: 'target', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const rewardsPoolAbi = [
  { type: 'function', name: 'totalStaked', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'rewardRate', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'periodFinish', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalNotified', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;
