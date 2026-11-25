// Staking status per token: does an active Polydash staking pool (V2 or V1 factory) stake or pay this token?
// Server-side. Pool list cached 5 min (multicall), per-token results cached 5 min.
import { createPublicClient, http, parseAbi, type Address, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getLaunchesSnapshot } from '@/lib/launches-server';
import { EXTERNAL_LISTED_TOKENS, getListedToken } from '@/lib/listed-tokens';
import { STAKING_FACTORY_NEW } from '@/lib/staking/factories';

export const STAKING_V2_FACTORY = '0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0' as Address;
export const STAKING_V1_FACTORY = '0x0aAEa47d2e7303EC5a809062eafa59e7F011D857' as Address;
const TTL = 5 * 60_000;
const MAX_POOLS = 500;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 10_000 }),
  batch: { multicall: false },
}) as PublicClient;

const factoryAbi = parseAbi([
  'function poolsLength() view returns (uint256)',
  'function allPools(uint256) view returns (address)',
]);
const v2InfoAbi = parseAbi([
  'struct PoolInfo { address pool; address creator; address stakeToken; address rewardToken; string name; string description; uint256 startTime; uint256 endTime; uint256 totalRewards; uint256 rewardRate; uint256 totalStaked; uint256 maxTotalStake; uint256 stakerCount; uint256 claimFeeBps; bool verified; }',
  'function getPoolInfo(address pool) view returns (PoolInfo)',
]);
const v1PoolAbi = parseAbi([
  'function stakeToken() view returns (address)',
  'function rewardToken() view returns (address)',
  'function creator() view returns (address)',
  'function endTime() view returns (uint256)',
]);

export type StakingState = 'committed' | 'ended' | 'none' | 'unknown';
export interface RawPool { pool: string; creator: string; stakeToken: string; rewardToken: string; endTime: number; version: 'v1' | 'v2' }
export interface StakingPoolMatch { pool: string; creator: string; byCreator: boolean; endTime: number; active: boolean }
export interface StakingStatus { state: StakingState; pools: StakingPoolMatch[] }

interface PoolList { pools: RawPool[]; complete: boolean; at: number }
let poolCache: { value?: PoolList; inflight?: Promise<PoolList> } = {};

async function readIndex(factory: Address): Promise<Address[]> {
  const n = Number(await client.readContract({ address: factory, abi: factoryAbi, functionName: 'poolsLength' }));
  const count = Math.min(n, MAX_POOLS);
  if (count === 0) return [];
  const res = await client.multicall({
    allowFailure: false,
    contracts: Array.from({ length: count }, (_, i) => ({ address: factory, abi: factoryAbi, functionName: 'allPools' as const, args: [BigInt(i)] as const })),
  });
  return res as Address[];
}

async function loadV2(): Promise<{ pools: RawPool[]; complete: boolean }> {
  const [oldPools, newPools] = await Promise.all([loadV2From(STAKING_V2_FACTORY), loadV2From(STAKING_FACTORY_NEW)]);
  return { pools: [...oldPools.pools, ...newPools.pools], complete: oldPools.complete && newPools.complete };
}

async function loadV2From(factory: Address): Promise<{ pools: RawPool[]; complete: boolean }> {
  const addrs = await readIndex(factory);
  if (!addrs.length) return { pools: [], complete: true };
  const res = await client.multicall({
    allowFailure: true,
    contracts: addrs.map((p) => ({ address: factory, abi: v2InfoAbi, functionName: 'getPoolInfo' as const, args: [p] as const })),
  });
  let complete = true;
  const pools: RawPool[] = [];
  res.forEach((r, i) => {
    if (r.status !== 'success') { complete = false; return; }
    const v = r.result as { creator: string; stakeToken: string; rewardToken: string; endTime: bigint };
    pools.push({ pool: addrs[i], creator: v.creator, stakeToken: v.stakeToken, rewardToken: v.rewardToken, endTime: Number(v.endTime), version: 'v2' });
  });
  return { pools, complete };
}

