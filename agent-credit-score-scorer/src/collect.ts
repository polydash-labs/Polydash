/**
 * On-chain data collection for the Agent Credit Score scorer.
 *
 * Reads Robinhood Chain (via viem) and returns the raw metrics each
 * component needs. No scoring math lives here — that is src/score.ts.
 * All log reads are bounded by LOOKBACK_BLOCKS (config) and filtered to the
 * 30-day window by block timestamp.
 *
 * Data sources (all verified on-chain):
 * - AgentRegistry: the registered agents (agentCount + agents(id)).
 * - FundFactory FundCreated: which funds an agent manages (manager indexed).
 * - FundVault NavTape: navPerNft over time (Performance).
 * - FundVault AssetProposed / AssetExecuted: wait compliance (Conduct).
 * - FundVault Trade: trades executed (Activity).
 * - FundVault Distributed: dividend rounds (Conduct, positive signal).
 * - FundNFT Transfer to address(0): exits / burns (Conduct, exits in wait).
 * - LaunchFactory LaunchCreated: token launches by the agent (Activity).
 * - StakingFactory getPools + pool balanceOf: POLYDASH the agent staked.
 */
import type { Address, PublicClient } from 'viem';
import { parseAbiItem, zeroAddress } from 'viem';
import {
  registryAbi,
  stakingFactoryAbi,
  stakingPoolAbi,
  vaultAbi,
} from './chain.js';

export type AgentInfo = {
  agentId: bigint;
  wallet: Address;
  agentAccount: Address;
  name: string;
  stake: bigint;
  registeredAt: bigint;
  active: boolean;
};

export type FundInfo = {
  fund: Address;
  vault: Address;
  templateId: bigint;
  blockNumber: bigint;
};

export type NavPoint = { timestamp: bigint; navPerNft: bigint; blockNumber: bigint };
export type ProposalInfo = {
  id: bigint;
  asset: Address;
  readyAt: bigint;
  proposedAt: bigint;
  executedAt: bigint | null;
};

const ZERO = 0n;
const DAY_SECONDS = 86_400n;

/** Parsed events (viem infers typed log args from these). */
const fundCreatedEvent = parseAbiItem(
  'event FundCreated(address indexed fund, address indexed vault, address indexed manager, uint256 templateId, uint256 maxSupply)',
);
const navTapeEvent = parseAbiItem(
  'event NavTape(uint64 indexed timestamp, uint256 nav, uint256 navPerNft, uint256 hwmPerNft, uint256 drawdownBps)',
);
const assetProposedEvent = parseAbiItem(
  'event AssetProposed(uint256 indexed id, address indexed asset, uint256 maxPositionBps, string reason, string thesisUri, uint64 readyAt)',
);
const assetExecutedEvent = parseAbiItem(
  'event AssetExecuted(uint256 indexed id, address indexed asset, uint256 maxPositionBps)',
);
const tradeEvent = parseAbiItem(
  'event Trade(address indexed asset, uint8 side, uint256 size, uint256 price, uint256 navAfter)',
);
const distributedEvent = parseAbiItem(
  'event Distributed(uint256 indexed roundId, uint256 pot, uint256 perUnit)',
);
const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
);
const launchCreatedEvent = parseAbiItem(
  'event LaunchCreated(address indexed launch, address indexed token, address indexed creator, string name, string symbol, string imageUri, uint256 creatorFeeBps, address creatorPayoutWallet)',
);

/** Cache block timestamps so a log's block is only fetched once. */
export class BlockTimeCache {
  private cache = new Map<bigint, bigint>();
  constructor(private client: PublicClient) {}
  async get(blockNumber: bigint): Promise<bigint> {
    const hit = this.cache.get(blockNumber);
    if (hit !== undefined) return hit;
    const block = await this.client.getBlock({ blockNumber });
    this.cache.set(blockNumber, block.timestamp);
    return block.timestamp;
  }
}

export async function getRegisteredAgents(
  client: PublicClient,
  registry: Address,
): Promise<AgentInfo[]> {
  const count = await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: 'agentCount',
  });
  const out: AgentInfo[] = [];
  for (let i = 1n; i <= count; i++) {
    const [wallet, agentAccount, name, stake, registeredAt, active] = await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: 'agents',
      args: [i],
    });
    if (active) out.push({ agentId: i, wallet, agentAccount, name, stake, registeredAt, active });
  }
  return out;
}

