// Server-only: the fund-list, kind-check, and leaderboard reads.
//
// Round 4: the /funds lists, the Terminal leaderboard NAVs, and the
// detail-page kind check still read the chain directly from the browser.
// On a first load they all fired at once into the official RPC and it
// rejected/timed them out often enough that the Polyfund page failed its
// first visit (~35s of retries, then "Could not load this tokenized fund
// right now" via the switch falling through to the legacy page) and the
// /funds lists sat on "Loading tokenized funds…" for 20+s. The same
// pattern as the Terminal activity fix (round 2) and the detail fix
// (round 3): the heavy reads run once here, on the server, behind
// /api/funds/list and /api/fund/kind (cached 30s), and the browser makes
// one cheap request each. (The leaderboard NAV read lives in
// /api/terminal/leaderboard itself — it takes the vault addresses as a
// parameter because the Terminal already has the lists.)
//
// The read logic is copied from the client hooks (use-phase3.ts
// readSummary, use-funds.ts readFund/listFunds, use-terminal.ts NAV
// multicall) — the server cannot import those 'use client' files. The
// wire shapes live in list-wire.ts; bigints travel as decimal strings.
import type { PublicClient, Abi } from 'viem';
import { parseEventLogs } from 'viem';
import { publicClient } from '@/lib/agents/tools';
import { FundFactoryPhase3ABI, FundNFTPhase3ABI, FundVaultPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { FundFactoryABI, FundNFTABI, FundVaultABI } from '@/lib/contracts/fund-abi';
import { FundAllowlistABI } from '@/lib/contracts/fund-phase6-abi';
import { FundPhase4ABI } from '@/lib/contracts/fund-phase4-abi';
import { FUND_ALLOWLIST, FUND_FACTORY_PHASE3, PHASE3_DEPLOY_BLOCK, PHASE3_LOG_CHUNK } from '@/lib/fund/phase3';
import { FUND_FACTORY_V2 } from '@/lib/fund/phase6';
import { FUND_FACTORY_V3 } from '@/lib/fund/phase7';
import { FUND_PHASE4, PHASE4_DEPLOY_BLOCK } from '@/lib/fund/phase4';
import { getFundInvestFactoryAddress } from '@/lib/fund/address';
import { fundStatus } from '@/lib/fund/model';
import type { AllowlistWire, FundsListWire, FundSummaryWire, LedgerWire, NavLogWire, NavPointWire, OffersWire, OfferWire, Phase3SummaryWire, V3FundSummaryWire, FundKind } from '@/lib/fund/list-wire';
import type { AllowlistToken } from '@/lib/fund/use-allowlist';

type Addr = `0x${string}`;
type Row = { status: string; result?: unknown };
const pick = <T,>(row: Row | undefined, fallback: T): T =>
  row?.status === 'success' && row.result !== undefined ? (row.result as T) : fallback;
const ZERO = '0x0000000000000000000000000000000000000000';

export type { FundKind } from '@/lib/fund/list-wire';

const client = publicClient as PublicClient;

/**
 * Which page a fund address belongs to: one multicall across the three
 * factories. 'legacy' means none of them claims it (the old Phase 2 page).
 * The detail-page switch used to run these three checks from the browser;
 * when they all errored it fell through to the legacy page, which can never
 * load a V3 fund — that was the first-load failure.
 */
export async function readFundKind(address: Addr): Promise<FundKind> {
  const res = await client.multicall({
    allowFailure: true,
    contracts: [
      { address: FUND_FACTORY_PHASE3, abi: FundFactoryPhase3ABI, functionName: 'isFund', args: [address] },
      { address: FUND_FACTORY_V2, abi: FundFactoryPhase3ABI, functionName: 'isFund', args: [address] },
      { address: FUND_FACTORY_V3, abi: FundFactoryPhase3ABI, functionName: 'isFund', args: [address] },
    ],
  });
  if (pick<boolean>(res[0], false)) return 'phase3';
  if (pick<boolean>(res[1], false)) return 'v2';
  if (pick<boolean>(res[2], false)) return 'v3';
  return 'legacy';
}

const NFT_LIST = ['name', 'symbol', 'imageUri', 'manager', 'vault', 'mintPrice', 'maxSupply', 'totalMinted', 'publicOpen'] as const;
const VAULT_LIST = ['raised', 'raiseCap', 'status', 'templateId'] as const;

async function readSummaryServer(address: Addr, index: number): Promise<Phase3SummaryWire | null> {
  const n = await client.multicall({ allowFailure: true, contracts: NFT_LIST.map((functionName) => ({ address, abi: FundNFTPhase3ABI, functionName })) });
  const vault = pick<Addr | undefined>(n[4], undefined);
  const manager = pick<Addr | undefined>(n[3], undefined);
  if (!vault || !manager || vault === ZERO) return null;
  const v = await client.multicall({ allowFailure: true, contracts: VAULT_LIST.map((functionName) => ({ address: vault, abi: FundVaultPhase3ABI, functionName })) });
  return {
    address,
    index,
    name: pick(n[0], '') || 'Tokenized Fund',
    symbol: pick(n[1], ''),
    imageUri: pick(n[2], ''),
    manager,
    vault,
    mintPrice: pick(n[5], 0n).toString(),
    maxSupply: pick(n[6], 0n).toString(),
    totalMinted: pick(n[7], 0n).toString(),
    publicOpen: pick(n[8], false),
    raised: pick(v[0], 0n).toString(),
    raiseCap: pick(v[1], 0n).toString(),
    status: Number(pick(v[2], 0)),
    templateId: Number(pick(v[3], 0n)),
  };
}

async function listFactoryFunds(factory: Addr, withDeadline: false): Promise<Phase3SummaryWire[]>;
async function listFactoryFunds(factory: Addr, withDeadline: true): Promise<V3FundSummaryWire[]>;
async function listFactoryFunds(factory: Addr, withDeadline: boolean): Promise<Phase3SummaryWire[] | V3FundSummaryWire[]> {
  const count = Number(await client.readContract({ address: factory, abi: FundFactoryPhase3ABI, functionName: 'allFundsLength' }));
  if (!count) return [];
  const addrs = await client.multicall({
    allowFailure: true,
    contracts: Array.from({ length: Math.min(count, 200) }, (_, i) => ({ address: factory, abi: FundFactoryPhase3ABI, functionName: 'allFunds' as const, args: [BigInt(i)] as const })),
  });
  const rows = await Promise.all(addrs.map((r, i) => (r.status === 'success' ? readSummaryServer(r.result as Addr, i) : Promise.resolve(null))));
  const list = rows.filter((r): r is Phase3SummaryWire => r !== null);
  if (!withDeadline) return list.reverse();
  const deadlines = list.length
    ? await client.multicall({ allowFailure: true, contracts: list.map((f) => ({ address: f.vault as Addr, abi: FundVaultPhase3ABI, functionName: 'raiseDeadline' as const })) })
    : [];
  return list.map((f, i) => ({ ...f, raiseDeadline: Number(pick(deadlines[i], 0n)) })).reverse();
}

const LEGACY_NFT_FIELDS = [
  'name', 'symbol', 'imageUri', 'manager', 'vault', 'mintPrice', 'maxSupply',
  'totalMinted', 'managerMinted', 'publicOpen', 'entryFeeBps', 'skinRequired', 'minSkinBps',
] as const;
const LEGACY_VAULT_FIELDS = ['raiseCap', 'raised', 'status', 'raiseDeadline'] as const;

async function readLegacyFundServer(address: Addr, index: number): Promise<FundSummaryWire | null> {
  const nftRes = await client.multicall({ allowFailure: true, contracts: LEGACY_NFT_FIELDS.map((functionName) => ({ address, abi: FundNFTABI, functionName })) });
  const manager = pick<Addr | undefined>(nftRes[3], undefined);
  const vault = pick<Addr | undefined>(nftRes[4], undefined);
  if (!manager || !vault || vault === ZERO) return null;
  const vaultRes = await client.multicall({ allowFailure: true, contracts: LEGACY_VAULT_FIELDS.map((functionName) => ({ address: vault, abi: FundVaultABI, functionName })) });
  const publicOpen = pick(nftRes[9], false);
  const vaultStatus = Number(pick(vaultRes[2], 0));
  return {
    address,
    index,
    name: pick(nftRes[0], '') || 'Fund',
    symbol: pick(nftRes[1], ''),
    imageUri: pick(nftRes[2], ''),
    manager,
    vault,
    mintPrice: pick(nftRes[5], 0n).toString(),
    maxSupply: pick(nftRes[6], 0n).toString(),
    totalMinted: pick(nftRes[7], 0n).toString(),
    managerMinted: pick(nftRes[8], 0n).toString(),
    publicOpen,
    entryFeeBps: Number(pick(nftRes[10], 0n)),
    skinRequired: pick(nftRes[11], 0n).toString(),
    minSkinBps: Number(pick(nftRes[12], 0n)),
    raiseCap: pick(vaultRes[0], 0n).toString(),
    raised: pick(vaultRes[1], 0n).toString(),
    vaultStatus,
    raiseDeadline: Number(pick(vaultRes[3], 0n)),
    status: fundStatus(vaultStatus, publicOpen),
    balance: '0',
    generation: 2,
  };
}

async function listLegacyFunds(): Promise<FundSummaryWire[]> {
  const factory = getFundInvestFactoryAddress();
  if (!factory) return [];
  const length = await client.readContract({ address: factory, abi: FundFactoryABI, functionName: 'allFundsLength' });
  const count = Number(length);
  if (!Number.isFinite(count) || count <= 0) return [];
  const addrRes = await client.multicall({
    allowFailure: true,
    contracts: Array.from({ length: count }, (_, index) => ({ address: factory, abi: FundFactoryABI, functionName: 'allFunds' as const, args: [BigInt(index)] as const })),
  });
  const found: { address: Addr; index: number }[] = [];
  addrRes.forEach((row, index) => {
    if (row.status === 'success' && typeof row.result === 'string') found.push({ address: row.result as Addr, index });
  });
  const funds = await Promise.all(found.map((item) => readLegacyFundServer(item.address, item.index)));
  return funds.filter((f): f is FundSummaryWire => f !== null);
}

/** All four fund lists in one call (the /funds page's four sections). */
export async function readFundsList(): Promise<FundsListWire> {
  const [phase3, v2, v3, legacy] = await Promise.all([
    listFactoryFunds(FUND_FACTORY_PHASE3, false),
    listFactoryFunds(FUND_FACTORY_V2, false),
    listFactoryFunds(FUND_FACTORY_V3, true),
    listLegacyFunds(),
  ]);
  return { phase3, v2, v3, legacy };
}

// ---------- Round 5: detail-page secondary reads ----------
//
// The detail page's first load was fixed in rounds 3–4, but its secondary
// reads still went straight from the browser into the first-load storm and
// failed the same way: the value-history log scan, the fund ledger, the
// allowlist menu, and the Phase 4 offers list. The read logic below is
// copied from the client hooks (use-phase3.ts readNavLog, use-fund-ledger.ts
// readLedger, use-allowlist.ts readAllowlist, use-phase4.ts useOffers) —
// the server cannot import those 'use client' files. The routes are
// /api/fund/nav-log, /api/fund/ledger, /api/funds/allowlist and
// /api/fund/offers, same cache rules as the round-4 routes.

async function chunkedLogsServer<T>(fetch: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const head = await client.getBlockNumber();
  const out: T[] = [];
  for (let from = PHASE3_DEPLOY_BLOCK; from <= head; from += PHASE3_LOG_CHUNK) {
    const to = from + PHASE3_LOG_CHUNK - 1n > head ? head : from + PHASE3_LOG_CHUNK - 1n;
    out.push(...(await fetch(from, to)));
  }
  return out;
}

/** NavTape points for a vault, oldest first (max 300). Empty for a fund that has never recorded a value. */
export async function readNavLogServer(vault: Addr): Promise<NavLogWire> {
  const logs = await chunkedLogsServer((fromBlock, toBlock) =>
    client.getContractEvents({ address: vault, abi: FundVaultPhase3ABI, eventName: 'NavTape', fromBlock, toBlock }));
  const log: NavPointWire[] = logs
    .map((l) => {
      const a = l.args as { timestamp?: bigint; nav?: bigint; navPerNft?: bigint; hwmPerNft?: bigint; drawdownBps?: bigint };
      return {
        timestamp: Number(a.timestamp ?? 0n),
        nav: (a.nav ?? 0n).toString(),
        navPerNft: (a.navPerNft ?? 0n).toString(),
        hwmPerNft: (a.hwmPerNft ?? 0n).toString(),
        drawdownBps: Number(a.drawdownBps ?? 0n),
        tx: l.transactionHash ?? '',
      };
    })
    .sort((x, y) => x.timestamp - y.timestamp)
    .slice(-300);
  return { log, updatedAt: Date.now() };
}

type LedgerLog = { args?: unknown; blockNumber: bigint | null; logIndex: number | null; transactionHash: string | null };
const ledgerOrder = (a: LedgerLog, b: LedgerLog) =>
  (a.blockNumber === b.blockNumber ? (a.logIndex ?? 0) - (b.logIndex ?? 0) : (a.blockNumber ?? 0n) < (b.blockNumber ?? 0n) ? -1 : 1);

/** Holder count, trade blotter, distributions and fee events, from the fund's logs. */
export async function readLedgerServer(nft: Addr, vault: Addr): Promise<LedgerWire> {
  const [transfers, vaultLogs] = await Promise.all([
    chunkedLogsServer((fromBlock, toBlock) => client.getContractEvents({ address: nft, abi: FundNFTPhase3ABI, eventName: 'Transfer', fromBlock, toBlock })),
    // Plain address-only log read, decoded locally: some RPCs reject the long topic OR-list of an all-events filter.
    chunkedLogsServer(async (fromBlock, toBlock) => parseEventLogs({ abi: FundVaultPhase3ABI, logs: await client.getLogs({ address: vault, fromBlock, toBlock }), strict: false })),
  ]);
  const owner = new Map<string, string>();
  for (const l of (transfers as LedgerLog[]).sort(ledgerOrder)) {
    const a = l.args as { to?: string; tokenId?: bigint };
    if (a.tokenId === undefined || !a.to) continue;
    owner.set(a.tokenId.toString(), a.to.toLowerCase());
  }
  const holders = new Set(Array.from(owner.values()).filter((o) => o !== ZERO)).size;
  const trades: LedgerWire['trades'] = [];
  const distributions: LedgerWire['distributions'] = [];
  const fees: LedgerWire['fees'] = [];
  let brakeEvents = 0;
  for (const raw of (vaultLogs as (LedgerLog & { eventName?: string })[]).sort(ledgerOrder)) {
    const a = (raw.args ?? {}) as Record<string, unknown>;
    const block = (raw.blockNumber ?? 0n).toString();
    const tx = raw.transactionHash ?? '';
    if (raw.eventName === 'Trade') trades.push({ asset: a.asset as Addr, side: Number(a.side ?? 0) === 0 ? 'Buy' : 'Sell', size: ((a.size as bigint) ?? 0n).toString(), price: ((a.price as bigint) ?? 0n).toString(), navAfter: ((a.navAfter as bigint) ?? 0n).toString(), block, tx });
    else if (raw.eventName === 'Distributed') distributions.push({ roundId: Number(a.roundId ?? 0n), pot: ((a.pot as bigint) ?? 0n).toString(), perUnit: ((a.perUnit as bigint) ?? 0n).toString(), block, tx });
    else if (raw.eventName === 'PerformanceFeeAccrued') fees.push({ kind: 'Counted', amount: ((a.amount as bigint) ?? 0n).toString(), block, tx });
    else if (raw.eventName === 'PerformanceFeeWithdrawn') fees.push({ kind: 'Withdrawn', amount: ((a.amount as bigint) ?? 0n).toString(), block, tx });
    else if (raw.eventName === 'DrawdownBrake') brakeEvents += 1;
  }
  const feesWithdrawn = fees.filter((f) => f.kind === 'Withdrawn').reduce((s, f) => s + BigInt(f.amount), 0n);
  return {
    holders,
    trades: trades.reverse(),
    distributions: distributions.reverse(),
    fees: fees.reverse(),
    feesWithdrawn: feesWithdrawn.toString(),
    brakeEvents,
    updatedAt: Date.now(),
  };
}

const TokenMetaABI = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
] as const;

