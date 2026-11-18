// Server-side POLYDASH buyback + Rewards Pool reads (public RPC, read-only, 60 s cache). No keys, no signing.
import { createPublicClient, erc20Abi, formatEther, http, parseEventLogs, type Abi, type Address, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { PolydashLaunchABI } from '@/lib/contracts/abis';
import { fetchLaunchAddresses } from '@/lib/launches-core';
import { BUYBACK_FACTORY_MIN_ABI, BUYBACK_LIMITS, BUYBACK_VAULT_ABI, REWARDS_POOL_ABI } from '@/lib/buybackArtifacts';
import {
  BUYBACK_VAULT_DEPLOY_BLOCK, LAUNCH_FACTORIES, POLYDASH, REWARDS_POOL_DEPLOY_BLOCK, SOURCE_LABELS, isZeroAddr, poolAddress, ptDate, sourceKey, vaultAddress,
} from '@/lib/buyback';

const client = createPublicClient({ chain: robinhoodChain, transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 15_000 }) }) as PublicClient;
const VAULT_ABI = BUYBACK_VAULT_ABI as unknown as Abi;
const POOL_ABI = REWARDS_POOL_ABI as unknown as Abi;
const FACTORY_ABI = BUYBACK_FACTORY_MIN_ABI as unknown as Abi;
const LOG_CHUNK = BigInt(9_900_000);
const CONFIG_START = BigInt(85_000_000);
const TTL = 60_000;
const DAY = 86_400;
const ok = <T,>(r: any): T | undefined => (r?.status === 'success' ? (r.result as T) : undefined);
const s = (v: any) => (typeof v === 'bigint' ? v.toString() : v == null ? '0' : String(v));
const factories = LAUNCH_FACTORIES as unknown as Address[];

const cache = new Map<string, { at: number; data: any }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function chunkedLogs(address: Address | Address[], from: bigint) {
  const latest = await client.getBlockNumber();
  const out: any[] = [];
  for (let a = from; a <= latest; a += LOG_CHUNK) {
    const b = a + LOG_CHUNK - BigInt(1) > latest ? latest : a + LOG_CHUNK - BigInt(1);
    out.push(...(await client.getLogs({ address, fromBlock: a, toBlock: b })));
  }
  return out;
}

const blockTimes = new Map<string, number>();
async function timesFor(blocks: bigint[]) {
  const todo = Array.from(new Set(blocks.map(String))).filter((b) => !blockTimes.has(b));
  for (let i = 0; i < todo.length; i += 10) {
    await Promise.all(todo.slice(i, i + 10).map(async (b) => {
      try {
        const blk = await client.getBlock({ blockNumber: BigInt(b) });
        blockTimes.set(b, Number(blk.timestamp));
      } catch (e) {
        console.error('block time lookup failed', b, e);
      }
    }));
  }
}

// ---------- factories ----------
export type FactoryState = { address: Address; owner: Address | null; enabled: boolean; bps: number; contract: Address | null };
export async function getFactories(): Promise<FactoryState[]> {
  return cached('factories', async () => {
    const names = ['owner', 'buybackEnabled', 'buybackBps', 'buybackContract'];
    const res = await client.multicall({ contracts: factories.flatMap((f) => names.map((functionName) => ({ address: f, abi: FACTORY_ABI, functionName }))) as any, allowFailure: true });
    return factories.map((address, i) => {
      const r = res.slice(i * 4, i * 4 + 4);
      return {
        address,
        owner: ok<Address>(r[0]) ?? null,
        enabled: ok<boolean>(r[1]) ?? false,
        bps: Number(ok<bigint>(r[2]) ?? BigInt(0)),
        contract: ok<Address>(r[3]) ?? null,
      };
    });
  });
}

// ---------- history ----------
export type HistoryItem = {
  type: string; txHash: string; blockNumber: string; logIndex: number; time: number | null;
  ethIn: string | null; polyBurned: string | null; polyToStakers: string | null;
  source: string | null; caller: string | null; target: string | null;
  factory?: string; launch?: string; toBuyback?: string; toWallet?: string; enabled?: boolean; bps?: number; executeAfter?: number; sqrtPriceX96?: string;
};

function toItem(l: any, extra: Partial<HistoryItem>): HistoryItem {
  return {
    type: l.eventName, txHash: l.transactionHash, blockNumber: s(l.blockNumber), logIndex: Number(l.logIndex ?? 0), time: null,
    ethIn: null, polyBurned: null, polyToStakers: null, source: null, caller: null, target: null, ...extra,
  };
}

