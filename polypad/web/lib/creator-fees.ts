// Creator fee totals for a Polydash launch: claimable (launch + graduated hook pool) + claimed (CreatorFeesClaimed logs).
// Latest-state reads only (historical state is pruned). 5-minute in-memory cache per token.
import { createPublicClient, getAddress, http, parseAbi, parseAbiItem, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getEthUsd } from '@/lib/eth-price';

const client = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 10_000 }) }) as PublicClient;

// Lowercase: the mixed-case forms in the spec are not valid EIP-55 checksums.
const FACTORIES: Address[] = ['0xfdfd0a095966c8b56639f7eaa13f4b0188fc08c2', '0x2c84cfcd8d283ef750e09fbed735d67f67845db2'];
const START_BLOCK = BigInt(85_000_000);
const LOG_CHUNK = BigInt(9_000_000);
const TTL = 5 * 60_000;
const ZERO_ID = `0x${'0'.repeat(64)}` as Hex;

const FACTORY_ABI = parseAbi(['function launchOfToken(address token) view returns (address)']);
const LAUNCH_ABI = parseAbi([
  'function creator() view returns (address)',
  'function creatorPayoutWallet() view returns (address)',
  'function creatorFeeBps() view returns (uint256)',
  'function creatorFeesAccrued() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function hook() view returns (address)',
  'function poolId() view returns (bytes32)',
]);
// Same signature as PolydashHook.pools in the contracts repo ABI.
const HOOK_ABI = parseAbi([
  'function pools(bytes32) view returns (address launchAddress, address token, uint24 platformFeeBps, uint24 creatorFeeBps, uint24 sellSpikeBps, uint64 sellSpikeEnd, uint128 liquidity, uint256 platformFeesAccrued, uint256 creatorFeesAccrued, bool active)',
]);
const LAUNCH_CLAIMED = parseAbiItem('event CreatorFeesClaimed(address indexed payoutWallet, uint256 amount)');
const HOOK_CLAIMED = parseAbiItem('event CreatorFeesClaimed(bytes32 indexed id, address indexed payoutWallet, uint256 amount)');

export type CreatorFees = {
  token: Address;
  launch: Address;
  creator: Address;
  payoutWallet: Address;
  feeBps: number;
  graduated: boolean;
  earnedWei: string;
  claimedWei: string;
  claimableWei: string;
  ethUsd: number | null;
  updatedAt: string;
};

const cache = new Map<string, { value: CreatorFees | null; at: number }>();

async function chunkedLogs<T>(query: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>): Promise<T[]> {
  const latest = await client.getBlockNumber();
  const ranges: [bigint, bigint][] = [];
  for (let s = START_BLOCK; s <= latest; s += LOG_CHUNK) {
    const e = s + LOG_CHUNK - BigInt(1);
    ranges.push([s, e > latest ? latest : e]);
  }
  const parts = await Promise.all(ranges.map(([f, t]) => query(f, t)));
  return parts.flat();
}

async function findLaunch(token: Address): Promise<Address | null> {
  const res = await client.multicall({
    contracts: FACTORIES.map((address) => ({ address, abi: FACTORY_ABI, functionName: 'launchOfToken' as const, args: [token] as const })),
    allowFailure: true,
  });
  for (const r of res) {
    if (r.status === 'success' && r.result && r.result !== zeroAddress) return getAddress(r.result as Address);
  }
  if (res.every((r) => r.status === 'failure')) throw new Error(`launchOfToken failed on both factories: ${String(res[0].error)}`);
  return null;
}

async function load(token: Address): Promise<CreatorFees | null> {
  const launch = await findLaunch(token);
  if (!launch) return null;

  const fn = ['creator', 'creatorPayoutWallet', 'creatorFeeBps', 'creatorFeesAccrued', 'graduated', 'hook', 'poolId'] as const;
  const views = await client.multicall({
    contracts: fn.map((functionName) => ({ address: launch, abi: LAUNCH_ABI, functionName })),
    allowFailure: true,
  });
  const get = <T>(i: number, fallback: T): T => (views[i].status === 'success' ? (views[i].result as T) : fallback);
  for (const i of [0, 3, 4]) if (views[i].status !== 'success') throw new Error(`launch view ${fn[i]} failed`);
  const creator = getAddress(get<Address>(0, zeroAddress));
  const payoutRaw = get<Address>(1, zeroAddress);
  const payoutWallet = payoutRaw && payoutRaw !== zeroAddress ? getAddress(payoutRaw) : creator;
  const feeBps = Number(get<bigint>(2, BigInt(0)));
  const launchAccrued = get<bigint>(3, BigInt(0));
  const graduated = get<boolean>(4, false);
  const hook = get<Address>(5, zeroAddress);
  const poolId = get<Hex>(6, ZERO_ID);
  const hasHook = hook !== zeroAddress && poolId !== ZERO_ID;

  let hookAccrued = BigInt(0);
  if (graduated && hasHook) {
    const pool = await client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'pools', args: [poolId] });
    hookAccrued = pool[8];
  }

  const [launchLogs, hookLogs] = await Promise.all([
    chunkedLogs((fromBlock, toBlock) => client.getLogs({ address: launch, event: LAUNCH_CLAIMED, fromBlock, toBlock })),
    hasHook
      ? chunkedLogs((fromBlock, toBlock) => client.getLogs({ address: hook, event: HOOK_CLAIMED, args: { id: poolId }, fromBlock, toBlock }))
      : Promise.resolve([]),
  ]);
  const claimed = [...launchLogs, ...hookLogs].reduce((sum, l) => sum + ((l.args as { amount?: bigint }).amount ?? BigInt(0)), BigInt(0));
  const claimable = launchAccrued + (graduated ? hookAccrued : BigInt(0));

  const usd = await getEthUsd();
  return {
    token,
    launch,
    creator,
    payoutWallet,
    feeBps,
    graduated,
    earnedWei: (claimed + claimable).toString(),
    claimedWei: claimed.toString(),
    claimableWei: claimable.toString(),
    ethUsd: usd > 0 ? usd : null,
    updatedAt: new Date().toISOString(),
  };
}

/** null = not a Polydash launch. Throws on RPC failure. */
export async function getCreatorFees(tokenIn: string): Promise<CreatorFees | null> {
  const token = getAddress(tokenIn);
  const key = token.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load(token);
  cache.set(key, { value, at: Date.now() });
  return value;
}
