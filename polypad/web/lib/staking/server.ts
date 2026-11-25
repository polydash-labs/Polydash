// Staking page data (server only). Pool state via one multicall; analytics from pool events, indexed
// incrementally in memory (first scan per event signature, sequential, then only new blocks). ~60s cache.
import { createPublicClient, formatUnits, getAddress, http, parseAbi, toEventSelector, type Address, type Hex, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getLogsRange, blockTime } from '@/lib/cto/chain';
import { listPoolAddresses, tokenMeta } from '@/lib/agents/tools';
import { STAKING_FACTORIES } from './factories';
import { getEthUsd, getLaunchesSnapshot } from '@/lib/launches-server';
import {
  POLYDASH_LOGO, POLYDASH_TOKEN, poolStatus,
  type DayPoint, type FlowItem, type PoolDetailResponse, type PoolSummary, type PoolsResponse, type StakeTotals, type TokenInfo, type TokenTotal, type TopStaker,
} from './shared';

const TTL = 60_000;
const SCAN_FLOOR = 83_000_000; // before the first V2 pool
const client = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 10_000 }) }) as PublicClient;

const factoryAbi = parseAbi([
  'function poolsLength() view returns (uint256)',
  'function getPoolAddresses(uint256 offset, uint256 limit) view returns (address[])',
  'function verified(address) view returns (bool)',
]);
const readAbi = parseAbi([
  'function name() view returns (string)',
  'function description() view returns (string)',
  'function creator() view returns (address)',
  'function stakeToken() view returns (address)',
  'function rewardToken() view returns (address)',
  'function totalStaked() view returns (uint256)',
  'function rewardRate() view returns (uint256)',
  'function startTime() view returns (uint256)',
  'function endTime() view returns (uint256)',
  'function totalRewards() view returns (uint256)',
  'function totalRewardsPaid() view returns (uint256)',
  'function stakerCount() view returns (uint256)',
  'function maxTotalStake() view returns (uint256)',
  'function claimFeeBps() view returns (uint256)',
  'function funded() view returns (bool)',
  'function sameToken() view returns (bool)',
]);
const FIELDS = ['name', 'description', 'creator', 'stakeToken', 'rewardToken', 'totalStaked', 'rewardRate', 'startTime', 'endTime', 'totalRewards', 'totalRewardsPaid', 'stakerCount', 'maxTotalStake', 'claimFeeBps', 'funded', 'sameToken'] as const;

const SEL = {
  created: toEventSelector('PoolCreated(address,address,address,address,uint256,uint256,uint256,uint256)'),
  staked: toEventSelector('Staked(address,uint256,uint256)'),
  withdrawn: toEventSelector('Withdrawn(address,uint256,uint256)'),
  emergency: toEventSelector('EmergencyWithdrawn(address,uint256,uint256)'),
  reward: toEventSelector('RewardPaid(address,uint256,uint256,uint256,uint256)'),
};

// ---------- tiny stale-while-revalidate cache ----------
type Entry<T> = { value?: T; at: number; inflight?: Promise<T> };
const store = new Map<string, Entry<unknown>>();
async function swr<T>(key: string, load: () => Promise<T>, waitMs: number, ttl = TTL): Promise<T | null> {
  const e = (store.get(key) ?? { at: 0 }) as Entry<T>;
  const refresh = () => {
    if (e.inflight) return e.inflight;
    e.inflight = load()
      .then((v) => { e.value = v; e.at = Date.now(); return v; })
      .catch((err) => { console.error(`staking refresh failed (${key})`, err); throw err; })
      .finally(() => { e.inflight = undefined; });
    store.set(key, e);
    return e.inflight;
  };
  if (e.at > 0) {
    if (Date.now() - e.at > ttl) refresh().catch(() => {});
    return e.value as T;
  }
  const p = refresh();
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]).catch(() => null);
}

// ---------- pool state ----------
interface RawPool { address: Address; data: Record<string, any> }

