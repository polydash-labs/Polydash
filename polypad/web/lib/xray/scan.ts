// Bundle & Sniper X-ray scanner. Server only. Runs inside the CTO sync / background refresh (<= 1/min/token);
// the CTO tab only reads XrayResult. Early-window inputs (T0..T0+200) are collected once and frozen; later
// runs only read token transfers from the cursor and current balances.
import { formatEther, getAddress, pad, parseAbi, toEventSelector, type Address, type Hex } from 'viem';
import { prisma } from '@/lib/db';
import { publicClient, listPools } from '@/lib/agents/tools';
import { getLogsRange, blockTime, addAlerts } from '@/lib/cto/chain';
import { XRAY, STATIC_KNOWN, SELL_DESTINATIONS, COMMIT_VAULTS } from './config';
import { FUNDERS_IGNORE } from './funders-ignore';
import { getFundingMany } from './blockscout';
import { detect, clusterState, verdict, confidenceLabel, xrayAlerts, type BuyEv, type C2Ev, type DetectedCluster, type Flow, type Level, type Funding } from './core';

const LAUNCH_ABI = parseAbi([
  'function creator() view returns (address)',
  'function creatorPayoutWallet() view returns (address)',
  'function tradingStartBlock() view returns (uint256)',
  'function tradingStartTime() view returns (uint256)',
  'function antiSniperCapBlocks() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function token() view returns (address)',
]);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function totalSupply() view returns (uint256)']);

const SEL = {
  bought: toEventSelector('Bought(address,uint256,uint256,uint256,uint256,uint256)'),
  tradingOpened: toEventSelector('TradingOpened(uint256,uint256)'),
  devBuy: toEventSelector('DevBuyExecuted(address,uint256,uint256)'),
  committed: toEventSelector('Committed(address,uint256)'),
  processed: toEventSelector('CommitmentProcessed(address,uint256,uint256)'),
  sniperTax: toEventSelector('SniperTaxCollected(address,uint256)'),
  deposited: toEventSelector('Deposited(address,address,uint256,uint256)'),
  claimed: toEventSelector('Claimed(address,address,uint256,uint256,uint256)'),
  transfer: toEventSelector('Transfer(address,address,uint256)'),
};

type RawLog = Awaited<ReturnType<typeof getLogsRange>>[number];
const lc = (a: string) => a.toLowerCase();
const bn = (l: RawLog) => Number(BigInt(l.blockNumber));
const topicAddr = (t?: Hex) => (t ? `0x${t.slice(26)}`.toLowerCase() : '0x0000000000000000000000000000000000000000');
const word = (l: RawLog, i: number) => BigInt(`0x${l.data.slice(2 + 64 * i, 66 + 64 * i) || '0'}`);
const tok = (v: bigint) => Number(formatEther(v));
const MAX_COMMITTERS_BAL = 300;
const MAX_TRACKED = 400;

interface WalletFlow { received: number; sold: number; sells: [number, number, string][]; lastSellTx: string | null }
interface XState {
  v: 1; t0: number; t0Ts: number; secPerBlock: number; capBlocks: number; token: string; createdBlock: number;
  creatorWallets: string[]; devBuy: { wallet: string; tokens: number; tx: string } | null;
  buys: BuyEv[]; committers: string[]; sniperTaxed: string[]; funding: Record<string, Funding | 'pending'>;
  c2: C2Ev[]; flows: Record<string, WalletFlow>; cursor: number;
  knownClusterIds: string[]; lastSnapshotAt: number; lastLevel: Level | null;
}

export interface XrayWallet { address: string; bought: number; held: number; sold: number; firstBuyRel: number | null; fundingTx: string | null; creatorTx: string | null }
export interface XrayClusterOut {
  id: string; type: DetectedCluster['type']; confidence: number; confidenceLabel: string; rules: string[]; reason: string;
  heldPct: number; soldPct: number; status: string; dumping: boolean; walletCount: number; wallets: XrayWallet[]; lastSellTx: string | null;
}
export interface XrayStats {
  sentence: string; sniperPct: number; sniperCount: number; bundleCount: number; bundlePct: number; creatorLinkedCount: number; creatorPct: number;
  segments: { snipers: number; bundles: number; creator: number; dev: number; committers: number; pools: number; others: number };
  dumping: boolean; fundingPending: boolean; exited: boolean; t0: number | null; weakCount: number; committerCount: number;
}