export async function getAgentFunds(
  client: PublicClient,
  factories: Address[],
  wallet: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<FundInfo[]> {
  const out: FundInfo[] = [];
  for (const factory of factories) {
    const logs = await client.getLogs({
      address: factory,
      event: fundCreatedEvent,
      args: { manager: wallet },
      fromBlock,
      toBlock,
    });
    for (const l of logs) {
      out.push({
        fund: l.args.fund!,
        vault: l.args.vault!,
        templateId: l.args.templateId!,
        blockNumber: l.blockNumber,
      });
    }
  }
  return out;
}

export async function getNavTape(
  client: PublicClient,
  vault: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<NavPoint[]> {
  const logs = await client.getLogs({
    address: vault,
    event: navTapeEvent,
    fromBlock,
    toBlock,
  });
  return logs.map((l) => ({
    timestamp: l.args.timestamp!,
    navPerNft: l.args.navPerNft!,
    blockNumber: l.blockNumber,
  }));
}

export async function getVaultNavTotal(client: PublicClient, vault: Address): Promise<bigint> {
  // nav() is on the vault (FundVaultPhase3). Minimal inline ABI.
  return client.readContract({
    address: vault,
    abi: [{ type: 'function', name: 'nav', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const,
    functionName: 'nav',
  });
}

/**
 * Proposals for one fund vault, with each proposal's proposed time, its
 * 2-day readyAt, and its execution time (null when never executed).
 * Execution time comes from the AssetExecuted log's block timestamp.
 */
export async function getProposals(
  client: PublicClient,
  vault: Address,
  fromBlock: bigint,
  toBlock: bigint,
  times: BlockTimeCache,
): Promise<ProposalInfo[]> {
  const proposed = await client.getLogs({
    address: vault,
    event: assetProposedEvent,
    fromBlock,
    toBlock,
  });
  const executed = await client.getLogs({
    address: vault,
    event: assetExecutedEvent,
    fromBlock,
    toBlock,
  });
  const executedAt = new Map<bigint, bigint>();
  for (const e of executed) {
    executedAt.set(e.args.id!, await times.get(e.blockNumber));
  }
  const out: ProposalInfo[] = [];
  for (const p of proposed) {
    out.push({
      id: p.args.id!,
      asset: p.args.asset!,
      readyAt: p.args.readyAt!,
      proposedAt: await times.get(p.blockNumber),
      executedAt: executedAt.get(p.args.id!) ?? null,
    });
  }
  return out;
}

export async function getTradeCount(
  client: PublicClient,
  vault: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<number> {
  const logs = await client.getLogs({
    address: vault,
    event: tradeEvent,
    fromBlock,
    toBlock,
  });
  return logs.length;
}

export async function getDistributionCount(
  client: PublicClient,
  vault: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<number> {
  const logs = await client.getLogs({
    address: vault,
    event: distributedEvent,
    fromBlock,
    toBlock,
  });
  return logs.length;
}

export async function getNftAddress(client: PublicClient, vault: Address): Promise<Address> {
  return client.readContract({ address: vault, abi: vaultAbi, functionName: 'nft' });
}

/**
 * Exits during a proposal's wait window: fund NFT burns (ERC721 Transfer
 * to address(0)) whose block timestamp falls inside [proposedAt, readyAt]
 * for any proposal. `windows` is the list of [proposedAt, readyAt] pairs.
 */
export async function getExitsDuringWait(
  client: PublicClient,
  nft: Address,
  windows: Array<[bigint, bigint]>,
  fromBlock: bigint,
  toBlock: bigint,
  times: BlockTimeCache,
): Promise<number> {
  if (windows.length === 0 || nft === zeroAddress) return 0;
  const logs = await client.getLogs({
    address: nft,
    event: transferEvent,
    args: { to: zeroAddress },
    fromBlock,
    toBlock,
  });
  let exits = 0;
  for (const l of logs) {
    const ts = await times.get(l.blockNumber);
    if (windows.some(([start, end]) => ts >= start && ts <= end)) exits++;
  }
  return exits;
}

export async function getLaunchCount(
  client: PublicClient,
  launchFactory: Address,
  creator: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<number> {
  const logs = await client.getLogs({
    address: launchFactory,
    event: launchCreatedEvent,
    args: { creator },
    fromBlock,
    toBlock,
  });
  return logs.length;
}

/**
 * POLYDASH the agent staked in the staking pools (its own stake only).
 * Sums balanceOf(wallet) across every pool on every staking factory whose
 * stake token is POLYDASH. Returns wei (18 decimals).
 */
export async function getStakedPolydash(
  client: PublicClient,
  stakingFactories: Address[],
  wallet: Address,
  polydash: Address,
): Promise<bigint> {
  let total = ZERO;
  for (const factory of stakingFactories) {
    const length = await client.readContract({
      address: factory,
      abi: stakingFactoryAbi,
      functionName: 'poolsLength',
    });
    if (length === ZERO) continue;
    const pools = await client.readContract({
      address: factory,
      abi: stakingFactoryAbi,
      functionName: 'getPools',
      args: [ZERO, length > 100n ? 100n : length],
    });
    for (const p of pools) {
      const poolAddress = p[0] as Address;
      const stakeToken = p[2] as Address;
      if (stakeToken.toLowerCase() !== polydash.toLowerCase()) continue;
      const bal = await client.readContract({
        address: poolAddress,
        abi: stakingPoolAbi,
        functionName: 'balanceOf',
        args: [wallet],
      });
      total += bal;
    }
  }
  return total;
}

/** Start of the 30-day window, in seconds since epoch. */
export function windowStartSeconds(nowSeconds: bigint): bigint {
  return nowSeconds - 30n * DAY_SECONDS;
}