export async function getHistory(): Promise<HistoryItem[]> {
  const vault = vaultAddress();
  if (!vault || BUYBACK_VAULT_DEPLOY_BLOCK == null) return [];
  return cached('history', async () => {
    const from = BUYBACK_VAULT_DEPLOY_BLOCK as bigint;
    const [vaultLogs, factLogs, cfgLogs] = await Promise.all([
      chunkedLogs(vault, from),
      chunkedLogs(factories, from),
      chunkedLogs(factories, CONFIG_START),
    ]);
    const items: HistoryItem[] = [];
    for (const l of parseEventLogs({ abi: VAULT_ABI, logs: vaultLogs, strict: false }) as any[]) {
      const a = l.args ?? {};
      switch (l.eventName) {
        case 'Received': { const k = sourceKey(Number(a.source)); items.push(toItem(l, { ethIn: s(a.amount), source: SOURCE_LABELS[k], caller: a.from })); break; }
        case 'PriceObserved': items.push(toItem(l, { caller: a.caller, sqrtPriceX96: s(a.sqrtPriceX96) })); break;
        case 'BoughtAndBurned': items.push(toItem(l, { ethIn: s(a.ethIn), polyBurned: s(a.polydashBurned), polyToStakers: s(a.polydashToStakers), caller: a.caller })); break;
        case 'RewardsReleased': items.push(toItem(l, { polyToStakers: s(a.amount), target: a.target })); break;
        case 'HeldStakingBurned': items.push(toItem(l, { polyBurned: s(a.amount), caller: a.caller })); break;
        case 'TargetProposed': items.push(toItem(l, { target: a.target, executeAfter: Number(a.executeAfter ?? 0) })); break;
        case 'TargetCancelled': items.push(toItem(l, { target: a.target })); break;
        case 'TargetChanged': items.push(toItem(l, { target: a.newTarget, caller: a.oldTarget })); break;
        default: break;
      }
    }
    for (const l of parseEventLogs({ abi: FACTORY_ABI, logs: factLogs, strict: false }) as any[]) {
      const a = l.args ?? {};
      if (l.eventName === 'PlatformFeesDistributed') items.push(toItem(l, { ethIn: s(a.total), factory: l.address, launch: a.launch, toBuyback: s(a.toBuyback), toWallet: s(a.toWallet) }));
      if (l.eventName === 'BuybackFailed') items.push(toItem(l, { ethIn: s(a.amount), factory: l.address }));
    }
    for (const l of parseEventLogs({ abi: FACTORY_ABI, logs: cfgLogs, strict: false }) as any[]) {
      const a = l.args ?? {};
      if (l.eventName === 'BuybackConfigSet') items.push(toItem(l, { factory: l.address, enabled: !!a.enabled, bps: Number(a.bps ?? 0), target: a.buybackContract }));
    }
    await timesFor(items.map((i) => BigInt(i.blockNumber)));
    for (const i of items) i.time = blockTimes.get(i.blockNumber) ?? null;
    items.sort((x, y) => (BigInt(y.blockNumber) === BigInt(x.blockNumber) ? y.logIndex - x.logIndex : BigInt(y.blockNumber) > BigInt(x.blockNumber) ? 1 : -1));
    return items;
  });
}

// ---------- summary ----------
const VAULT_VIEWS = [
  'pendingEth', 'heldForStakers', 'rewardsTarget', 'targetEndTime', 'targetActive', 'inactiveSince', 'pendingTarget', 'pendingTargetAt',
  'totalBurned', 'totalStakingBurned', 'totalEthSpent', 'totalToStakers', 'totalReleased', 'totalFromFactories', 'totalManual', 'totalDirect', 'nextStep', 'obsTime', 'lastBuyTime',
] as const;