/** Tokens on the FundAllowlist contract: allowed now, plus asset proposals still in their public wait. */
export async function readAllowlistServer(): Promise<AllowlistWire> {
  const count = Number(await client.readContract({ address: FUND_ALLOWLIST, abi: FundAllowlistABI, functionName: 'proposalCount' }));
  const n = Math.min(Math.max(count, 0), 500);
  const ids = Array.from({ length: n + 1 }, (_, i) => BigInt(i));
  const rows = (await client.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: FUND_ALLOWLIST, abi: FundAllowlistABI, functionName: 'proposals' as const, args: [id] as const })) })) as Row[];
  const now = Math.floor(Date.now() / 1000);
  const seen = new Map<string, { address: Addr; waitingUntil: number }>();
  for (const r of rows) {
    if (r.status !== 'success') continue;
    const p = r.result as readonly [Addr, boolean, boolean, bigint, boolean, boolean];
    const [target, isRouter, allowed, readyAt, executed, canceled] = p;
    if (!target || target === ZERO || isRouter) continue;
    const key = target.toLowerCase();
    const prev = seen.get(key) ?? { address: target, waitingUntil: 0 };
    if (!executed && !canceled && allowed) prev.waitingUntil = Math.max(prev.waitingUntil, Number(readyAt));
    seen.set(key, prev);
  }
  const list = Array.from(seen.values());
  if (!list.length) return { tokens: [], updatedAt: Date.now() };
  const meta = (await client.multicall({
    allowFailure: true,
    contracts: list.flatMap((t) => [
      { address: FUND_ALLOWLIST, abi: FundAllowlistABI, functionName: 'assetAllowed' as const, args: [t.address] as const },
      { address: t.address, abi: TokenMetaABI, functionName: 'symbol' as const },
      { address: t.address, abi: TokenMetaABI, functionName: 'name' as const },
    ]),
  })) as Row[];
  const tokens: AllowlistToken[] = [];
  list.forEach((t, i) => {
    const allowedNow = meta[i * 3]?.status === 'success' && meta[i * 3].result === true;
    const symbol = meta[i * 3 + 1]?.status === 'success' ? String(meta[i * 3 + 1].result) : '';
    const name = meta[i * 3 + 2]?.status === 'success' ? String(meta[i * 3 + 2].result) : '';
    if (allowedNow) tokens.push({ address: t.address, symbol: symbol || t.address.slice(0, 8), name, status: 'approved', readyAt: 0 });
    else if (t.waitingUntil > 0) tokens.push({ address: t.address, symbol: symbol || t.address.slice(0, 8), name, status: 'waiting', readyAt: t.waitingUntil > now ? t.waitingUntil : now });
  });
  return { tokens, updatedAt: Date.now() };
}