async function loadV1(): Promise<{ pools: RawPool[]; complete: boolean }> {
  const addrs = await readIndex(STAKING_V1_FACTORY);
  if (!addrs.length) return { pools: [], complete: true };
  const fns = ['stakeToken', 'rewardToken', 'creator', 'endTime'] as const;
  const res = await client.multicall({
    allowFailure: true,
    contracts: addrs.flatMap((p) => fns.map((fn) => ({ address: p, abi: v1PoolAbi, functionName: fn }))),
  });
  let complete = true;
  const pools: RawPool[] = [];
  addrs.forEach((p, i) => {
    const [s, r, c, e] = res.slice(i * 4, i * 4 + 4);
    if (s.status !== 'success' || r.status !== 'success' || e.status !== 'success') { complete = false; return; }
    pools.push({
      pool: p,
      creator: c.status === 'success' ? String(c.result) : '',
      stakeToken: String(s.result),
      rewardToken: String(r.result),
      endTime: Number(e.result as bigint),
      version: 'v1',
    });
  });
  return { pools, complete };
}

/** Every pool from both factories. Throws when a factory index cannot be read. */
export async function getAllPools(): Promise<PoolList> {
  const cur = poolCache.value;
  if (cur && Date.now() - cur.at < TTL) return cur;
  if (poolCache.inflight) return poolCache.inflight;
  const p = Promise.all([loadV2(), loadV1()])
    .then(([v2, v1]) => {
      const value = { pools: [...v2.pools, ...v1.pools], complete: v2.complete && v1.complete, at: Date.now() };
      poolCache = { value };
      return value;
    })
    .catch((err) => {
      poolCache = { value: poolCache.value };
      throw err;
    });
  poolCache.inflight = p;
  return p;
}

/** Pure: status for one token from a pool list. */
export function evaluateStakingStatus(token: string, pools: RawPool[], complete: boolean, launchCreator: string | null, nowSec: number): StakingStatus {
  const t = token.toLowerCase();
  const lc = (launchCreator ?? '').toLowerCase();
  const matches: StakingPoolMatch[] = pools
    .filter((p) => p.stakeToken.toLowerCase() === t || p.rewardToken.toLowerCase() === t)
    .map((p) => ({
      pool: p.pool,
      creator: p.creator,
      byCreator: !!lc && !!p.creator && p.creator.toLowerCase() === lc,
      endTime: p.endTime,
      active: nowSec < p.endTime,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.endTime - a.endTime);
  if (matches.some((m) => m.active)) return { state: 'committed', pools: matches };
  if (!complete) return { state: 'unknown', pools: matches };
  return { state: matches.length ? 'ended' : 'none', pools: matches };
}

const tokenCache = new Map<string, { at: number; value: StakingStatus }>();

/** Staking status for a token address (or a launch address, resolved to its token). Never throws. */
export async function getStakingStatus(address: string): Promise<StakingStatus> {
  const key = address.toLowerCase();
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  try {
    const [list, listed] = await Promise.all([getAllPools(), getListedToken(address)]);
    const token = listed?.tokenAddress ?? address;
    const value = evaluateStakingStatus(token, list.pools, list.complete, listed?.creator ?? null, Math.floor(Date.now() / 1000));
    tokenCache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.error('staking-status failed', (err as Error)?.message);
    return { state: 'unknown', pools: [] };
  }
}

export interface StakingStatusLite { state: StakingState; byCreator: boolean; activeByCreator: boolean }

/** Batch: token address (lowercase) -> lite status, for every launch plus listed tokens. null when the pool list can't be read. */
export async function getAllStakingStatuses(): Promise<Record<string, StakingStatusLite> | null> {
  try {
    const [list, launches] = await Promise.all([getAllPools(), getLaunchesSnapshot(6_000)]);
    const now = Math.floor(Date.now() / 1000);
    const tokens: { token: string; creator: string }[] = [
      ...(launches ?? []).map((l) => ({ token: l.tokenAddress, creator: l.creator })),
      ...EXTERNAL_LISTED_TOKENS.map((t) => ({ token: t.address, creator: t.creator })),
    ];
    const out: Record<string, StakingStatusLite> = {};
    for (const { token, creator } of tokens) {
      const s = evaluateStakingStatus(token, list.pools, list.complete, creator, now);
      out[token.toLowerCase()] = {
        state: s.state,
        byCreator: s.pools.some((p) => p.byCreator && (s.state !== 'committed' || p.active)),
        activeByCreator: s.pools.some((p) => p.active && p.byCreator),
      };
    }
    return out;
  } catch (err) {
    console.error('staking-status batch failed', (err as Error)?.message);
    return null;
  }
}