export async function getSummary() {
  const vault = vaultAddress();
  const facts = await getFactories();
  if (!vault) return { live: false as const, factories: facts, limits: BUYBACK_LIMITS, updatedAt: new Date().toISOString() };
  return cached('summary', async () => {
    const res = await client.multicall({ contracts: VAULT_VIEWS.map((functionName) => ({ address: vault, abi: VAULT_ABI, functionName })) as any, allowFailure: true });
    const v: Record<string, any> = {};
    VAULT_VIEWS.forEach((n, i) => { v[n] = ok(res[i]); });
    const history = await getHistory();
    const fees = history.filter((h) => h.type === 'PlatformFeesDistributed').reduce((t, h) => t + BigInt(h.ethIn ?? '0'), BigInt(0));
    const firstManual = [...history].reverse().find((h) => h.type === 'Received' && h.source === SOURCE_LABELS.manual) ?? null;
    const active = !!v.targetActive;
    const inactiveSince = Number(v.inactiveSince ?? 0);
    const step = Array.isArray(v.nextStep) ? v.nextStep : [0, BigInt(0)];
    let createdAt: number | null = null;
    try {
      await timesFor([BUYBACK_VAULT_DEPLOY_BLOCK as bigint]);
      createdAt = blockTimes.get(String(BUYBACK_VAULT_DEPLOY_BLOCK)) ?? null;
    } catch { /* optional */ }
    return {
      live: true as const,
      vault,
      feesCollectedEth: formatEther(fees),
      received: { factory: s(v.totalFromFactories), manual: s(v.totalManual), direct: s(v.totalDirect) },
      ethSpent: s(v.totalEthSpent),
      polyBurned: s(v.totalBurned),
      polyBurnedHeld: s(v.totalStakingBurned),
      polyToStakers: s(v.totalToStakers),
      polyReleased: s(v.totalReleased),
      polyHeld: s(v.heldForStakers),
      pendingEth: s(v.pendingEth),
      nextStep: Number(step[0] ?? 0),
      nextStepAt: Number(step[1] ?? 0),
      obsTime: Number(v.obsTime ?? 0),
      lastBuyTime: Number(v.lastBuyTime ?? 0),
      target: {
        address: isZeroAddr(v.rewardsTarget) ? null : (v.rewardsTarget as Address),
        endTime: Number(v.targetEndTime ?? 0),
        active,
        inactiveSince,
        burnableAt: !active && inactiveSince > 0 ? inactiveSince + BUYBACK_LIMITS.noTargetBurnDays * DAY : null,
      },
      pending: { target: isZeroAddr(v.pendingTarget) ? null : (v.pendingTarget as Address), executeAfter: Number(v.pendingTargetAt ?? 0) },
      preHistory: firstManual ? { goLiveAt: createdAt, backfillEth: formatEther(BigInt(firstManual.ethIn ?? '0')), txHash: firstManual.txHash } : null,
      factories: facts,
      limits: BUYBACK_LIMITS,
      updatedAt: new Date().toISOString(),
    };
  });
}

// ---------- chart ----------
export async function getChart() {
  const items = [...(await getHistory())].reverse();
  const days = new Map<string, { ethIn: bigint; ethSpent: bigint; polyBurned: bigint; polyToStakers: bigint }>();
  for (const i of items) {
    if (!i.time) continue;
    const d = ptDate(i.time);
    const row = days.get(d) ?? { ethIn: BigInt(0), ethSpent: BigInt(0), polyBurned: BigInt(0), polyToStakers: BigInt(0) };
    if (i.type === 'Received') row.ethIn += BigInt(i.ethIn ?? '0');
    if (i.type === 'BoughtAndBurned') {
      row.ethSpent += BigInt(i.ethIn ?? '0');
      row.polyBurned += BigInt(i.polyBurned ?? '0');
      row.polyToStakers += BigInt(i.polyToStakers ?? '0');
    }
    if (i.type === 'HeldStakingBurned') row.polyBurned += BigInt(i.polyBurned ?? '0');
    days.set(d, row);
  }
  const cum = { ethIn: BigInt(0), ethSpent: BigInt(0), polyBurned: BigInt(0), polyToStakers: BigInt(0) };
  return Array.from(days.entries()).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, r]) => {
    cum.ethIn += r.ethIn; cum.ethSpent += r.ethSpent; cum.polyBurned += r.polyBurned; cum.polyToStakers += r.polyToStakers;
    return { date, ethIn: Number(formatEther(cum.ethIn)), ethSpent: Number(formatEther(cum.ethSpent)), polyBurned: Number(formatEther(cum.polyBurned)), polyToStakers: Number(formatEther(cum.polyToStakers)) };
  });
}

// ---------- collectable fees + agent tasks ----------
export async function getCollectable() {
  return cached('collectable', async () => {
    const out: { factory: Address; launches: Address[]; totalWei: string }[] = [];
    for (const factory of factories) {
      const launches = await fetchLaunchAddresses(client, [factory]);
      const res = launches.length
        ? await client.multicall({ contracts: launches.map((address) => ({ address, abi: PolydashLaunchABI, functionName: 'platformFeesAccrued' })) as any, allowFailure: true })
        : [];
      let total = BigInt(0);
      const due: Address[] = [];
      res.forEach((r, i) => { const v = ok<bigint>(r) ?? BigInt(0); if (v > BigInt(0)) { due.push(launches[i]); total += v; } });
      out.push({ factory, launches: due, totalWei: total.toString() });
    }
    return out;
  });
}

