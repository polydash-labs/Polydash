// Bundle & Sniper X-ray: pure detection, cluster state and verdict (no I/O, unit-testable). Addresses lowercase.
import { XRAY } from './config';

export type RuleId = 'S1' | 'S2' | 'S3' | 'B1' | 'B2' | 'B3' | 'B4' | 'C1' | 'C2';
export type ClusterType = 'sniper' | 'bundle' | 'creator';
export type Level = 'scanning' | 'waiting' | 'clean' | 'some' | 'heavy' | 'partial';
export type Status = 'holding' | 'trimming' | 'mostly_sold' | 'exited';

export interface BuyEv { buyer: string; block: number; tx: string; logIndex: number; tokens: number; eth: number }
export interface FundingTx { h: string; f: string; t: string; v: number; ts: number }
export interface Funding { firstFunder: string | null; fundingTx: string | null; fundedAt: number | null; txs: FundingTx[]; truncated: boolean }
export interface C2Ev { to: string; value: number; tx: string; block: number }

export interface DetectInput {
  t0: number; t0Ts: number; secPerBlock: number; capBlocks: number;
  creatorWallets: string[]; supply: number;
  buys: BuyEv[];          // public Bought events in [t0, t0 + earlyWindowBlocks]
  committers: string[];   // commitment-window participants (never flagged)
  sniperTaxed: string[];  // buyers with SniperTaxCollected
  known: string[];        // contracts / platform wallets (never flagged)
  funding: Record<string, Funding | 'pending'>;
  c2: C2Ev[];             // token transfers out of creator wallets
  ignoreFunder: (a: string) => boolean;
}

export interface WalletInfo {
  address: string; firstBuyBlock: number | null; firstBuyTs: number | null; firstBuyEth: number;
  funder: string | null; fundingTx: string | null; fundedAt: number | null; creatorTx: string | null; rules: RuleId[];
}
export interface DetectedCluster { id: string; type: ClusterType; wallets: WalletInfo[]; rules: RuleId[]; confidence: number; reason: string }

const uniq = <T,>(a: T[]) => Array.from(new Set(a));
/** Independent rule groups: same-block and early timing are one signal. */
export function confidenceOf(rules: RuleId[]) {
  return new Set(rules.map((r) => (r === 'S1' || r === 'S2' ? 'S' : r))).size;
}
export const confidenceLabel = (n: number) => (n >= 3 ? 'high' : n === 2 ? 'medium' : 'low');

const whenPhrase = (rel: number) => (rel <= 0 ? 'in the opening block' : `in block ${rel} after trading opened`);
const minutesPhrase = (sec: number) => (sec < 60 ? 'under a minute' : `${Math.round(sec / 60)} minute${Math.round(sec / 60) === 1 ? '' : 's'}`);