/** Open/closed offers on one fund (Phase 4 BidPlaced events + per-bid status reads). */
export async function readOffersServer(nft: Addr): Promise<OffersWire> {
  if (!FUND_PHASE4) return { offers: [], updatedAt: Date.now() };
  const p4 = FUND_PHASE4;
  const P4 = FundPhase4ABI as Abi;
  const head = await client.getBlockNumber();
  const logs: { id: bigint; tokenId: bigint; bidder: Addr; amount: bigint; expiry: number }[] = [];
  for (let from = PHASE4_DEPLOY_BLOCK; from <= head; from += PHASE3_LOG_CHUNK) {
    const to = from + PHASE3_LOG_CHUNK - 1n > head ? head : from + PHASE3_LOG_CHUNK - 1n;
    const part = await client.getContractEvents({ address: p4, abi: FundPhase4ABI, eventName: 'BidPlaced', fromBlock: from, toBlock: to });
    for (const l of part) {
      const a = l.args as { id?: bigint; nft?: Addr; tokenId?: bigint; bidder?: Addr; amount?: bigint; expiry?: bigint };
      if (a.id === undefined || a.nft?.toLowerCase() !== nft.toLowerCase()) continue;
      logs.push({ id: a.id, tokenId: a.tokenId ?? 0n, bidder: a.bidder ?? ZERO, amount: a.amount ?? 0n, expiry: Number(a.expiry ?? 0n) });
    }
  }
  if (!logs.length) return { offers: [], updatedAt: Date.now() };
  const recent = logs.slice(-100);
  const st = await client.multicall({
    allowFailure: true,
    contracts: recent.flatMap((b) => [
      { address: p4, abi: P4, functionName: 'bidStatus', args: [b.id] },
      { address: nft, abi: FundNFTPhase3ABI, functionName: 'ownerOf', args: [b.tokenId] },
      { address: nft, abi: FundNFTPhase3ABI, functionName: 'getApproved', args: [b.tokenId] },
    ]),
  }) as Row[];
  const ok = (r: Row | undefined) => r?.status === 'success' && r.result !== undefined;
  const out: OfferWire[] = recent.map((b, i) => {
    const s = ok(st[i * 3]) ? (st[i * 3].result as readonly [boolean, boolean, boolean, bigint]) : [false, false, false, 0n] as const;
    const holder = ok(st[i * 3 + 1]) ? (st[i * 3 + 1].result as Addr) : null;
    const approvedTo = ok(st[i * 3 + 2]) ? (st[i * 3 + 2].result as Addr) : null;
    return { ...b, id: b.id.toString(), tokenId: b.tokenId.toString(), amount: b.amount.toString(), open: s[0], expired: s[1], withinNav: s[2], navPerShare: s[3].toString(), holder, approved: !!approvedTo && approvedTo.toLowerCase() === p4 };
  });
  // Operator approval also counts.
  const holders = Array.from(new Set(out.filter((o) => o.open && o.holder && !o.approved).map((o) => o.holder as Addr)));
  if (holders.length) {
    const ap = await client.multicall({
      allowFailure: true,
      contracts: holders.map((h) => ({ address: nft, abi: FundNFTPhase3ABI, functionName: 'isApprovedForAll', args: [h, p4] })),
    }) as Row[];
    const all = new Set(holders.filter((_, i) => ok(ap[i]) && ap[i].result === true).map((h) => h.toLowerCase()));
    out.forEach((o) => { if (o.holder && all.has(o.holder.toLowerCase())) o.approved = true; });
  }
  return { offers: out.reverse(), updatedAt: Date.now() };
}