export async function listBuybackTasks() {
  const sum = await getSummary();
  if (!sum.live) return { live: false as const, factories: sum.factories, tasks: [] };
  const now = Math.floor(Date.now() / 1000);
  const tasks: any[] = [];
  for (const c of await getCollectable()) {
    if (c.launches.length) tasks.push({ type: 'collect_platform_fees', contract: c.factory, function: 'collectPlatformFeesMany(address[])', args: [c.launches], accruedWei: c.totalWei });
  }
  if (BigInt(sum.pendingEth) >= BigInt('5000000000000000') && sum.nextStep !== 0) {
    const step = sum.nextStep === 1 ? 'record_price' : 'buy';
    tasks.push({ type: 'polydash_buyback', contract: sum.vault, step, function: step === 'record_price' ? 'observePrice()' : 'buy()', earliestTime: Math.max(sum.nextStepAt, now), pendingEthWei: sum.pendingEth });
  }
  if (sum.target.active && BigInt(sum.polyHeld) > BigInt(0)) tasks.push({ type: 'release_to_stakers', contract: sum.vault, function: 'releaseToTarget()', heldWei: sum.polyHeld, target: sum.target.address });
  if (!sum.target.active && BigInt(sum.polyHeld) > BigInt(0) && sum.target.burnableAt && now >= sum.target.burnableAt) {
    tasks.push({ type: 'burn_held_staking', contract: sum.vault, function: 'burnHeldStaking()', heldWei: sum.polyHeld });
  }
  return {
    live: true as const,
    chainId: robinhoodChain.id,
    note: 'Public tasks. Any wallet may send these transactions and pays its own gas. No keys, no custody, no server signing.',
    tasks,
    updatedAt: new Date().toISOString(),
  };
}

// ---------- Rewards Pool ----------
const POOL_VIEWS = ['totalStaked', 'rewardRate', 'periodFinish', 'totalNotified', 'totalClaimed', 'rewardReserve'] as const;
export async function getPoolSummary() {
  const pool = poolAddress();
  if (!pool) return { live: false as const, pool: null, updatedAt: new Date().toISOString() };
  return cached('pool', async () => {
    const res = await client.multicall({
      contracts: [...POOL_VIEWS.map((functionName) => ({ address: pool, abi: POOL_ABI, functionName })), { address: POLYDASH as Address, abi: erc20Abi, functionName: 'balanceOf', args: [pool] }] as any,
      allowFailure: true,
    });
    const v: Record<string, bigint> = {};
    POOL_VIEWS.forEach((n, i) => { v[n] = ok<bigint>(res[i]) ?? BigInt(0); });
    const bal = ok<bigint>(res[POOL_VIEWS.length]) ?? BigInt(0);
    const now = Math.floor(Date.now() / 1000);
    const streaming = Number(v.periodFinish) > now;
    const apr = streaming && v.totalStaked > BigInt(0) ? Number((v.rewardRate * BigInt(365 * DAY) * BigInt(10_000)) / v.totalStaked) / 100 : null;
    const unaccounted = bal - v.totalStaked - v.rewardReserve;
    return {
      live: true as const,
      pool,
      totalStaked: s(v.totalStaked),
      rewardRate: s(v.rewardRate),
      periodFinish: Number(v.periodFinish),
      totalNotified: s(v.totalNotified),
      totalClaimed: s(v.totalClaimed),
      aprVariable: apr,
      unaccounted: s(unaccounted > BigInt(0) ? unaccounted : BigInt(0)),
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function getPoolHistory(): Promise<HistoryItem[]> {
  const pool = poolAddress();
  if (!pool) return [];
  return cached('poolHistory', async () => {
    const from = REWARDS_POOL_DEPLOY_BLOCK ?? BUYBACK_VAULT_DEPLOY_BLOCK ?? CONFIG_START;
    const logs = parseEventLogs({ abi: POOL_ABI, logs: await chunkedLogs(pool, from), strict: false }) as any[];
    const items = logs
      .filter((l) => ['Staked', 'Withdrawn', 'RewardPaid', 'RewardAdded', 'Restreamed'].includes(l.eventName))
      .map((l) => {
        const a = l.args ?? {};
        const amount = l.eventName === 'Restreamed' ? a.carried : a.amount;
        return toItem(l, { caller: a.user ?? a.from ?? null, polyToStakers: s(amount) });
      });
    await timesFor(items.map((i) => BigInt(i.blockNumber)));
    for (const i of items) i.time = blockTimes.get(i.blockNumber) ?? null;
    items.sort((x, y) => (BigInt(y.blockNumber) === BigInt(x.blockNumber) ? y.logIndex - x.logIndex : BigInt(y.blockNumber) > BigInt(x.blockNumber) ? 1 : -1));
    return items.slice(0, 200);
  });
}