// Pools from every staking factory (old + new), merged and deduped. Each pool remembers its factory,
// which is where its verified flag is read from.
const poolFactory = new Map<string, Address>();
const lastGoodList = new Map<string, Address[]>();
async function factoryPools(factory: Address): Promise<Address[]> {
  try {
    const n = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'poolsLength' });
    const list = n > BigInt(0) ? await client.readContract({ address: factory, abi: factoryAbi, functionName: 'getPoolAddresses', args: [BigInt(0), n] }) : [];
    const out = list.map((a) => getAddress(a));
    lastGoodList.set(factory.toLowerCase(), out);
    return out;
  } catch (e) {
    const prev = lastGoodList.get(factory.toLowerCase());
    if (prev) return prev;
    console.error(`staking: getPoolAddresses failed on ${factory}, using fallback list`, e);
    return (await listPoolAddresses()).filter((p) => p.factory.toLowerCase() === factory.toLowerCase()).map((p) => p.address);
  }
}

async function poolAddresses(): Promise<Address[]> {
  const lists = await Promise.all(STAKING_FACTORIES.map((f) => factoryPools(f.address)));
  const set = new Map<string, Address>();
  lists.forEach((list, i) => list.forEach((a) => {
    const k = a.toLowerCase();
    if (set.has(k)) return;
    set.set(k, a);
    poolFactory.set(k, STAKING_FACTORIES[i].address);
  }));
  return Array.from(set.values());
}

const lastVerified = new Map<string, boolean>();
async function readVerified(addrs: Address[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const withFactory = addrs.filter((a) => poolFactory.has(a.toLowerCase()));
  if (!withFactory.length) return out;
  try {
    const res = await client.multicall({
      contracts: withFactory.map((a) => ({ address: poolFactory.get(a.toLowerCase())!, abi: factoryAbi, functionName: 'verified' as const, args: [a] as const })),
      allowFailure: true,
    });
    withFactory.forEach((a, i) => {
      const k = a.toLowerCase();
      const r = res[i];
      if (r?.status === 'success') { out.set(k, !!r.result); lastVerified.set(k, !!r.result); }
      else if (lastVerified.has(k)) out.set(k, lastVerified.get(k)!);
    });
  } catch (e) {
    console.error('staking: verified read failed', e);
    withFactory.forEach((a) => { const k = a.toLowerCase(); if (lastVerified.has(k)) out.set(k, lastVerified.get(k)!); });
  }
  return out;
}

async function readPools(addrs: Address[]): Promise<RawPool[]> {
  if (!addrs.length) return [];
  const res = await client.multicall({
    contracts: addrs.flatMap((address) => FIELDS.map((functionName) => ({ address, abi: readAbi, functionName }))) as any,
    allowFailure: true,
  });
  // A failed read for one pool reuses its last good snapshot, so a flaky RPC call never drops a pool
  // (and its stake) from the list and the header totals for one refresh.
  return addrs.map((address, i) => {
    const data: Record<string, any> = {};
    FIELDS.forEach((f, j) => { const r = res[i * FIELDS.length + j]; data[f] = r?.status === 'success' ? r.result : null; });
    const key = address.toLowerCase();
    if (data.stakeToken && data.totalStaked != null) { lastGoodPool.set(key, data); return { address, data }; }
    const prev = lastGoodPool.get(key);
    return { address, data: prev ?? data };
  }).filter((p) => p.data.stakeToken && p.data.totalStaked != null);
}
const lastGoodPool = new Map<string, Record<string, any>>();

// Last good per-token USD price (10-minute expiry), so a flaky
// launches-snapshot refresh — a thin token's priceEth briefly reading 0 —
// never drops a pool card's dollar line mid-session. Same pattern as
// lastGoodPool below and getPolydashUsd's own fallback.
const lastGoodPrice = new Map<string, { price: number; at: number }>();
const LAST_GOOD_PRICE_MS = 10 * 60_000;
async function priceBook() {
  const [launches, ethUsd] = await Promise.all([getLaunchesSnapshot(2_500), getEthUsd()]);
  const m = new Map<string, { logo: string | null; priceUsd: number | null; name: string }>();
  for (const l of launches ?? []) {
    const key = l.tokenAddress.toLowerCase();
    const fresh = l.priceEth > 0 && ethUsd > 0 ? l.priceEth * ethUsd : null;
    const prev = lastGoodPrice.get(key);
    const price = fresh != null && fresh > 0 ? fresh : (prev && Date.now() - prev.at < LAST_GOOD_PRICE_MS ? prev.price : null);
    if (price != null && price > 0) lastGoodPrice.set(key, { price, at: Date.now() });
    m.set(key, { logo: l.imageUri || null, priceUsd: price, name: l.name });
  }
  // POLYDASH is the platform token, not a launch, so it is never in the
  // launches snapshot — without this every POLYDASH pool priced at null and
  // the /stake totals showed "N/A" (round 5).
  const polyUsd = await getPolydashUsd();
  if (polyUsd > 0) m.set(POLYDASH_TOKEN.toLowerCase(), { logo: POLYDASH_LOGO, priceUsd: polyUsd, name: 'Polydash' });
  return m;
}

// POLYDASH/USD from Dexscreener (on-chain price from the POLYDASH/WETH pool), 60 s cache.
// Same source as the x402 facilitator (lib/x402/facilitator.ts getPolydashUsd).
// Do NOT use CoinGecko's simple-price API for this token: it returned $0.00054081 on
// 2026-11-17 while the on-chain price was ~$0.000000194 — ~2,790x too high.
// Timeout is 8 s (not the facilitator's 3 s): this fetch runs in parallel with
// the pool reads, so a slow Dexscreener response costs no extra wall time, and
// a price that arrives at 4 s beats a null price.
let polyPrice: { price: number; at: number } | null = null;
async function getPolydashUsd(): Promise<number> {
  try {
    if (polyPrice && Date.now() - polyPrice.at < 60_000) return polyPrice.price;
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/0x319525528f42167eF7fC18b77b889958080568e4',
      { cache: 'no-store', signal: AbortSignal.timeout(8_000) },
    );
    const price = Number((await res.json())?.pairs?.[0]?.priceUsd);
    if (!Number.isFinite(price) || price <= 0) throw new Error('bad price');
    polyPrice = { price, at: Date.now() };
    return price;
  } catch {
    return polyPrice?.price ?? 0;
  }
}