const inflight = new Map<string, Promise<void>>();
const dbg = (...a: unknown[]) => { if (process.env.XRAY_DEBUG) console.log('[xray]', new Date().toISOString().slice(11, 19), ...a); };

/** Scan every indexed launch that is due (throttled per token). Never throws. */
export async function scanAllXray(maxPerRun = 25) {
  const rows = await prisma.tokenCTO.findMany({ select: { launchAddress: true } });
  const results = await prisma.xrayResult.findMany({ select: { launchAddress: true, updatedAt: true } });
  const last = new Map(results.map((r) => [r.launchAddress, r.updatedAt.getTime()]));
  const due = rows.map((r) => r.launchAddress).filter((a) => Date.now() - (last.get(a) ?? 0) >= XRAY.throttleMs)
    .sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0)).slice(0, maxPerRun);
  for (const a of due) await scanLaunchXray(a).catch((e) => console.error('xray scan failed', a, e?.message));
}

/** Scan one launch (one run per launch at a time, throttled to 1/min unless forced). */
export function scanLaunchXray(launch: string, force = false): Promise<void> {
  const key = lc(launch);
  const running = inflight.get(key);
  if (running) return running;
  const p = run(key, force).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function run(key: string, force: boolean) {
  const prev = await prisma.xrayResult.findUnique({ where: { launchAddress: key } });
  if (!force && prev && Date.now() - prev.updatedAt.getTime() < XRAY.throttleMs) return;
  const row = await prisma.tokenCTO.findUnique({ where: { launchAddress: key } });
  if (!row) return;
  const launch = getAddress(key) as Address;
  const latest = Number(await publicClient.getBlockNumber());
  let state = (prev?.state && (prev.state as any).v === 1 ? prev.state : null) as unknown as XState | null;

  dbg('start', key, 'latest', latest, 'state', !!state);
  // ---- 1) early window (once) ----
  if (!state) {
    const init = await initState(launch, row.tokenAddress, row.createdBlock, latest);
    if (!init) {
      await save(key, { level: 'waiting', flaggedPct: 0, stats: {}, clusters: [], partial: false, lastScannedBlock: latest, earlyWindowFrozen: false, state: {} });
      return;
    }
    state = init;
  } else if (latest > state.t0 + XRAY.earlyWindowBlocks && Object.values(state.funding).some((f) => f === 'pending')) {
    // retry funding checks that failed earlier
    const pendingW = Object.entries(state.funding).filter(([, f]) => f === 'pending').map(([w]) => w);
    Object.assign(state.funding, await getFundingMany(pendingW));
  }
  // early window still being mined: re-collect its inputs (only ~200 blocks, so cheap)
  else if (latest <= state.t0 + XRAY.earlyWindowBlocks + 5) {
    const refreshed = await initState(launch, row.tokenAddress, row.createdBlock, latest);
    if (refreshed) state = { ...refreshed, flows: {}, cursor: refreshed.cursor, knownClusterIds: state.knownClusterIds, lastSnapshotAt: state.lastSnapshotAt, lastLevel: state.lastLevel };
  }

  // ---- 2) token transfers since the cursor: flows of tracked wallets + creator transfers (C2) ----
  dbg('early window ready', 't0', state.t0, 'buys', state.buys.length, 'committers', state.committers.length);
  const known = new Set<string>([...STATIC_KNOWN, key, ...(await stakingPoolsFor(state.token))]);
  dbg('pools done');
  const sellTo = new Set<string>([...SELL_DESTINATIONS, key]);
  const creators = new Set(state.creatorWallets);
  const from = state.cursor + 1;
  if (from <= latest) {
    const chunk = state.cursor <= state.createdBlock ? 9_000_000 : XRAY.incrementalChunk;
    const logs = await getLogsRange(state.token, [SEL.transfer], from, latest, chunk, 6);
    const tracked = trackedSet(state);
    for (const l of logs) {
      const f = topicAddr(l.topics[1]), t = topicAddr(l.topics[2]), v = tok(word(l, 0)), b = bn(l);
      if (creators.has(f) && !known.has(t) && !creators.has(t) && !state.committers.includes(t)) {
        state.c2.push({ to: t, value: v, tx: l.transactionHash, block: b });
        if (!tracked.has(t) && tracked.size < MAX_TRACKED) tracked.add(t);
      }
      if (tracked.has(t)) flowOf(state, t).received += v;
      if (tracked.has(f)) {
        const fl = flowOf(state, f);
        if (sellTo.has(t)) { fl.sold += v; fl.sells.push([b, v, l.transactionHash]); fl.lastSellTx = l.transactionHash; }
      }
    }
    state.cursor = latest;
    dbg('transfers', logs.length);
  }

  // ---- 3) detection on frozen inputs ----
  const ignoreFunder = (a: string) => FUNDERS_IGNORE.includes(a) || known.has(a);
  const supplyWei = (await publicClient.readContract({ address: getAddress(state.token), abi: ERC20, functionName: 'totalSupply' }).catch(() => BigInt(row.totalSupply || '0'))) as bigint;
  const supply = tok(supplyWei);
  const det = detect({
    t0: state.t0, t0Ts: state.t0Ts, secPerBlock: state.secPerBlock, capBlocks: state.capBlocks, creatorWallets: state.creatorWallets,
    supply, buys: state.buys, committers: state.committers, sniperTaxed: state.sniperTaxed, known: Array.from(known),
    funding: state.funding, c2: supply > 0 ? state.c2 : [], ignoreFunder,
  });

  // ---- 4) balances (latest block) ----
  const flagged = Array.from(new Set(det.clusters.flatMap((c) => c.wallets.map((w) => w.address))));
  const committersSample = state.committers.slice(0, MAX_COMMITTERS_BAL);
  const poolsList = Array.from(known);
  const balTargets = [...flagged, ...state.creatorWallets, ...committersSample, ...poolsList];
  const balRes = await publicClient.multicall({
    contracts: balTargets.map((a) => ({ address: getAddress(state!.token), abi: ERC20, functionName: 'balanceOf', args: [getAddress(a)] })) as any,
    allowFailure: true,
  });
  let balanceErrors = 0;
  const bal = new Map<string, number>();
  balTargets.forEach((a, i) => {
    const r = balRes[i];
    if (r?.status === 'success') bal.set(a, tok(r.result as bigint)); else balanceErrors++;
  });

  // ---- 5) cluster state, verdict ----
  const nowTs = await blockTime(latest).catch(() => Math.floor(Date.now() / 1000));
  const tsOf = (b: number) => nowTs - (latest - b) * state!.secPerBlock;
  const flowsFor: Record<string, Flow> = {};
  for (const fl of Object.values(state.flows)) fl.sells = fl.sells.filter(([b]) => tsOf(b) >= nowTs - 86_400);
  for (const a of flagged) {
    const fl = state.flows[a] ?? { received: 0, sold: 0, sells: [], lastSellTx: null };
    fl.sells = fl.sells.filter(([b]) => tsOf(b) >= nowTs - 86_400);
    const held = bal.get(a) ?? 0;
    const s1 = fl.sells.filter(([b]) => tsOf(b) >= nowTs - 3_600).reduce((s, x) => s + x[1], 0);
    const s24 = fl.sells.reduce((s, x) => s + x[1], 0);
    flowsFor[a] = { received: fl.received, sold: fl.sold, held, sold1h: s1, sold24h: s24, lastSellTx: fl.lastSellTx };
  }
  const fundingPending = det.pending.length > 0;
  const partial = fundingPending || balanceErrors > 0;
  const outClusters: XrayClusterOut[] = det.clusters.map((c) => {
    const addrs = c.wallets.map((w) => w.address);
    const cs = clusterState(addrs, flowsFor, supply);
    return {
      id: c.id, type: c.type, confidence: c.confidence, confidenceLabel: confidenceLabel(c.confidence), rules: c.rules, reason: c.reason,
      heldPct: cs.heldPct, soldPct: cs.soldPct, status: cs.status, dumping: cs.dumping, walletCount: addrs.length, lastSellTx: cs.lastSellTx,
      wallets: c.wallets.slice(0, 50).map((w) => ({
        address: w.address, bought: flowsFor[w.address]?.received ?? 0, held: flowsFor[w.address]?.held ?? 0, sold: flowsFor[w.address]?.sold ?? 0,
        firstBuyRel: w.firstBuyBlock != null ? w.firstBuyBlock - state!.t0 : null, fundingTx: w.fundingTx, creatorTx: w.creatorTx,
      })),
      _s1: cs.sold1hPct, _s24: cs.sold24hPct,
    } as XrayClusterOut & { _s1: number; _s24: number };
  }).sort((a, b) => b.heldPct - a.heldPct);
  const v = verdict(outClusters.map((c) => ({ type: c.type, confidence: c.confidence, heldPct: c.heldPct, status: c.status as any })), partial);

  const counted = outClusters.filter((c) => c.confidence >= 2);
  const sumBy = (t: string) => counted.filter((c) => c.type === t).reduce((s, c) => s + c.heldPct, 0);
  const pctOf = (n: number) => (supply > 0 ? (n / supply) * 100 : 0);
  const devPct = pctOf(state.creatorWallets.reduce((s, a) => s + (bal.get(a) ?? 0), 0));
  const committerPct = pctOf(committersSample.reduce((s, a) => s + (bal.get(a) ?? 0), 0));
  const poolsPct = pctOf(poolsList.reduce((s, a) => s + (bal.get(a) ?? 0), 0));
  const seg = { snipers: sumBy('sniper'), bundles: sumBy('bundle'), creator: sumBy('creator'), dev: devPct, committers: committerPct, pools: poolsPct, others: 0 };
  seg.others = Math.max(0, 100 - seg.snipers - seg.bundles - seg.creator - seg.dev - seg.committers - seg.pools);
  const stats: XrayStats = {
    sentence: v.sentence, sniperPct: seg.snipers, sniperCount: counted.filter((c) => c.type === 'sniper').reduce((s, c) => s + c.walletCount, 0),
    bundleCount: counted.filter((c) => c.type === 'bundle').length, bundlePct: seg.bundles,
    creatorLinkedCount: counted.filter((c) => c.type === 'creator').reduce((s, c) => s + c.walletCount, 0), creatorPct: seg.creator,
    segments: seg, dumping: counted.some((c) => c.dumping), fundingPending, exited: v.exited, t0: state.t0,
    weakCount: outClusters.length - counted.length, committerCount: state.committers.length,
  };

  // ---- 6) alerts + snapshots ----
  const frozen = latest > state.t0 + XRAY.earlyWindowBlocks && !fundingPending;
  const alertRows = xrayAlerts({
    launch: key, symbol: row.symbol, now: Date.now(), prevLevel: state.lastLevel, level: v.level,
    knownClusterIds: state.knownClusterIds, frozenBefore: !!prev?.earlyWindowFrozen,
    clusters: (outClusters as (XrayClusterOut & { _s1: number; _s24: number })[]).map((c) => ({ id: c.id, type: c.type, confidence: c.confidence, walletCount: c.walletCount, sold1hPct: c._s1, sold24hPct: c._s24, lastSellTx: c.lastSellTx })),
  });
  await addAlerts(alertRows.map((a) => ({ launchAddress: key, ...a }))).catch((e) => console.error('xray alerts failed', e?.message));
  if (Date.now() - state.lastSnapshotAt >= XRAY.snapshotEveryMs && counted.length) {
    await prisma.xrayClusterSnapshot.createMany({
      data: counted.map((c) => ({ launchAddress: key, clusterId: c.id, heldTokens: String(c.wallets.reduce((s, w) => s + w.held, 0)) })),
    }).catch(() => null);
    state.lastSnapshotAt = Date.now();
  }
  state.knownClusterIds = Array.from(new Set([...state.knownClusterIds, ...counted.map((c) => c.id)]));
  if (v.level === 'clean' || v.level === 'some' || v.level === 'heavy') state.lastLevel = v.level;
  const clientClusters = outClusters.map(({ _s1, _s24, ...c }: any) => c);
  await save(key, { level: v.level, flaggedPct: v.flaggedPct, stats: stats as any, clusters: clientClusters as any, partial, lastScannedBlock: latest, earlyWindowFrozen: frozen, state: state as any });
}

function trackedSet(s: XState) {
  const t = new Set<string>(s.buys.map((b) => b.buyer));
  s.c2.forEach((e) => t.add(e.to));
  s.creatorWallets.forEach((c) => t.delete(c));
  s.committers.forEach((c) => t.delete(c));
  return new Set(Array.from(t).slice(0, MAX_TRACKED));
}

function flowOf(s: XState, a: string): WalletFlow {
  return (s.flows[a] ??= { received: 0, sold: 0, sells: [], lastSellTx: null });
}

// Staking pools are enumerated once per 15 min for all launches (listing them is slow).
let poolCache: { at: number; p: Promise<{ address: string; stakeToken: string | null }[]> } | null = null;
async function stakingPoolsFor(token: string): Promise<string[]> {
  try {
    if (!poolCache || Date.now() - poolCache.at > 15 * 60_000) {
      const p = listPools().then((l) => l.map((x) => ({ address: lc(x.address), stakeToken: x.stakeToken ? lc(x.stakeToken) : null })));
      poolCache = { at: Date.now(), p };
      p.catch(() => { poolCache = null; });
    }
    const pools = await poolCache.p;
    return pools.filter((p) => p.stakeToken === lc(token)).map((p) => p.address);
  } catch { return []; }
}

async function save(key: string, data: { level: string; flaggedPct: number; stats: any; clusters: any; partial: boolean; lastScannedBlock: number; earlyWindowFrozen: boolean; state: any }) {
  await prisma.xrayResult.upsert({ where: { launchAddress: key }, create: { launchAddress: key, ...data }, update: data });
}

/** Collect the early-window inputs. Returns null while trading has not opened. */
async function initState(launch: Address, tokenAddr: string, createdBlock: number, latest: number): Promise<XState | null> {
  const read = <T,>(fn: string) => publicClient.readContract({ address: launch, abi: LAUNCH_ABI, functionName: fn as any }).then((r) => r as T).catch(() => null);
  const [creator, payout, tsb, tst] = await Promise.all([
    read<Address>('creator'), read<Address>('creatorPayoutWallet'), read<bigint>('tradingStartBlock'), read<bigint>('tradingStartTime'),
  ]);
  const startBlock = Math.max(createdBlock, 1);
  // On this chain `block.number` inside contracts is the parent-chain (L1) block number, so tradingStartBlock and
  // TradingOpened.blockNumber can't be used as log block numbers. T0 = the L2 block of the TradingOpened log
  // (fallback: first Bought); tradingStartBlock only tells us trading has opened. The anti-sniper cap is also
  // counted in L1 blocks, so S2 uses the time window (XRAY.earlySeconds) instead.
  let t0 = 0;
  let t0Ts = tst ? Number(tst) : 0;
  const opened = await getLogsRange(launch, [SEL.tradingOpened], startBlock, latest).catch(() => [] as RawLog[]);
  if (opened[0]) { t0 = bn(opened[0]); t0Ts = t0Ts || Number(word(opened[0], 0)); }
  if (!t0 && (tsb || tst)) {
    const firstBuy = await getLogsRange(launch, [SEL.bought], startBlock, latest).catch(() => [] as RawLog[]);
    if (firstBuy[0]) t0 = bn(firstBuy[0]);
  }
  if (!t0) return null;
  const t0BlockTs = await blockTime(t0);
  if (!t0Ts || Math.abs(t0Ts - t0BlockTs) > 120) t0Ts = t0BlockTs;
  const cap = 0;
  dbg('t0', t0);
  const endBlock = Math.min(latest, t0 + XRAY.earlyWindowBlocks);
  const endTs = endBlock > t0 ? await blockTime(endBlock) : t0Ts;
  const secPerBlock = endBlock > t0 && endTs > t0Ts ? (endTs - t0Ts) / (endBlock - t0) : 0.25;

  // Sequential to stay under the RPC rate limit. Vault deposits happen before trading opens, so the early range is enough.
  const launchLogs = await getLogsRange(launch, [[SEL.bought, SEL.devBuy, SEL.committed, SEL.processed, SEL.sniperTax]], startBlock, endBlock);
  const vaultLogs = await getLogsRange(COMMIT_VAULTS, [[SEL.deposited, SEL.claimed], pad(launch)], startBlock, endBlock).catch(() => [] as RawLog[]);
  const creatorWallets = Array.from(new Set([creator, payout].filter((a): a is Address => !!a && !/^0x0+$/.test(a)).map(lc)));
  const committers = new Set<string>();
  const sniperTaxed = new Set<string>();
  const buys: BuyEv[] = [];
  let devBuy: XState['devBuy'] = null;
  for (const l of launchLogs) {
    const s = l.topics[0];
    const who = topicAddr(l.topics[1]);
    if (s === SEL.committed || s === SEL.processed) committers.add(who);
    else if (s === SEL.sniperTax) sniperTaxed.add(who);
    else if (s === SEL.devBuy) devBuy = { wallet: who, tokens: tok(word(l, 1)), tx: l.transactionHash };
    else if (s === SEL.bought && bn(l) >= t0) buys.push({ buyer: who, block: bn(l), tx: l.transactionHash, logIndex: Number(BigInt(l.logIndex)), tokens: tok(word(l, 1)), eth: tok(word(l, 0)) });
  }
  for (const l of vaultLogs) committers.add(topicAddr(l.topics[2]));
  if (devBuy) creatorWallets.push(...[(devBuy as { wallet: string }).wallet].filter((w) => !creatorWallets.includes(w)));

  // funding checks for the earliest distinct buyers (explorer API; 'pending' when unavailable)
  const never = new Set([...committers, ...creatorWallets]);
  const early: string[] = [];
  for (const b of buys.sort((a, c) => a.block - c.block || a.logIndex - c.logIndex)) {
    if (!never.has(b.buyer) && !early.includes(b.buyer)) early.push(b.buyer);
    if (early.length >= XRAY.maxFundingWallets) break;
  }
  dbg('launch logs', launchLogs.length, 'vault logs', vaultLogs.length, 'funding wallets', early.length);
  const funding = early.length ? await getFundingMany(early) : {};
  dbg('funding done');

  return {
    v: 1, t0, t0Ts, secPerBlock, capBlocks: cap ? Number(cap) : 0, token: lc(tokenAddr), createdBlock: startBlock,
    creatorWallets, devBuy, buys, committers: Array.from(committers), sniperTaxed: Array.from(sniperTaxed), funding,
    c2: [], flows: {}, cursor: startBlock - 1, knownClusterIds: [], lastSnapshotAt: 0, lastLevel: null,
  };
}

/** Cached result for the API / CTO tab (no RPC). */
export async function getXray(launch: string) {
  const r = await prisma.xrayResult.findUnique({ where: { launchAddress: lc(launch) } }).catch(() => null);
  if (!r) return null;
  return { level: r.level, flaggedPct: r.flaggedPct, stats: r.stats as unknown as XrayStats, clusters: r.clusters as unknown as XrayClusterOut[], partial: r.partial, updatedAt: r.updatedAt.toISOString(), lastScannedBlock: r.lastScannedBlock };
}
