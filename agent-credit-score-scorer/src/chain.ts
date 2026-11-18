/**
 * Robinhood Chain (4663) definition and the minimal ABIs the scorer needs.
 * Only view functions, the events it reads, and the one keeper call
 * (AgentScore.updateScore) are included.
 *
 * All addresses below are verified in-repo (deployments/robinhood-chain.json,
 * the Phase 6 deploy scripts / broadcast, or the buyback-keeper's chain.ts).
 * The AgentRegistry / AgentScore addresses are NOT deployed yet — they come
 * from the environment (see config.ts). The Phase 2 fund factory is not in
 * the defaults; add it (and any future factory) via FUND_FACTORIES.
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

/** POLYDASH token (18 decimals). */
export const POLYDASH_ADDRESS = '0x319525528f42167eF7fC18b77b889958080568e4' as Address;

/** Staking factories (current + legacy). The scorer sums an agent's
 *  POLYDASH staked across every pool whose stake token is POLYDASH. */
export const STAKING_FACTORY_CURRENT = '0x4C87aff7009DE1c58E052FEe202349a10b28Be9c' as Address;
export const STAKING_FACTORY_LEGACY = '0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0' as Address;
export const STAKING_FACTORIES: Address[] = [STAKING_FACTORY_CURRENT, STAKING_FACTORY_LEGACY];

/** Launch factory (current). LaunchCreated events attribute launches to a creator. */
export const LAUNCH_FACTORY = '0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2' as Address;

/** Fund factories whose FundCreated events the scorer reads to find the
 *  funds an agent manages. Phase 3 (Polycat lives here), Phase 3 V2
 *  (Phase 6), and V3 (Strategy #6 LP-dividend). Add more via FUND_FACTORIES. */
export const FUND_FACTORY_PHASE3 = '0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B' as Address;
export const FUND_FACTORY_PHASE3_V2 = '0xe50Da719947E83f316977d9c425DF95672E7B27e' as Address;
export const FUND_FACTORY_V3 = '0xB5251BaC3CFE2A057B7703D4477Bf80f10B8154B' as Address;
export const FUND_FACTORIES: Address[] = [
  FUND_FACTORY_PHASE3,
  FUND_FACTORY_PHASE3_V2,
  FUND_FACTORY_V3,
];

/** AgentRegistry: agentCount, agents(id), isRegistered(id). */
export const registryAbi = [
  { type: 'function', name: 'agentCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'agents',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { type: 'address' },
      { type: 'address' },
      { type: 'string' },
      { type: 'uint256' },
      { type: 'uint64' },
      { type: 'bool' },
    ],
  },
  { type: 'function', name: 'isRegistered', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

/** AgentScore: the one keeper call. */
export const scoreAbi = [
  {
    type: 'function',
    name: 'updateScore',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'uint256' },
      { type: 'uint16' },
      { type: 'uint16[5]' },
      { type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

/** FundFactory: FundCreated(fund, vault, manager, templateId, maxSupply). */
export const factoryAbi = [
  {
    type: 'event',
    name: 'FundCreated',
    inputs: [
      { name: 'fund', type: 'address', indexed: true },
      { name: 'vault', type: 'address', indexed: true },
      { name: 'manager', type: 'address', indexed: true },
      { name: 'templateId', type: 'uint256', indexed: false },
      { name: 'maxSupply', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** Fund vault: NAV tape, proposals, trades, distributions, NFT binding.
 *  The vault inherits the proposal store, so AssetProposed / AssetExecuted
 *  are emitted from the vault address. The swap facet runs via delegatecall,
 *  so Trade is also emitted from the vault address. */
export const vaultAbi = [
  { type: 'function', name: 'navPerNft', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nft', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'event',
    name: 'NavTape',
    inputs: [
      { name: 'timestamp', type: 'uint64', indexed: true },
      { name: 'nav', type: 'uint256', indexed: false },
      { name: 'navPerNft', type: 'uint256', indexed: false },
      { name: 'hwmPerNft', type: 'uint256', indexed: false },
      { name: 'drawdownBps', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AssetProposed',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'asset', type: 'address', indexed: true },
      { name: 'maxPositionBps', type: 'uint256', indexed: false },
      { name: 'reason', type: 'string', indexed: false },
      { name: 'thesisUri', type: 'string', indexed: false },
      { name: 'readyAt', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AssetExecuted',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'asset', type: 'address', indexed: true },
      { name: 'maxPositionBps', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Trade',
    inputs: [
      { name: 'asset', type: 'address', indexed: true },
      { name: 'side', type: 'uint8', indexed: false },
      { name: 'size', type: 'uint256', indexed: false },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'navAfter', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Distributed',
    inputs: [
      { name: 'roundId', type: 'uint256', indexed: true },
      { name: 'pot', type: 'uint256', indexed: false },
      { name: 'perUnit', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** Staking factory: enumerate pools. PoolInfo is (pool, creator,
 *  stakeToken, rewardToken, stakeSymbol, rewardSymbol, stakeDecimals,
 *  rewardDecimals, name, description, startTime, endTime, totalRewards,
 *  rewardRate, totalStaked). */
export const stakingFactoryAbi = [
  { type: 'function', name: 'poolsLength', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'getPools',
    stateMutability: 'view',
    inputs: [
      { type: 'uint256' },
      { type: 'uint256' },
    ],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { type: 'address' },
          { type: 'address' },
          { type: 'address' },
          { type: 'address' },
          { type: 'string' },
          { type: 'string' },
          { type: 'uint8' },
          { type: 'uint8' },
          { type: 'string' },
          { type: 'string' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
        ],
      },
    ],
  },
] as const;

/** Staking pool: an agent's staked balance. */
export const stakingPoolAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

/** Launch factory: LaunchCreated(launch, token, creator, ...). */
export const launchFactoryAbi = [
  {
    type: 'event',
    name: 'LaunchCreated',
    inputs: [
      { name: 'launch', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'imageUri', type: 'string', indexed: false },
      { name: 'creatorFeeBps', type: 'uint256', indexed: false },
      { name: 'creatorPayoutWallet', type: 'address', indexed: false },
    ],
  },
] as const;

/** ERC721 Transfer: fund exits are NFT burns (Transfer to address(0)). */
export const erc721Abi = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const;