async function tokenInfo(addr: Address, book: Awaited<ReturnType<typeof priceBook>>): Promise<TokenInfo> {
  const meta = await tokenMeta(addr);
  const b = book.get(addr.toLowerCase());
  const isPd = addr.toLowerCase() === POLYDASH_TOKEN.toLowerCase();
  return { address: addr, symbol: meta.symbol, name: b?.name ?? meta.symbol, decimals: meta.decimals, logo: isPd ? POLYDASH_LOGO : b?.logo ?? null, priceUsd: b?.priceUsd ?? null };
}

const num = (v: bigint | null | undefined, d: number) => (v == null ? 0 : Number(formatUnits(v, d)));

function summarize(p: RawPool, stake: TokenInfo, reward: TokenInfo, now: number, verified: boolean): PoolSummary {
  const d = p.data;
  const start = Number(d.startTime ?? 0), end = Number(d.endTime ?? 0);
  const totalStaked = num(d.totalStaked, stake.decimals);
  const totalRewards = num(d.totalRewards, reward.decimals);
  // rewardRate is stored x1e18 on V2 pools; detect it from totalRewards so the units are right either way.
  const rr: bigint = d.rewardRate ?? BigInt(0);
  const dur = BigInt(Math.max(end - start, 0));
  const scaled = d.totalRewards != null && dur > BigInt(0) && rr * dur > (d.totalRewards as bigint) * BigInt(1_000_000_000);
  const perSecSchedule = (scaled ? Number(rr) / 1e18 : Number(rr)) / 10 ** reward.decimals;
  const status = poolStatus({ startTime: start, endTime: end, totalStaked }, now);
  const perSec = status === 'ended' ? 0 : perSecSchedule;
  const same = !!d.sameToken || stake.address.toLowerCase() === reward.address.toLowerCase();

  let apr: number | null = null;
  let aprKind: PoolSummary['aprKind'] = 'na';
  if (status === 'ended') { apr = 0; aprKind = 'ended'; }
  else if (totalStaked === 0) aprKind = 'new';
  else {
    const perYear = perSecSchedule * 31_536_000;
    if (same) { apr = (perYear / totalStaked) * 100; aprKind = 'value'; }
    else if (stake.priceUsd && reward.priceUsd) { apr = ((perYear * reward.priceUsd) / (totalStaked * stake.priceUsd)) * 100; aprKind = 'value'; }
  }
  return {
    address: p.address, name: d.name || 'Staking pool', description: d.description || '', creator: d.creator ?? null,
    stake, reward, sameToken: same, totalStaked, totalRewards, totalRewardsPaid: num(d.totalRewardsPaid, reward.decimals),
    rewardsPerDay: perSec * 86_400, rewardsPerSec: perSec, startTime: start, endTime: end,
    stakerCount: Number(d.stakerCount ?? 0), maxTotalStake: num(d.maxTotalStake, stake.decimals), claimFeeBps: Number(d.claimFeeBps ?? 0),
    funded: !!d.funded, status, apr, aprKind, tvlUsd: stake.priceUsd ? totalStaked * stake.priceUsd : null,
    createdBlock: null, createdAt: null, featured: false, spark: [],
    factory: poolFactory.get(p.address.toLowerCase()) ?? null, verified,
  };
}