export function detect(input: DetectInput): { clusters: DetectedCluster[]; pending: string[] } {
  const { t0, t0Ts, secPerBlock } = input;
  const creators = new Set(input.creatorWallets);
  const never = new Set([...input.committers, ...input.known, ...input.creatorWallets]);
  const taxed = new Set(input.sniperTaxed);
  const tsOf = (b: number) => t0Ts + (b - t0) * secPerBlock;
  const N = Math.max(XRAY.earlyBlocksMin, input.capBlocks);

  const buys = input.buys.filter((b) => !never.has(b.buyer) && b.block >= t0 && b.block <= t0 + XRAY.earlyWindowBlocks)
    .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const info = new Map<string, WalletInfo>();
  const w = (a: string) => {
    let x = info.get(a);
    if (!x) { x = { address: a, firstBuyBlock: null, firstBuyTs: null, firstBuyEth: 0, funder: null, fundingTx: null, fundedAt: null, creatorTx: null, rules: [] }; info.set(a, x); }
    return x;
  };
  const add = (a: string, r: RuleId) => { const x = w(a); if (!x.rules.includes(r)) x.rules.push(r); };

  for (const b of buys) {
    const x = w(b.buyer);
    if (x.firstBuyBlock == null) { x.firstBuyBlock = b.block; x.firstBuyTs = tsOf(b.block); x.firstBuyEth = b.eth; }
  }
  // S1 / S2 / S3 on each wallet's first buy
  for (const x of info.values()) {
    const b = x.firstBuyBlock!;
    if (b === t0) add(x.address, 'S1');
    else if (b <= t0 + N || (x.firstBuyTs! - t0Ts) <= XRAY.earlySeconds) add(x.address, 'S2');
    if (taxed.has(x.address)) add(x.address, 'S3');
  }

  // union-find over group rules
  const parent = new Map<string, string>();
  const find = (a: string): string => { const p = parent.get(a) ?? a; if (p === a) return a; const r = find(p); parent.set(a, r); return r; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const groupFacts: { members: string[]; rule: RuleId; detail: { block?: number; tx?: string; funder?: string; gapSec?: number } }[] = [];

  // B1: >=3 distinct buyers in one block (first 50 blocks), or >=2 Bought in one tx
  const byBlock = new Map<number, Set<string>>(), byTx = new Map<string, BuyEv[]>();
  for (const b of buys) {
    if (b.block <= t0 + XRAY.clusterWindowBlocks) { const s = byBlock.get(b.block) ?? new Set(); s.add(b.buyer); byBlock.set(b.block, s); }
    const l = byTx.get(b.tx) ?? []; l.push(b); byTx.set(b.tx, l);
  }
  for (const [block, s] of byBlock) if (s.size >= XRAY.clusterMinBuyers) groupFacts.push({ members: Array.from(s), rule: 'B1', detail: { block } });
  for (const [tx, l] of byTx) if (l.length >= 2) groupFacts.push({ members: uniq(l.map((b) => b.buyer)), rule: 'B1', detail: { tx, block: l[0].block } });

  // Funding-based rules (B2, B4, C1)
  const pending: string[] = [];
  const byFunder = new Map<string, { a: string; gap: number }[]>();
  for (const x of info.values()) {
    const f = input.funding[x.address];
    if (f === undefined) continue;
    if (f === 'pending') { pending.push(x.address); continue; }
    const buyTs = x.firstBuyTs!;
    x.funder = f.firstFunder; x.fundingTx = f.fundingTx; x.fundedAt = f.fundedAt;
    const funded = f.fundedAt != null && f.fundedAt <= buyTs && buyTs - f.fundedAt <= XRAY.fundingWindowSec;
    const ff = f.firstFunder;
    if (funded && ff && !creators.has(ff) && !input.ignoreFunder(ff) && !never.has(ff)) {
      const l = byFunder.get(ff) ?? []; l.push({ a: x.address, gap: buyTs - f.fundedAt! }); byFunder.set(ff, l);
    }
    const txsBefore = f.txs.filter((t) => t.f === x.address && t.ts < buyTs).length;
    if (funded && !f.truncated && txsBefore <= XRAY.freshMaxTxs) add(x.address, 'B4');
    // C1: first funding from a creator wallet, or >= 0.01 ETH from one in the 24h before the first buy
    const cTx = f.firstFunder && creators.has(f.firstFunder) ? f.fundingTx
      : f.txs.find((t) => creators.has(t.f) && t.t === x.address && t.v >= XRAY.creatorFundingMinEth && t.ts <= buyTs && buyTs - t.ts <= XRAY.creatorFundingWindowSec)?.h ?? null;
    if (cTx) { add(x.address, 'C1'); x.creatorTx = cTx; }
  }
  for (const [funder, l] of byFunder) {
    if (l.length < 2) continue;
    const gaps = l.map((g) => g.gap).sort((a, b) => a - b);
    groupFacts.push({ members: l.map((g) => g.a), rule: 'B2', detail: { funder, gapSec: gaps[Math.floor(gaps.length / 2)] } });
  }

  // C2: token transfers from creator wallets (>= 0.1% of supply) to non-known wallets
  const c2min = (input.supply * XRAY.creatorTransferMinBps) / 10_000;
  for (const e of input.c2) {
    if (never.has(e.to) || e.value < c2min) continue;
    const x = w(e.to);
    add(e.to, 'C2');
    if (!x.creatorTx) x.creatorTx = e.tx;
  }

  for (const g of groupFacts) { g.members.forEach((m) => { add(m, g.rule); }); for (let i = 1; i < g.members.length; i++) union(g.members[0], g.members[i]); }
  const creatorLinked = Array.from(info.values()).filter((x) => x.rules.includes('C1') || x.rules.includes('C2')).map((x) => x.address);
  for (let i = 1; i < creatorLinked.length; i++) union(creatorLinked[0], creatorLinked[i]);

  const comps = new Map<string, WalletInfo[]>();
  for (const x of info.values()) {
    if (!x.rules.some((r) => r !== 'B3' && r !== 'B4')) continue; // B3/B4 never flag on their own
    const r = find(x.address);
    const l = comps.get(r) ?? []; l.push(x); comps.set(r, l);
  }

  const clusters: DetectedCluster[] = [];
  for (const wallets of comps.values()) {
    wallets.sort((a, b) => (a.firstBuyBlock ?? Infinity) - (b.firstBuyBlock ?? Infinity) || a.address.localeCompare(b.address));
    const rules = new Set<RuleId>();
    wallets.forEach((x) => x.rules.forEach((r) => { if (r !== 'B4') rules.add(r); }));
    // B4 at cluster level: the wallet itself, or at least half of a group
    const fresh = wallets.filter((x) => x.rules.includes('B4')).length;
    if (fresh > 0 && fresh * 2 >= wallets.length) rules.add('B4');
    // B3: similar first-buy size across a group
    const sizes = wallets.map((x) => x.firstBuyEth).filter((v) => v > 0).sort((a, b) => a - b);
    if (sizes.length >= 2) {
      const med = sizes[Math.floor(sizes.length / 2)];
      if (med > 0 && sizes.every((v) => Math.abs(v - med) <= med * XRAY.similarSizeTolerance)) rules.add('B3');
    }
    const ruleList = Array.from(rules);
    const type: ClusterType = rules.has('C1') || rules.has('C2') ? 'creator' : (rules.has('B1') || rules.has('B2')) && wallets.length >= 2 ? 'bundle' : 'sniper';
    const facts = groupFacts.filter((g) => g.members.some((m) => wallets.some((x) => x.address === m)));
    const id = `${type}:${wallets.map((x) => x.address).sort()[0].slice(2, 12)}`;
    clusters.push({ id, type, wallets, rules: ruleList, confidence: confidenceOf(ruleList), reason: reasonFor(type, wallets, ruleList, facts, t0) });
  }
  clusters.sort((a, b) => b.confidence - a.confidence || b.wallets.length - a.wallets.length);
  return { clusters, pending };
}

function reasonFor(type: ClusterType, wallets: WalletInfo[], rules: RuleId[], facts: { rule: RuleId; members: string[]; detail: { block?: number; tx?: string; gapSec?: number } }[], t0: number) {
  const n = wallets.length, many = n > 1;
  const subj = many ? `These ${n} wallets` : 'This wallet';
  const firstRel = Math.min(...wallets.map((x) => (x.firstBuyBlock ?? t0) - t0));
  const parts: string[] = [];
  const b2 = facts.find((f) => f.rule === 'B2');
  const b1tx = facts.find((f) => f.rule === 'B1' && f.detail.tx && f.members.length >= 2);
  const b1 = facts.find((f) => f.rule === 'B1' && !f.detail.tx);
  if (rules.includes('C1')) parts.push(`${subj} ${many ? 'were' : 'was'} funded by the token's creator before buying.`);
  if (rules.includes('C2')) parts.push(`${subj} received tokens from the creator's wallet.`);
  if (b2) parts.push(`${subj} ${many ? 'were' : 'was'} funded by the same address ${minutesPhrase(b2.detail.gapSec ?? 0)} before buying ${whenPhrase(firstRel)}.`);
  if (b1tx) parts.push(`${subj} bought in one transaction ${whenPhrase((b1tx.detail.block ?? t0) - t0)}.`);
  else if (b1) parts.push(`${subj} bought in the same block (${whenPhrase((b1.detail.block ?? t0) - t0).replace(/^in /, '')}).`);
  if (!parts.length) {
    if (rules.includes('S1')) parts.push(`${subj} bought in the same block trading opened.`);
    else if (rules.includes('S2')) parts.push(`${subj} bought ${whenPhrase(firstRel)}, within seconds of trading opening.`);
    else if (rules.includes('S3')) parts.push(`${subj} paid the anti-sniper tax.`);
  } else if (rules.includes('S1') || rules.includes('S2')) parts.push(firstRel === 0 ? 'They bought in the opening block.' : 'They bought within seconds of trading opening.');
  if (rules.includes('S3') && parts.length && !parts[0].includes('anti-sniper')) parts.push('The anti-sniper tax was charged.');
  if (rules.includes('B3')) parts.push('Their buys were about the same size.');
  if (rules.includes('B4')) parts.push(many ? 'Most of the wallets were brand new.' : 'The wallet was brand new.');
  void type;
  return parts.slice(0, 3).join(' ');
}

// ---------- state ----------
export interface Flow { received: number; sold: number; held: number; sold1h: number; sold24h: number; lastSellTx: string | null }
export interface ClusterState { bought: number; held: number; sold: number; heldPct: number; soldPct: number; status: Status; dumping: boolean; sold1hPct: number; sold24hPct: number; lastSellTx: string | null }

export function clusterState(wallets: string[], flows: Record<string, Flow>, supply: number): ClusterState {
  let bought = 0, held = 0, sold = 0, s1 = 0, s24 = 0, lastSellTx: string | null = null;
  for (const a of wallets) {
    const f = flows[a];
    if (!f) continue;
    bought += f.received; held += f.held; sold += f.sold; s1 += f.sold1h; s24 += f.sold24h;
    if (f.lastSellTx) lastSellTx = f.lastSellTx;
  }
  bought = Math.max(bought, held + sold);
  const soldPct = bought > 0 ? Math.min(100, (sold / bought) * 100) : 0;
  const status: Status = bought > 0 && held < (bought * XRAY.exitedHeldPct) / 100 ? 'exited'
    : soldPct < XRAY.trimmingPct ? 'holding' : soldPct <= XRAY.mostlySoldPct ? 'trimming' : 'mostly_sold';
  const sold1hPct = held + s1 > 0 ? (s1 / (held + s1)) * 100 : 0;
  const sold24hPct = held + s24 > 0 ? (s24 / (held + s24)) * 100 : 0;
  return {
    bought, held, sold, heldPct: supply > 0 ? (held / supply) * 100 : 0, soldPct, status,
    dumping: (s1 > 0 && sold1hPct >= XRAY.dump1hPct) || (s24 > 0 && sold24hPct >= XRAY.dump24hPct), sold1hPct, sold24hPct, lastSellTx,
  };
}

// ---------- verdict ----------
export const fmtPct = (p: number) => (p > 0 && p < 0.1 ? '<0.1' : p.toFixed(1));
export interface VerdictCluster { type: ClusterType; confidence: number; heldPct: number; status: Status }
const DOWN: Record<string, Level> = { heavy: 'some', some: 'clean' };

export function verdict(clusters: VerdictCluster[], partial: boolean): { level: Level; flaggedPct: number; sentence: string; exited: boolean } {
  const counted = clusters.filter((c) => c.confidence >= 2);
  const flaggedPct = counted.reduce((s, c) => s + c.heldPct, 0);
  const creatorPct = counted.filter((c) => c.type === 'creator').reduce((s, c) => s + c.heldPct, 0);
  const maxCluster = counted.reduce((m, c) => Math.max(m, c.heldPct), 0);
  let level: Level = flaggedPct > XRAY.heavyMinPct || maxCluster > XRAY.clusterHeavyPct || creatorPct > XRAY.creatorHeavyPct ? 'heavy'
    : flaggedPct >= XRAY.cleanMaxPct || maxCluster >= XRAY.clusterSomePct ? 'some' : 'clean';
  const exited = counted.length > 0 && counted.every((c) => c.status === 'exited');
  if (exited && DOWN[level]) level = DOWN[level];
  let sentence = level === 'heavy' ? `Heavy bundling flagged. Linked wallets hold ${fmtPct(flaggedPct)}% of supply.`
    : level === 'some' ? `Some early buyers flagged. They hold ${fmtPct(flaggedPct)}% of supply now.`
    : counted.length ? 'Early buyers were flagged, but they hold little of the supply now.' : 'No snipers or bundles flagged. Early buying looks organic.';
  if (exited) sentence = `${sentence.replace(/\.$/, '')}, but they have mostly sold out.`;
  if (partial && level === 'clean') return { level: 'partial', flaggedPct, sentence: 'Partial scan: some funding checks are still pending, so this is not a final result.', exited };
  return { level, flaggedPct, sentence, exited };
}

// ---------- alerts (pure) ----------
export interface AlertCluster { id: string; type: ClusterType; confidence: number; walletCount: number; sold1hPct: number; sold24hPct: number; lastSellTx: string | null }
export interface AlertRowOut { type: 'xray_dump' | 'xray_new_cluster' | 'xray_level_change'; message: string; dedupeKey: string; txHash?: string }
const LEVEL_NAME: Record<string, string> = { clean: 'Clean', some: 'Some early buyers', heavy: 'Heavy bundling', partial: 'Partial scan' };
const TYPE_NAME: Record<ClusterType, string> = { sniper: 'sniper', bundle: 'bundle', creator: 'creator-linked group' };

/** Alerts for one scan. Dedupe keys allow at most one alert per cluster per 6h bucket. */
export function xrayAlerts(a: {
  launch: string; symbol: string; now: number; prevLevel: Level | null; level: Level;
  knownClusterIds: string[]; clusters: AlertCluster[]; frozenBefore: boolean;
}): AlertRowOut[] {
  const out: AlertRowOut[] = [];
  const bucket = Math.floor(a.now / XRAY.alertBucketMs);
  const known = new Set(a.knownClusterIds);
  for (const c of a.clusters) {
    if (c.confidence < 2) continue;
    const hour = c.sold1hPct >= XRAY.dump1hPct, day = c.sold24hPct >= XRAY.dump24hPct;
    if (hour || day) {
      const pct = hour ? c.sold1hPct : c.sold24hPct;
      out.push({
        type: 'xray_dump',
        message: `Flagged early wallets sold ${fmtPct(pct)}% of their $${a.symbol} in the last ${hour ? 'hour' : '24 hours'}.`,
        dedupeKey: `${a.launch}:xray:dump:${c.id}:${bucket}`,
        ...(c.lastSellTx ? { txHash: c.lastSellTx } : {}),
      });
    }
    if (a.frozenBefore && !known.has(c.id)) {
      out.push({
        type: 'xray_new_cluster',
        message: `PolyCTO flagged a new ${TYPE_NAME[c.type]} (${c.walletCount} wallet${c.walletCount === 1 ? '' : 's'}).`,
        dedupeKey: `${a.launch}:xray:new:${c.id}:${bucket}`,
      });
    }
  }
  const real = (l: Level | null) => l === 'clean' || l === 'some' || l === 'heavy';
  if (real(a.prevLevel) && real(a.level) && a.prevLevel !== a.level) {
    out.push({
      type: 'xray_level_change',
      message: `Launch fairness changed from ${LEVEL_NAME[a.prevLevel!]} to ${LEVEL_NAME[a.level]}.`,
      dedupeKey: `${a.launch}:xray:level:${a.level}:${bucket}`,
    });
  }
  return out;
}
