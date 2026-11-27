// Total TVL (server only) — everything locked on Polypad, priced on-chain.
//
// Definition (matches the DeFiLlama adapter methodology, but counts staking
// as TVL where DeFiLlama does not):
//   1. Staking — the staked principal (`totalStaked`) in every pool created
//      by the two staking factories, enumerated on-chain.
//   2. Fund vaults — the ETH (+ POLYDASH) held by the live tokenized-fund
//      vaults (Polyfund and Polycat Growth Fund).
//
// POLYDASH is priced from the on-chain Uniswap V4 POLYDASH/WETH pool via
// StateView.getSlot0. NEVER CoinGecko simple-price for POLYDASH (it returns
// ~$0.00054, ~2,790x the true on-chain price).
//
// Resilience: 60s stale-while-revalidate cache with a last-good value. A
// failed refresh never returns a zero — getTotalTvl() returns null when the
// figure cannot be priced, and the client hook keeps the last good figure
// on screen with a retry control instead of flashing $0.
import { createPublicClient, formatUnits, getAddress, http, parseAbi, type Address, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getEthUsd } from '@/lib/eth-price';
import { STAKING_FACTORIES } from '@/lib/staking/factories';
import { POLYDASH_TOKEN } from '@/lib/staking/shared';

const TTL = 60_000;
const FIRST_LOAD_WAIT_MS = 8_000;
const client = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 10_000 }) }) as PublicClient;

const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as Address;
// Uniswap V4 POLYDASH/WETH pool (1% fee, no hook). PoolManager.getSlot0
// reverts on this chain, so the price is read from StateView.
const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b' as Address;
const POLYDASH_WETH_POOL_ID = '0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5' as `0x${string}`;

// Live tokenized-fund vaults.
const FUND_VAULTS = [
  '0xbcC982b6A5ABbBb5d94cCE7e772E923F88d29dD9', // Polyfund (PDGFUND)
  '0x7d8d3308f54777f5b56fc3efb2afeffe925dfdd2', // Polycat Growth Fund (PCATFUND)
] as Address[];

const factoryAbi = parseAbi([
  'function poolsLength() view returns (uint256)',
  'function getPoolAddresses(uint256 offset, uint256 limit) view returns (address[])',
]);
const poolAbi = parseAbi([
  'function stakeToken() view returns (address)',
  'function totalStaked() view returns (uint256)',
]);
const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
]);
const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

export interface TotalTvl {
  totalUsd: number;
  stakingUsd: number;
  vaultsUsd: number;
  polydashPriceUsd: number;
  ethUsd: number;
  stakingPolydash: number;
  vaultEth: number;
  vaultPolydash: number;
  /** Non-POLYDASH stake with a nonzero balance that we could not price (USD 0, shown for honesty). */
  unpriced: { symbol: string; amount: number }[];
  poolCount: number;
  updatedAt: number;
}

const lastGoodList = new Map<string, Address[]>();
async function factoryPools(factory: Address): Promise<Address[]> {
  try {
    const n = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'poolsLength' });
    const list = n > BigInt(0)
      ? await client.readContract({ address: factory, abi: factoryAbi, functionName: 'getPoolAddresses', args: [BigInt(0), n] })
      : [];
    const out = list.map((a) => getAddress(a));
    lastGoodList.set(factory.toLowerCase(), out);
    return out;
  } catch (e) {
    const prev = lastGoodList.get(factory.toLowerCase());
    if (prev) return prev;
    console.error(`total-tvl: pool enumeration failed on ${factory}`, e);
    return [];
  }
}

const lastGoodPool = new Map<string, { stakeToken: Address; totalStaked: bigint }>();
async function readPools(addrs: Address[]): Promise<{ stakeToken: Address; totalStaked: bigint }[]> {
  if (!addrs.length) return [];
  const res = await client.multicall({
    contracts: addrs.flatMap((address) => [
      { address, abi: poolAbi, functionName: 'stakeToken' as const },
      { address, abi: poolAbi, functionName: 'totalStaked' as const },
    ]),
    allowFailure: true,
  });
  return addrs.map((address, i) => {
    const stakeToken = res[i * 2]?.status === 'success' ? (res[i * 2].result as Address) : null;
    const totalStaked = res[i * 2 + 1]?.status === 'success' ? (res[i * 2 + 1].result as bigint) : null;
    const key = address.toLowerCase();
    if (stakeToken && totalStaked != null) {
      const out = { stakeToken, totalStaked };
      lastGoodPool.set(key, out);
      return out;
    }
    return lastGoodPool.get(key) ?? null;
  }).filter((p): p is { stakeToken: Address; totalStaked: bigint } => p !== null);
}