async function loadPools(): Promise<PoolSummary[]> {
  const addrs = await poolAddresses();
  const [raw, book, verified] = await Promise.all([readPools(addrs), priceBook(), readVerified(addrs)]);
  const now = Math.floor(Date.now() / 1000);
  const out: PoolSummary[] = [];
  for (const p of raw) {
    const [stake, reward] = await Promise.all([tokenInfo(p.data.stakeToken, book), tokenInfo(p.data.rewardToken ?? p.data.stakeToken, book)]);
    out.push(summarize(p, stake, reward, now, verified.get(p.address.toLowerCase()) ?? false));
  }
  return out;
}

// ---------- events (incremental in-memory index) ----------
type RawLog = { address: string; topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex; logIndex: Hex };
interface Ev { pool: string; kind: FlowItem['type']; user: string; a: bigint; sh: bigint; block: number; tx: string; li: number }
interface EvState { key: string; scannedTo: number; created: Map<string, number>; events: Ev[]; anchors: [number, number][] }
let evState: EvState | null = null;

const word = (data: Hex, i: number) => BigInt(`0x${data.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'}`);
function decode(l: RawLog): Ev | null {
  const t0 = l.topics[0];
  const kind: Ev['kind'] | null = t0 === SEL.staked ? 'stake' : t0 === SEL.withdrawn ? 'withdraw' : t0 === SEL.emergency ? 'emergency' : t0 === SEL.reward ? 'claim' : null;
  if (!kind || !l.topics[1]) return null;
  // Staked(amount, shares) | Withdrawn/Emergency(shares, amount) | RewardPaid(gross, net, ...)
  const a = kind === 'stake' ? word(l.data, 0) : kind === 'claim' ? word(l.data, 1) : word(l.data, 1);
  const sh = kind === 'stake' ? word(l.data, 1) : kind === 'claim' ? BigInt(0) : word(l.data, 0);
  return { pool: l.address.toLowerCase(), kind, user: `0x${l.topics[1].slice(26)}`.toLowerCase(), a, sh, block: Number(BigInt(l.blockNumber)), tx: l.transactionHash, li: Number(BigInt(l.logIndex)) };
}

async function scanEvents(pools: string[], fromOf: (pool: string) => number, to: number): Promise<Ev[]> {
  const out: Ev[] = [];
  // The RPC caps multi-value filters (several addresses or topics) at 100k blocks, so long ranges go
  // one pool and one signature at a time, sequentially, to keep the load light.
  for (const pool of pools) {
    const from = fromOf(pool);
    if (from > to) continue;
    for (const sel of [SEL.staked, SEL.withdrawn, SEL.emergency, SEL.reward]) {
      const logs = await getLogsRange(pool, [sel], from, to, 9_000_000, 1);
      for (const l of logs) { const e = decode(l as RawLog); if (e) out.push(e); }
    }
  }
  return out;
}

async function refreshEvents(poolAddrs: string[]): Promise<EvState> {
  const latest = await client.getBlock();
  const to = Number(latest.number);
  const pools = poolAddrs.map((a) => a.toLowerCase()).sort();
  const key = pools.join(',');
  let st = evState;
  if (!st || st.key !== key) {
    const created = new Map<string, number>();
    const logs: unknown[] = [];
    for (const f of STAKING_FACTORIES) {
      if (f.fromBlock > to) continue;
      logs.push(...(await getLogsRange(f.address, [SEL.created], Math.max(f.fromBlock, SCAN_FLOOR), to, 9_000_000, 1)));
    }
    for (const l of logs as RawLog[]) if (l.topics[1]) created.set(`0x${l.topics[1].slice(26)}`.toLowerCase(), Number(BigInt(l.blockNumber)));
    const events = await scanEvents(pools, (p) => created.get(p) ?? SCAN_FLOOR, to);
    st = { key, scannedTo: to, created, events, anchors: [] };
  } else if (to > st.scannedTo) {
    const from = st.scannedTo + 1;
    const more = to - from < 100_000
      ? (await getLogsRange(pools, [[SEL.staked, SEL.withdrawn, SEL.emergency, SEL.reward]], from, to, 100_000, 1)).map((l) => decode(l as RawLog)).filter((e): e is Ev => !!e)
      : await scanEvents(pools, () => from, to);
    st = { ...st, scannedTo: to, events: [...st.events, ...more] };
  }
  // Dedupe (tx, logIndex) so overlapping scans can never double count, then order by chain position.
  const seen = new Set<string>();
  st.events = st.events.filter((e) => { const k = `${e.tx}:${e.li}`; if (seen.has(k)) return false; seen.add(k); return true; });
  st.events.sort((a, b) => a.block - b.block || a.li - b.li);
  // Block -> time anchors (pool creation blocks + every ~2M blocks + latest), interpolated linearly.
  const minB = Math.min(...Array.from(st.created.values()), st.events[0]?.block ?? to);
  const marks = new Set<number>([minB, ...Array.from(st.created.values())]);
  for (let b = minB + 2_000_000; b < to; b += 2_000_000) marks.add(b);
  const anchors: [number, number][] = [];
  for (const b of Array.from(marks).sort((x, y) => x - y)) {
    try { anchors.push([b, await blockTime(b)]); } catch { /* skip anchor */ }
  }
  anchors.push([to, Number(latest.timestamp)]);
  st.anchors = anchors;
  evState = st;
  return st;
}

function timeOf(block: number, anchors: [number, number][]): number {
  if (!anchors.length) return 0;
  if (block <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [b1, t1] = anchors[i];
    if (block <= b1) {
      const [b0, t0] = anchors[i - 1];
      return Math.round(t0 + ((block - b0) / Math.max(b1 - b0, 1)) * (t1 - t0));
    }
  }
  return anchors[anchors.length - 1][1];
}

interface PoolAnalytics { series: DayPoint[]; top: TopStaker[]; flows: FlowItem[]; holders: Map<string, bigint> }