async function compute(): Promise<TotalTvl | null> {
  const [poolAddrs, ethUsd] = await Promise.all([
    Promise.all(STAKING_FACTORIES.map((f) => factoryPools(f.address))).then((lists) => {
      const set = new Map<string, Address>();
      lists.flat().forEach((a) => set.set(a.toLowerCase(), a));
      return Array.from(set.values());
    }),
    getEthUsd(),
  ]);
  if (ethUsd <= 0) {
    console.error('total-tvl: no ETH price available, cannot price TVL');
    return null;
  }
  const pools = await readPools(poolAddrs);
  if (!pools.length && !lastGoodPool.size) {
    console.error('total-tvl: no staking pools could be read');
    return null;
  }

  // POLYDASH price from the on-chain V4 pool: WETH per POLYDASH =
  // (2^96 / sqrtPriceX96)^2, so wethWei = polydashWei * 2^192 / sqrtPriceX96^2.
  let sqrtPriceX96: bigint;
  try {
    const slot0 = await client.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: 'getSlot0', args: [POLYDASH_WETH_POOL_ID] });
    sqrtPriceX96 = (slot0 as unknown as { sqrtPriceX96: bigint }).sqrtPriceX96 ?? (slot0 as unknown as bigint[])[0];
  } catch (e) {
    console.error('total-tvl: StateView getSlot0 failed', e);
    return null;
  }
  if (!sqrtPriceX96 || sqrtPriceX96 === BigInt(0)) return null;
  const Q192 = 2n ** 192n;
  const polydashToWeth = (wei: bigint) => (wei * Q192) / (sqrtPriceX96 * sqrtPriceX96);
  // Price of 1 POLYDASH in USD (via WETH -> ETH/USD).
  const onePolydashWeth = Number(formatUnits(polydashToWeth(10n ** 18n), 18));
  const polydashPriceUsd = onePolydashWeth * ethUsd;

  let stakingPolydashWei = BigInt(0);
  const otherStaked = new Map<string, bigint>();
  for (const p of pools) {
    if (p.stakeToken.toLowerCase() === POLYDASH_TOKEN.toLowerCase()) stakingPolydashWei += p.totalStaked;
    else if (p.totalStaked > BigInt(0)) {
      const k = p.stakeToken.toLowerCase();
      otherStaked.set(k, (otherStaked.get(k) ?? BigInt(0)) + p.totalStaked);
    }
  }
  const stakingPolydash = Number(formatUnits(stakingPolydashWei, 18));
  const stakingWeth = Number(formatUnits(polydashToWeth(stakingPolydashWei), 18));
  const stakingUsd = stakingWeth * ethUsd;

  // Fund vaults: native ETH plus any POLYDASH they hold (0 today).
  const [ethBalances, polydashBalances] = await Promise.all([
    Promise.all(FUND_VAULTS.map((v) => client.getBalance({ address: v }).catch(() => BigInt(0)))),
    client.multicall({
      contracts: FUND_VAULTS.map((vault) => ({ address: POLYDASH_TOKEN as Address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [vault] as const })),
      allowFailure: true,
    }),
  ]);
  const vaultEthWei = ethBalances.reduce((s, b) => s + b, BigInt(0));
  const vaultPolydashWei = polydashBalances.reduce((s, r) => s + (r?.status === 'success' ? (r.result as bigint) : BigInt(0)), BigInt(0));
  const vaultEth = Number(formatUnits(vaultEthWei, 18));
  const vaultPolydash = Number(formatUnits(vaultPolydashWei, 18));
  const vaultsUsd = vaultEth * ethUsd + Number(formatUnits(polydashToWeth(vaultPolydashWei), 18)) * ethUsd;

  // Symbol/decimals only for nonzero unpriced stake (none today — SWARM pool is empty).
  const unpriced: { symbol: string; amount: number }[] = [];
  for (const [token, amount] of otherStaked) {
    try {
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address: token as Address, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address: token as Address, abi: erc20Abi, functionName: 'decimals' }),
      ]);
      unpriced.push({ symbol, amount: Number(formatUnits(amount, decimals)) });
    } catch {
      unpriced.push({ symbol: token.slice(0, 10), amount: Number(formatUnits(amount, 18)) });
    }
  }

  return {
    totalUsd: stakingUsd + vaultsUsd,
    stakingUsd,
    vaultsUsd,
    polydashPriceUsd,
    ethUsd,
    stakingPolydash,
    vaultEth,
    vaultPolydash,
    unpriced,
    poolCount: pools.length,
    updatedAt: Date.now(),
  };
}

// ---------- tiny stale-while-revalidate cache (same shape as lib/staking/server.ts) ----------
type Entry = { value?: TotalTvl; at: number; inflight?: Promise<TotalTvl | null> };
let entry: Entry = { at: 0 };
export async function getTotalTvl(): Promise<TotalTvl | null> {
  const refresh = () => {
    if (entry.inflight) return entry.inflight;
    entry.inflight = compute()
      .then((v) => {
        if (v) { entry.value = v; entry.at = Date.now(); }
        return v;
      })
      .catch((err) => { console.error('total-tvl refresh failed', err); return null; })
      .finally(() => { entry.inflight = undefined; });
    return entry.inflight;
  };
  if (entry.value && Date.now() - entry.at < TTL) return entry.value;
  if (entry.value) {
    refresh().catch(() => {});
    return entry.value;
  }
  const p = refresh();
  const raced = await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), FIRST_LOAD_WAIT_MS))]).catch(() => null);
  return raced ?? entry.value ?? null;
}