function analyze(p: PoolSummary, st: EvState): PoolAnalytics {
  const evs = st.events.filter((e) => e.pool === p.address.toLowerCase());
  const sd = p.stake.decimals, rd = p.reward.decimals;
  // Holders are tracked in exact on-chain SHARES (bigint), from the full event history.
  const holders = new Map<string, bigint>();
  const daily = new Map<number, { in: number; out: number }>();
  const flows: FlowItem[] = [];
  for (const e of evs) {
    const ts = timeOf(e.block, st.anchors);
    const amt = Number(formatUnits(e.a, e.kind === 'claim' ? rd : sd));
    flows.push({ type: e.kind, user: e.user, amount: amt, tx: e.tx, ts });
    if (e.kind === 'claim') continue;
    const day = Math.floor(ts / 86_400);
    const dd = daily.get(day) ?? { in: 0, out: 0 };
    const cur = holders.get(e.user) ?? BigInt(0);
    if (e.kind === 'stake') { dd.in += amt; holders.set(e.user, cur + e.sh); }
    else { dd.out += amt; holders.set(e.user, cur > e.sh ? cur - e.sh : BigInt(0)); }
    daily.set(day, dd);
  }
  const createdBlock = st.created.get(p.address.toLowerCase()) ?? evs[0]?.block;
  const startDay = Math.floor((createdBlock ? timeOf(createdBlock, st.anchors) : (evs.length ? timeOf(evs[0].block, st.anchors) : Date.now() / 1000)) / 86_400);
  const today = Math.floor(Date.now() / 86_400_000);
  const series: DayPoint[] = [];
  let run = 0;
  for (let d = startDay; d <= today; d++) {
    const dd = daily.get(d) ?? { in: 0, out: 0 };
    run = Math.max(0, run + dd.in - dd.out);
    series.push({ t: d * 86_400, staked: run, in: dd.in, out: dd.out });
  }
  // The last point uses the on-chain total (covers fee-on-transfer rounding).
  if (series.length) series[series.length - 1].staked = p.totalStaked;
  const live = Array.from(holders.entries()).filter(([, v]) => v > BigInt(0));
  const totalShares = live.reduce((s, [, v]) => s + v, BigInt(0));
  // share is a PERCENT (0..100) of all live shares; amount = that fraction of on-chain totalStaked.
  const top = live.sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, 10).map(([user, sh]) => {
    const frac = totalShares > BigInt(0) ? Number((sh * BigInt(1_000_000)) / totalShares) / 1_000_000 : 0;
    return { user, amount: frac * p.totalStaked, share: frac * 100 };
  });
  return { series, top, flows: flows.reverse().slice(0, 60), holders: new Map(live) };
}

// ---------- public API ----------
const getPools = () => swr('pools', loadPools, 8_000);
const getEvents = (addrs: string[]) => swr('events', () => refreshEvents(addrs), 5_000);

function totalsFor(pools: PoolSummary[], st: EvState | null): StakeTotals {
  const add = (m: Map<string, TokenTotal>, t: TokenInfo, amount: number) => {
    const k = t.address.toLowerCase();
    const cur = m.get(k) ?? { address: t.address, symbol: t.symbol, logo: t.logo, amount: 0, usd: t.priceUsd != null ? 0 : null };
    cur.amount += amount;
    if (cur.usd != null && t.priceUsd != null) cur.usd += amount * t.priceUsd;
    m.set(k, cur);
  };
  const staked = new Map<string, TokenTotal>(), alloc = new Map<string, TokenTotal>(), paid = new Map<string, TokenTotal>();
  for (const p of pools) { add(staked, p.stake, p.totalStaked); add(alloc, p.reward, p.totalRewards); add(paid, p.reward, p.totalRewardsPaid); }
  const sort = (m: Map<string, TokenTotal>) => Array.from(m.values())
    // A token with zero total amount is worth $0 however its price was read,
    // so it must not block the USD total: SWARM's price comes from the
    // launches snapshot, which is often not ready in 2.5s, and its zero-amount
    // entry (usd null) used to make totalFigure fall back to "Value
    // unavailable" for the whole total even though POLYDASH was priced
    // (round 7). A nonzero holding with no price still stays null, so the
    // total stays honest about missing value.
    .map((t) => (t.amount === 0 && t.usd == null ? { ...t, usd: 0 } : t))
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.amount - a.amount);
  // Unique wallets with a share balance > 0 across these pools, from the full event history. Until
  // the first scan finishes we reuse the last exact value (never a different method's count).
  // Fallback while the scan has never completed: the sum of each pool's
  // on-chain stakerCount (already read in the pool multicall — no extra RPC).
  // The scan is a 37M-block event walk that never finishes inside one
  // serverless request (each request waits 5s, then the background refresh
  // is frozen), so without this the tile spun on "Counting stakers…" forever.
  // The sum can double-count a wallet staked in two pools; the exact unique
  // count replaces it as soon as the scan completes (stakersExact is false
  // until then).
  const cacheKey = pools.map((p) => p.address.toLowerCase()).sort().join(',');
  let stakers: number | null = lastStakers.get(cacheKey) ?? null;
  let exact = false;
  if (st) {
    const users = new Set<string>();
    for (const p of pools) analyze(p, st).holders.forEach((_, u) => users.add(u));
    stakers = users.size; exact = true;
    lastStakers.set(cacheKey, stakers);
  } else if (stakers == null) {
    stakers = pools.reduce((s, p) => s + (p.stakerCount ?? 0), 0);
  }
  return { pools: pools.length, active: pools.filter((p) => p.status !== 'ended' && p.status !== 'upcoming').length, staked: sort(staked), rewardsAllocated: sort(alloc), rewardsPaid: sort(paid), stakers, stakersExact: exact };
}

const lastStakers = new Map<string, number>();
const lastPoolStakers = new Map<string, number>();

function rank(p: PoolSummary) { return p.status === 'ended' ? 3 : p.status === 'upcoming' ? 2 : 1; }

export async function getStakingOverview(token?: string | null): Promise<PoolsResponse | null> {
  const base = await getPools();
  if (!base) return null;
  const st = await getEvents(base.map((p) => p.address));
  let pools = base.map((p) => ({ ...p }));
  if (st) {
    for (const p of pools) {
      const a = analyze(p, st);
      p.spark = a.series.slice(-30).map((d) => d.staked);
      p.createdBlock = st.created.get(p.address.toLowerCase()) ?? null;
      p.createdAt = p.createdBlock ? timeOf(p.createdBlock, st.anchors) : null;
      p.stakerCount = a.holders.size;
      lastPoolStakers.set(p.address.toLowerCase(), a.holders.size);
    }
  } else {
    for (const p of pools) { const c = lastPoolStakers.get(p.address.toLowerCase()); if (c != null) p.stakerCount = c; }
  }
  // Featured: the newest live POLYDASH pool.
  const pd = pools.filter((p) => p.stake.address.toLowerCase() === POLYDASH_TOKEN.toLowerCase() && p.status !== 'ended')
    .sort((a, b) => (b.createdBlock ?? 0) - (a.createdBlock ?? 0) || b.startTime - a.startTime)[0];
  if (pd) pd.featured = true;
  pools.sort((a, b) => Number(b.featured) - Number(a.featured) || rank(a) - rank(b) || (b.apr ?? -1) - (a.apr ?? -1) || b.totalStaked - a.totalStaked);
  if (token) {
    const t = token.toLowerCase();
    pools = pools.filter((p) => p.stake.address.toLowerCase() === t || p.reward.address.toLowerCase() === t);
  }
  const totals = totalsFor(pools, st);
  return { pools, totals, analyticsPending: !st, updatedAt: Date.now() };
}

export async function getPoolDetail(pool: string): Promise<PoolDetailResponse | 'not-found' | null> {
  const ov = await getStakingOverview();
  if (!ov) return null;
  const p = ov.pools.find((x) => x.address.toLowerCase() === pool.toLowerCase());
  if (!p) return 'not-found';
  const now = Math.floor(Date.now() / 1000);
  const span = Math.max(p.endTime - p.startTime, 1);
  const emitted = p.totalRewards * Math.min(1, Math.max(0, (now - p.startTime) / span));
  const st = evState && !ov.analyticsPending ? evState : null;
  const a = st ? analyze(p, st) : null;
  return { pool: p, series: a?.series ?? [], top: a?.top ?? [], flows: a?.flows ?? [], emitted, analyticsPending: !a, updatedAt: ov.updatedAt };
}
