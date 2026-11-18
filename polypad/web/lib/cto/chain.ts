// Token CTO: server-side indexer + per-launch report built from on-chain data. Server only (uses the DB).
import { decodeEventLog, formatEther, getAddress, pad, toEventSelector, type Address, type Hex } from 'viem';
import type { TokenCTO } from '@prisma/client';
import { prisma } from '@/lib/db';
import { PolydashFactoryABI, PolydashLaunchABI, PolydashTokenABI } from '@/lib/contracts/abis';
import { withPromiseHealth } from '@/lib/promises/summary';
import { resolveLaunchAddress } from '@/lib/launches-core';
import { getExternalToken } from '@/lib/listed-tokens';
import { publicClient, cached, tryRead, isBurn, ZERO, DEAD, analyzeToken, securityScan, listPools, type SecurityReport, type TokenAnalysis } from '@/lib/agents/tools';

const LEGACY_FACTORY = getAddress('0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2');
export const FACTORY = getAddress(process.env.NEXT_PUBLIC_FACTORY_ADDRESS || '0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2');
/** Current factory plus the legacy one; launches from both are indexed. */
export const FACTORIES: Address[] = FACTORY.toLowerCase() === LEGACY_FACTORY.toLowerCase() ? [FACTORY] : [FACTORY, LEGACY_FACTORY];
/** Uniswap V4 hooks: current and legacy. */
const HOOKS = ['0x4d3066bBfF889023def912D2fDe36c44357fA0cC', '0x04990E6671C98e1B43034E52366Af11396d960CC'].map((a) => a.toLowerCase());
const isHook = (a: string) => HOOKS.includes(a);
const DEPLOY_BLOCK = 85405135;
const SYNC_CHUNK = 10_000;
const SYNC_MAX_CHUNKS = 60;
const MILESTONES = [25, 50, 75, 90];

const SEL = {
  created: toEventSelector('LaunchCreated(address,address,address,string,string,string,uint256,address)'),
  configured: toEventSelector('LaunchConfigured(address,uint256,uint256,uint256,uint256,uint256)'),
  bought: toEventSelector('Bought(address,uint256,uint256,uint256,uint256,uint256)'),
  sold: toEventSelector('Sold(address,uint256,uint256,uint256,uint256,uint256)'),
  graduated: toEventSelector('Graduated(address,uint256,uint256,uint256,bytes32,uint256)'),
  committed: toEventSelector('Committed(address,uint256)'),
  transfer: toEventSelector('Transfer(address,address,uint256)'),
};

type RawLog = { address: string; topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex; logIndex: Hex };
const hex = (n: number) => `0x${n.toString(16)}`;
const bn = (l: RawLog) => Number(BigInt(l.blockNumber));
const topicAddr = (t?: Hex) => (t ? (`0x${t.slice(26)}`.toLowerCase()) : ZERO);
const lc = (a: string) => a.toLowerCase();

/** eth_getLogs over one range; splits the range in half if the RPC rejects it (too many results). */
async function getLogsSplit(address: string | string[], topics: (Hex | Hex[] | null)[], from: number, to: number, depth = 0): Promise<RawLog[]> {
  try {
    const r = await publicClient.request({ method: 'eth_getLogs', params: [{ address, topics, fromBlock: hex(from), toBlock: hex(to) }] } as any);
    return (r as RawLog[]) ?? [];
  } catch (e) {
    if (depth >= 8 || to - from < 2000) throw e;
    const mid = Math.floor((from + to) / 2);
    const [a, b] = await Promise.all([getLogsSplit(address, topics, from, mid, depth + 1), getLogsSplit(address, topics, mid + 1, to, depth + 1)]);
    return [...a, ...b];
  }
}

/** Logs over a long range in chunks (the RPC caps a request at 10M blocks). */
export async function getLogsRange(address: string | string[], topics: (Hex | Hex[] | null)[], from: number, to: number, chunk = 9_000_000, parallel = 4): Promise<RawLog[]> {
  // The RPC limits OR-topic filters to 100k blocks, so long ranges query one event signature at a time, in parallel.
  if (Array.isArray(topics[0]) && to - from >= 100_000) {
    const parts = await Promise.all((topics[0] as Hex[]).map((sel) => getLogsRange(address, [sel, ...topics.slice(1)], from, to, chunk, parallel)));
    return parts.flat().sort((a, b) => bn(a) - bn(b) || Number(BigInt(a.logIndex)) - Number(BigInt(b.logIndex)));
  }
  const ranges: [number, number][] = [];
  for (let s = from; s <= to; s += chunk) ranges.push([s, Math.min(to, s + chunk - 1)]);
  const out: RawLog[] = [];
  for (let i = 0; i < ranges.length; i += parallel) {
    const part = await Promise.all(ranges.slice(i, i + parallel).map(([f, t]) => getLogsSplit(address, topics, f, t)));
    part.forEach((p) => out.push(...p));
  }
  return out.sort((a, b) => bn(a) - bn(b) || Number(BigInt(a.logIndex)) - Number(BigInt(b.logIndex)));
}

export const blockTime = (n: number) => cached(`blk:${n}`, async () => Number((await publicClient.getBlock({ blockNumber: BigInt(n) })).timestamp), 3_600_000);

async function blocksPerSecond(latest: number) {
  return cached('cto:bps', async () => {
    const span = 200_000;
    const [a, b] = await Promise.all([blockTime(latest), blockTime(latest - span)]);
    return a > b ? span / (a - b) : 1;
  }, 600_000);
}

/** First block with timestamp >= ts (binary search). */
async function blockAt(ts: number, lo: number, hi: number) {
  return cached(`cto:blockAt:${ts}:${lo}`, async () => {
    if ((await blockTime(lo)) >= ts) return lo;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await blockTime(mid)) >= ts) hi = mid; else lo = mid;
    }
    return hi;
  }, 86_400_000);
}

export async function addAlerts(rows: { launchAddress: string; type: string; message: string; dedupeKey: string; txHash?: string | null; createdAt?: Date }[]) {
  if (!rows.length) return;
  await prisma.cTOAlert.createMany({ data: rows.map((r) => ({ ...r, txHash: r.txHash ?? null })), skipDuplicates: true });
}

// ---------- TokenCTO rows ----------
const LAUNCH_READS = ['token', 'creator', 'launchTime', 'totalSupply', 'graduationThreshold'] as const;

/** Build or refresh a TokenCTO row from LaunchCreated/LaunchConfigured logs plus current contract state. */
async function upsertFromChain(launch: Address, logs?: RawLog[]): Promise<TokenCTO | null> {
  const key = lc(launch);
  let evs = logs?.filter((l) => topicAddr(l.topics[1]) === key);
  if (!evs || !evs.some((l) => l.topics[0] === SEL.created)) {
    const latest = Number(await publicClient.getBlockNumber());
    evs = await getLogsRange(FACTORIES, [[SEL.created, SEL.configured], pad(launch)], DEPLOY_BLOCK, latest);
  }
  const created = evs.find((l) => l.topics[0] === SEL.created);
  const configured = evs.find((l) => l.topics[0] === SEL.configured);
  const c = created ? (decodeEventLog({ abi: PolydashFactoryABI, data: created.data, topics: created.topics as any }).args as any) : null;
  const g = configured ? (decodeEventLog({ abi: PolydashFactoryABI, data: configured.data, topics: configured.topics as any }).args as any) : null;

  const res = await publicClient.multicall({ contracts: LAUNCH_READS.map((f) => ({ address: launch, abi: PolydashLaunchABI, functionName: f })) as any, allowFailure: true });
  const s: Record<string, any> = {};
  LAUNCH_READS.forEach((f, i) => { s[f] = res[i]?.status === 'success' ? res[i].result : undefined; });
  const token = (c?.token ?? s.token) as Address | undefined;
  const creator = (c?.creator ?? s.creator) as Address | undefined;
  if (!token || !creator) return null;
  let name = c?.name as string | undefined, symbol = c?.symbol as string | undefined, imageUri = c?.imageUri as string | undefined;
  if (!name || !symbol) {
    const t = await publicClient.multicall({ contracts: (['name', 'symbol', 'imageUri'] as const).map((f) => ({ address: token, abi: PolydashTokenABI, functionName: f })) as any, allowFailure: true });
    name = name || (t[0]?.result as string) || 'Unknown';
    symbol = symbol || (t[1]?.result as string) || '???';
    imageUri = imageUri ?? ((t[2]?.result as string) || '');
  }
  const createdBlock = created ? bn(created) : 0;
  const createdAt = createdBlock ? new Date((await blockTime(createdBlock)) * 1000) : new Date();
  const data = {
    tokenAddress: lc(token), creator: lc(creator), name: name!.slice(0, 100), symbol: symbol!.slice(0, 32), imageUri: (imageUri ?? '').slice(0, 500),
    agentName: `$${symbol!.slice(0, 32)} CTO`,
    launchTime: Number(s.launchTime ?? g?.launchTime ?? 0),
    totalSupply: String(s.totalSupply ?? g?.totalSupply ?? 0),
    graduationThreshold: String(s.graduationThreshold ?? g?.graduationThreshold ?? 0),
    createdBlock,
  };
  return prisma.tokenCTO.upsert({ where: { launchAddress: key }, create: { launchAddress: key, createdAt, ...data }, update: data });
}

/** Lazy fallback: return the row, creating it from on-chain reads if the launch is real but not indexed yet. */
export async function ensureCto(input: string): Promise<TokenCTO | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(input)) return null;
  const a = lc(input);
  const row = await prisma.tokenCTO.findFirst({ where: { OR: [{ launchAddress: a }, { tokenAddress: a }] } });
  if (row) return row;
  // Accept the launch contract or the token address, on any known factory.
  const ext = getExternalToken(a);
  // Strict: an inconclusive lookup (an RPC call failed) throws instead of
  // resolving null, so a flaky RPC reads as "report unavailable" (500) rather
  // than "launch not found" (404). Null then only means genuinely not a launch.
  const launch = await cached(`cto:resolve:${a}`, () => resolveLaunchAddress(publicClient as any, FACTORIES as `0x${string}`[], getAddress(input), true), 60_000)
    .catch((e) => { if (ext) return null; throw e; });
  if (!launch) {
    if (!ext) return null;
    const [ts, supply] = await Promise.all([
      blockTime(ext.createdBlock).catch(() => 0),
      cached(`cto:extSupply:${a}`, () => publicClient.readContract({ address: getAddress(ext.address), abi: PolydashTokenABI, functionName: 'totalSupply' }) as Promise<bigint>, 600_000).catch(() => 0n),
    ]);
    return externalCtoRow(ext, ts, String(supply));
  }
  const existing = await prisma.tokenCTO.findUnique({ where: { launchAddress: lc(launch) } });
  return existing ?? upsertFromChain(getAddress(launch));
}

/**
 * In-memory row for a listed (non-factory) token. Never written to TokenCTO, so the indexer, factory counts,
 * X-ray and Bevor loops never see it. Keyed by the token address (it has no launch contract).
 */
export function externalCtoRow(ext: NonNullable<ReturnType<typeof getExternalToken>>, createdTs = 0, totalSupply = '0'): TokenCTO {
  const a = lc(ext.address);
  return {
    launchAddress: a, tokenAddress: a, creator: lc(ext.creator), name: ext.name, symbol: ext.symbol, imageUri: ext.imageUri,
    agentName: `$${ext.symbol} CTO`, createdAt: new Date(createdTs * 1000), launchTime: 0, totalSupply, graduationThreshold: '0', createdBlock: ext.createdBlock,
  };
}

/** True for listed tokens served by an in-memory row (no launch contract). */
export const isExternalRow = (row: Pick<TokenCTO, 'launchAddress'>) => !!getExternalToken(row.launchAddress);

// ---------- indexer ----------
let running: Promise<SyncResult> | null = null;
export interface SyncResult { skipped: boolean; fromBlock?: number; toBlock?: number; latest?: number; upserted?: number; alerts?: number; launches?: number }

export function syncCto(force = false): Promise<SyncResult> {
  if (!running) running = runSync(force).finally(() => { running = null; });
  return running;
}

async function runSync(force: boolean): Promise<SyncResult> {
  const state = await prisma.syncState.findUnique({ where: { key: 'cto' } });
  if (!force && state && Date.now() - state.lastRunAt.getTime() < 60_000) return { skipped: true, toBlock: state.lastBlock };
  const latest = Number(await publicClient.getBlockNumber());
  const from = state ? state.lastBlock + 1 : Math.max(DEPLOY_BLOCK, latest - 50_000);
  await prisma.syncState.upsert({ where: { key: 'cto' }, create: { key: 'cto', lastBlock: from - 1, lastRunAt: new Date() }, update: { lastRunAt: new Date() } });
  const to = Math.min(latest, from + SYNC_CHUNK * SYNC_MAX_CHUNKS - 1);
  let upserted = 0;
  const alerts: Parameters<typeof addAlerts>[0] = [];

  if (from <= to) {
    // 1) factory events in 10k-block chunks
    const factoryLogs = await getLogsRange(FACTORIES, [[SEL.created, SEL.configured]], from, to, SYNC_CHUNK, 10);
    const launches = Array.from(new Set(factoryLogs.map((l) => topicAddr(l.topics[1]))));
    for (const a of launches) { if (await upsertFromChain(getAddress(a), factoryLogs).catch((e) => { console.error('cto upsert failed', a, e?.message); return null; })) upserted++; }

    // 2) Committed / Graduated on known launches
    const rows = await prisma.tokenCTO.findMany({ select: { launchAddress: true, symbol: true } });
    if (rows.length) {
      const sym = new Map(rows.map((r) => [r.launchAddress, r.symbol]));
      const logs = await getLogsRange(rows.map((r) => r.launchAddress), [[SEL.committed, SEL.graduated]], from, to, SYNC_CHUNK, 10);
      for (const l of logs) {
        const launch = lc(l.address);
        const when = new Date((await blockTime(bn(l)).catch(() => Math.floor(Date.now() / 1000))) * 1000);
        if (l.topics[0] === SEL.committed) {
          const amt = Number(formatEther(BigInt(`0x${l.data.slice(2, 66)}`)));
          alerts.push({ launchAddress: launch, type: 'commit', message: `New commitment of ${fmt(amt)} ETH.`, dedupeKey: `${launch}:commit:${l.transactionHash}:${Number(BigInt(l.logIndex))}`, txHash: l.transactionHash, createdAt: when });
        } else {
          const g = decodeEventLog({ abi: PolydashLaunchABI, data: l.data, topics: l.topics as any }).args as any;
          alerts.push({ launchAddress: launch, type: 'graduation', message: `$${sym.get(launch) ?? ''} graduated. ${fmt(Number(formatEther(g.ethAdded)))} ETH and ${fmt(Number(formatEther(g.tokensAdded)))} tokens added as Uniswap V4 liquidity.`, dedupeKey: `${launch}:graduated`, txHash: l.transactionHash, createdAt: when });
        }
      }
    }
  }

  // 3) completeness: any factory launch not indexed yet (e.g. created before the cursor started)
  try {
    const counts = await Promise.all(FACTORIES.map(async (f) => Number(await tryRead<bigint>(f, PolydashFactoryABI, 'allLaunchesLength') ?? 0)));
    const n = counts.reduce((s, x) => s + x, 0);
    const have = await prisma.tokenCTO.count();
    if (n > have) {
      const all: string[] = [];
      for (let fi = 0; fi < FACTORIES.length; fi++) {
        if (!counts[fi]) continue;
        const res = await publicClient.multicall({ contracts: Array.from({ length: counts[fi] }, (_, i) => ({ address: FACTORIES[fi], abi: PolydashFactoryABI, functionName: 'allLaunches', args: [BigInt(i)] })) as any, allowFailure: true });
        all.push(...res.filter((r) => r.status === 'success').map((r) => lc(r.result as string)));
      }
      const known = new Set((await prisma.tokenCTO.findMany({ select: { launchAddress: true } })).map((r) => r.launchAddress));
      for (const a of all.filter((x) => !known.has(x)).slice(0, 10)) if (await upsertFromChain(getAddress(a)).catch(() => null)) upserted++;
    }
  } catch (e: any) { console.error('cto enumeration failed', e?.message); }

  // 4) curve milestones for every known launch
  try {
    const rows = await prisma.tokenCTO.findMany({ select: { launchAddress: true, symbol: true } });
    if (rows.length) {
      const fields = ['realEthRaised', 'graduationThreshold', 'graduated'] as const;
      const res = await publicClient.multicall({ contracts: rows.flatMap((r) => fields.map((f) => ({ address: getAddress(r.launchAddress), abi: PolydashLaunchABI, functionName: f }))) as any, allowFailure: true });
      rows.forEach((r, i) => {
        const raised = res[i * 3]?.result as bigint | undefined, thr = res[i * 3 + 1]?.result as bigint | undefined, grad = res[i * 3 + 2]?.result as boolean | undefined;
        const pct = grad ? 100 : raised != null && thr ? Number((raised * BigInt(10000)) / thr) / 100 : 0;
        alerts.push(...milestoneAlerts(r.launchAddress, r.symbol, pct));
      });
    }
  } catch (e: any) { console.error('cto milestones failed', e?.message); }

  // 5) Promise Ledger: evaluate active promises (throttled per token; never marks broken on read errors)
  try {
    const { evaluateAllPromises } = await import('@/lib/promises/evaluate');
    await evaluateAllPromises();
  } catch (e: any) { console.error('promise evaluation failed', e?.message); }

  // 6) Bundle & Sniper X-ray: scan due launches (throttled per token; results cached in XrayResult)
  try {
    const { scanAllXray } = await import('@/lib/xray/scan');
    await scanAllXray();
  } catch (e: any) { console.error('xray scan failed', e?.message); }

  // 7) Bevor AI review: poll running audits, start a few new ones (results cached in BevorAudit)
  try {
    const { auditAllLaunches } = await import('@/lib/bevor/audit');
    await auditAllLaunches();
  } catch (e: any) { console.error('bevor audit failed', e?.message); }

  // 8) Build activity: refresh a few due launches (GitHub budget + explorer queue; cached in BuildActivity)
  try {
    const { refreshAllBuilds } = await import('@/lib/buildact/refresh');
    await refreshAllBuilds();
  } catch (e: any) { console.error('build refresh failed', e?.message); }

  await addAlerts(alerts);
  if (from <= to) await prisma.syncState.update({ where: { key: 'cto' }, data: { lastBlock: to } });
  return { skipped: false, fromBlock: from, toBlock: to, latest, upserted, alerts: alerts.length, launches: await prisma.tokenCTO.count() };
}

function milestoneAlerts(launch: string, symbol: string, pct: number) {
  return MILESTONES.filter((m) => pct >= m).map((m) => ({ launchAddress: launch, type: 'milestone', message: `$${symbol} reached ${m}% of its bonding curve.`, dedupeKey: `${launch}:curve:${m}` }));
}

export function fmt(n: number, max = 4) {
  if (!Number.isFinite(n)) return 'n/a';
  if (n !== 0 && Math.abs(n) < 0.0001) return n > 0 ? '<0.0001' : '>-0.0001';
  return n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : max });
}

export function utcDay(d = new Date()) { return d.toISOString().slice(0, 10); }

// ---------- report ----------
/** `earned` (when set) is the points actually scored, for graded items like Launch fairness. */
export interface HealthItem { key: string; label: string; points: number; ok: boolean; known: boolean; penalty?: number; earned?: number; na?: boolean; href?: string }
export interface HolderRow { address: string; balance: number; pct: number; tags: string[] }
export interface CtoReport {
  cto: { launchAddress: string; tokenAddress: string; creator: string; name: string; symbol: string; imageUri: string; agentName: string; createdAt: string; launchTime: number };
  generatedAt: number;
  /** Listed (non-factory) tokens add rawEarned / applicableMax / notApplicable (score rescaled from applicableMax). */
  health: { score: number; items: HealthItem[]; rawEarned?: number; applicableMax?: number; notApplicable?: string[] };
  graduation: {
    phase: number; graduated: boolean; ethRaised: number; threshold: number; curvePct: number; pace24h: number; etaHours: number | null;
    event: { ethAdded: number; tokensAdded: number; tokensBurned: number; poolId: string; timestamp: number; txHash: string } | null;
  };
  holders: {
    count: number; top: HolderRow[]; top10Pct: number; totalSupply: number;
    earlyBuyers: { address: string; boughtTokens: number; holdingPct: number }[]; launchBlock: number | null;
    flows24h: { address: string; net: number; tags: string[] }[]; transfers24h: number;
    whales: { from: string; to: string; fromTags: string[]; toTags: string[]; amount: number; pct: number; txHash: string; time: number }[];
  };
  security: SecurityReport | null;
  analysis: TokenAnalysis | null;
  stakingPools: { address: string; name: string | null; open: boolean }[];
}

const REPORT_TTL = 60_000;
const inflight = new Map<string, Promise<CtoReport>>();

/** Recompute a report and store it in the DB cache (one run per launch at a time). */
function refreshReport(row: TokenCTO): Promise<CtoReport> {
  const key = row.launchAddress;
  const running = inflight.get(key);
  if (running) return running;
  const p = computeReport(row)
    .then(async (r) => {
      const data = { report: r as any, generatedAt: new Date(r.generatedAt) };
      await prisma.cTOReportCache.upsert({ where: { launchAddress: key }, create: { launchAddress: key, ...data }, update: data })
        .catch((e) => console.error('cto report cache write failed', key, e?.message));
      return r;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Stale-while-revalidate: returns the last cached report immediately and refreshes it in the background when
 * older than 60s. With no cached report yet, waits up to `waitMs` for the first build and returns null if it is
 * still running (the build continues in the background).
 */
export async function getCachedReport(row: TokenCTO, waitMs = 4_000): Promise<{ report: CtoReport | null; refreshing: boolean }> {
  const hit = await prisma.cTOReportCache.findUnique({ where: { launchAddress: row.launchAddress } }).catch(() => null);
  if (hit) {
    const stale = Date.now() - hit.generatedAt.getTime() > REPORT_TTL;
    if (stale) refreshReport(row).catch((e) => console.error('cto report refresh failed', row.launchAddress, e?.message));
    return { report: await withPromiseHealth(hit.report as unknown as CtoReport), refreshing: stale };
  }
  const p = refreshReport(row);
  p.catch((e) => console.error('cto report build failed', row.launchAddress, e?.message));
  const report = await Promise.race([p.catch(() => null), new Promise<null>((res) => setTimeout(() => res(null), waitMs))]);
  return { report: report && (await withPromiseHealth(report)), refreshing: !report };
}

/** Full report: the cached one when present (refreshed in the background if stale), otherwise built now. */
export async function getReport(row: TokenCTO): Promise<CtoReport> {
  const { report } = await getCachedReport(row, 0);
  return report ?? withPromiseHealth(await refreshReport(row));
}

async function computeReport(row: TokenCTO): Promise<CtoReport> {
  const launch = getAddress(row.launchAddress);
  const token = getAddress(row.tokenAddress);
  const latest = Number(await publicClient.getBlockNumber());
  const [bps, nowTs] = await Promise.all([blocksPerSecond(latest), blockTime(latest)]);
  const dayAgoBlock = Math.max(0, latest - Math.round(86_400 * bps));
  const fromBlock = row.createdBlock || DEPLOY_BLOCK;

  // launch block lookup (binary search over block timestamps) runs alongside the log reads
  const findLaunchBlock = async (lt: number) => {
    if (lt <= 0) return null;
    const createdTs = row.createdBlock ? await blockTime(row.createdBlock) : 0;
    return lt <= createdTs ? row.createdBlock : lt > nowTs ? null : blockAt(lt, row.createdBlock || DEPLOY_BLOCK, latest);
  };
  const launchBlockHint = findLaunchBlock(row.launchTime).catch(() => null);

  const fields = ['phase', 'realEthRaised', 'graduationThreshold', 'graduated', 'totalSupply', 'launchTime'] as const;
  const [stateRes, transfers, launchLogs, security, analysis, pools] = await Promise.all([
    publicClient.multicall({ contracts: fields.map((f) => ({ address: launch, abi: PolydashLaunchABI, functionName: f })) as any, allowFailure: true }),
    getLogsRange(token, [SEL.transfer], fromBlock, latest),
    getLogsRange(launch, [[SEL.bought, SEL.sold, SEL.graduated]], fromBlock, latest),
    securityScan(token).catch(() => null),
    analyzeToken(token).catch(() => null),
    listPools().catch(() => []),
  ]);
  const st: Record<string, any> = {};
  fields.forEach((f, i) => { st[f] = stateRes[i]?.status === 'success' ? stateRes[i].result : undefined; });
  const supplyWei = (st.totalSupply as bigint | undefined) ?? BigInt(row.totalSupply || '0');
  const supply = Number(formatEther(supplyWei));
  const phase = Number(st.phase ?? 0);
  const graduated = Boolean(st.graduated) || phase === 4;
  const ethRaised = Number(formatEther((st.realEthRaised as bigint | undefined) ?? BigInt(0)));
  const threshold = Number(formatEther((st.graduationThreshold as bigint | undefined) ?? BigInt(row.graduationThreshold || '0')));
  const curvePct = graduated ? 100 : threshold > 0 ? Math.min(100, (ethRaised / threshold) * 100) : 0;
  const launchTime = Number(st.launchTime ?? row.launchTime ?? 0);

  // graduation event + the pool address (recipient of the liquidity transfer in that tx)
  const gLog = launchLogs.find((l) => l.topics[0] === SEL.graduated);
  let gradEvent: CtoReport['graduation']['event'] = null;
  let poolAddr: string | null = null;
  if (gLog) {
    const g = decodeEventLog({ abi: PolydashLaunchABI, data: gLog.data, topics: gLog.topics as any }).args as any;
    gradEvent = { ethAdded: Number(formatEther(g.ethAdded)), tokensAdded: Number(formatEther(g.tokensAdded)), tokensBurned: Number(formatEther(g.tokensBurned)), poolId: g.poolId, timestamp: Number(g.timestamp), txHash: gLog.transactionHash };
    const liq = transfers.find((t) => t.transactionHash === gLog.transactionHash && topicAddr(t.topics[1]) === lc(launch) && !isBurn(topicAddr(t.topics[2])));
    if (liq) poolAddr = topicAddr(liq.topics[2]);
  }

  const tagsOf = (a: string) => {
    const t: string[] = [];
    if (a === lc(launch)) t.push('Launch contract');
    if (poolAddr && a === poolAddr) t.push('Pool');
    if (isHook(a)) t.push('Pool hook');
    if (a === DEAD || a === ZERO) t.push('Dead');
    if (a === row.creator) t.push('Creator');
    return t;
  };
  const excluded = (a: string) => a === lc(launch) || a === poolAddr || isHook(a) || isBurn(a);

  // balances from the full transfer history
  const bal = new Map<string, bigint>();
  const net24 = new Map<string, bigint>();
  let transfers24h = 0;
  const whaleMin = supplyWei / BigInt(100);
  const whales: CtoReport['holders']['whales'] = [];
  for (const l of transfers) {
    const from = topicAddr(l.topics[1]), to = topicAddr(l.topics[2]);
    const v = BigInt(`0x${l.data.slice(2, 66) || '0'}`);
    bal.set(from, (bal.get(from) ?? BigInt(0)) - v);
    bal.set(to, (bal.get(to) ?? BigInt(0)) + v);
    if (bn(l) >= dayAgoBlock) {
      transfers24h++;
      if (from !== ZERO) net24.set(from, (net24.get(from) ?? BigInt(0)) - v);
      net24.set(to, (net24.get(to) ?? BigInt(0)) + v);
      if (whaleMin > BigInt(0) && v >= whaleMin && from !== ZERO) {
        whales.push({ from, to, fromTags: tagsOf(from), toTags: tagsOf(to), amount: Number(formatEther(v)), pct: supply ? (Number(formatEther(v)) / supply) * 100 : 0, txHash: l.transactionHash, time: nowTs - Math.round((latest - bn(l)) / bps) });
      }
    }
  }
  const pctOf = (v: bigint) => (supply ? (Number(formatEther(v)) / supply) * 100 : 0);
  const positive = Array.from(bal.entries()).filter(([a, v]) => a !== ZERO && v > BigInt(0)).sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
  const top = positive.slice(0, 10).map(([a, v]) => ({ address: a, balance: Number(formatEther(v)), pct: pctOf(v), tags: tagsOf(a) }));
  // label other contracts in the top list
  await Promise.all(top.filter((h) => h.tags.length === 0).map(async (h) => {
    const code = await publicClient.getCode({ address: getAddress(h.address) }).catch(() => undefined);
    if (code && code !== '0x') h.tags.push('Contract');
  }));
  const top10Pct = positive.filter(([a]) => !excluded(a)).slice(0, 10).reduce((s, [, v]) => s + pctOf(v), 0);
  const holderCount = positive.filter(([a]) => !isBurn(a)).length;

  // early buyers: bought within 50 blocks after launchTime
  let launchBlock: number | null = null;
  const buys = launchLogs.filter((l) => l.topics[0] === SEL.bought);
  if (launchTime > 0 && buys.length) {
    launchBlock = launchTime === row.launchTime ? await launchBlockHint : await findLaunchBlock(launchTime);
  }
  const early = new Map<string, bigint>();
  if (launchBlock != null) {
    for (const l of buys) {
      if (bn(l) > launchBlock + 50) break;
      if (bn(l) < launchBlock) continue;
      const buyer = topicAddr(l.topics[1]);
      early.set(buyer, (early.get(buyer) ?? BigInt(0)) + BigInt(`0x${l.data.slice(66, 130) || '0'}`));
    }
  }
  const earlyBuyers = Array.from(early.entries()).map(([a, v]) => ({ address: a, boughtTokens: Number(formatEther(v)), holdingPct: pctOf(bal.get(a) ?? BigInt(0)) }))
    .sort((a, b) => b.boughtTokens - a.boughtTokens).slice(0, 20);

  const flowEntries = Array.from(net24.entries()).filter(([, v]) => v !== BigInt(0)).map(([a, v]) => ({ address: a, net: Number(formatEther(v)), tags: tagsOf(a) }));
  const flows24h = [...flowEntries.filter((f) => f.net > 0).sort((a, b) => b.net - a.net).slice(0, 5), ...flowEntries.filter((f) => f.net < 0).sort((a, b) => a.net - b.net).slice(0, 5)];

  // curve pace over the last 24h (approximate change in ETH held by the curve)
  let pace = 0;
  for (const l of launchLogs) {
    if (bn(l) < dayAgoBlock || l.topics[0] === SEL.graduated) continue;
    const w = (i: number) => Number(formatEther(BigInt(`0x${l.data.slice(2 + 64 * i, 66 + 64 * i) || '0'}`)));
    if (l.topics[0] === SEL.bought) pace += w(0) - w(2) - w(3);
    else pace -= w(1) + w(2) + w(3);
  }
  const remaining = Math.max(0, threshold - ethRaised);
  const etaHours = !graduated && pace > 0 && remaining > 0 ? (remaining / pace) * 24 : null;

  const stakingPools = pools.filter((p) => p.version === 'v2' && p.stakeToken && lc(p.stakeToken) === lc(token))
    .map((p) => ({ address: lc(p.address), name: p.name, open: !p.ended && !p.full && p.isActive === true }));

  const highFlags = security ? security.flags.some((f) => f.severity === 'high') : true;
  // Weights match lib/promises/summary.ts BASE_POINTS (Promises and Launch fairness are added there).
  const items: HealthItem[] = [
    { key: 'verified', label: 'Source verified', points: 15, ok: !!security?.verified, known: !!security && !security.flags.some((f) => f.id === 'sourcify_unreachable') },
    { key: 'owner', label: 'Ownership renounced or no owner', points: 10, ok: !!analysis && (analysis.owner == null || analysis.renounced), known: !!analysis },
    { key: 'flags', label: 'No high-risk flags', points: 10, ok: !!security && !highFlags, known: !!security },
    { key: 'top10', label: 'Top-10 holders under 50% (excl. launch, pool, dead)', points: 15, ok: holderCount > 0 && top10Pct < 50, known: true },
    { key: 'curve', label: 'Curve progress or graduated', points: 10, ok: graduated || ethRaised > 0, known: true },
    { key: 'activity', label: 'Transfers in the last 24h', points: 10, ok: transfers24h > 0, known: true },
  ];
  const score = items.reduce((s, i) => s + (i.ok ? i.points : 0), 0);

  // alerts derived from this read
  const alerts: Parameters<typeof addAlerts>[0] = milestoneAlerts(row.launchAddress, row.symbol, curvePct);
  if (gradEvent) alerts.push({ launchAddress: row.launchAddress, type: 'graduation', message: `$${row.symbol} graduated. ${fmt(gradEvent.ethAdded)} ETH and ${fmt(gradEvent.tokensAdded)} tokens added as Uniswap V4 liquidity.`, dedupeKey: `${row.launchAddress}:graduated`, txHash: gradEvent.txHash, createdAt: new Date(gradEvent.timestamp * 1000) });
  for (const w of whales) alerts.push({ launchAddress: row.launchAddress, type: 'whale', message: `Whale move: ${fmt(w.amount, 0)} $${row.symbol} (${w.pct.toFixed(2)}% of supply) moved.`, dedupeKey: `${row.launchAddress}:whale:${w.txHash}:${w.from}:${w.to}`, txHash: w.txHash, createdAt: new Date(w.time * 1000) });
  for (const p of stakingPools) alerts.push({ launchAddress: row.launchAddress, type: 'staking', message: `New staking pool for $${row.symbol}: ${p.name || p.address}.`, dedupeKey: `${row.launchAddress}:pool:${p.address}` });
  await addAlerts(alerts).catch((e) => console.error('cto alerts failed', e?.message));

  return {
    cto: { launchAddress: row.launchAddress, tokenAddress: row.tokenAddress, creator: row.creator, name: row.name, symbol: row.symbol, imageUri: row.imageUri, agentName: row.agentName, createdAt: row.createdAt.toISOString(), launchTime },
    generatedAt: Date.now(),
    health: { score, items },
    graduation: { phase, graduated, ethRaised, threshold, curvePct, pace24h: pace, etaHours, event: gradEvent },
    holders: { count: holderCount, top, top10Pct, totalSupply: supply, earlyBuyers, launchBlock, flows24h, transfers24h, whales: whales.slice(-10).reverse() },
    security, analysis, stakingPools,
  };
}

/** Store today's snapshot on the first view of the day; return today's and yesterday's. */
export async function snapshotFor(row: TokenCTO, r: CtoReport) {
  const day = utcDay();
  const yesterday = utcDay(new Date(Date.now() - 86_400_000));
  const flags = (r.security?.flags ?? []).filter((f) => f.severity !== 'info').map((f) => f.id);
  const where = { launchAddress_day: { launchAddress: row.launchAddress, day } };
  const xr = await prisma.xrayResult.findUnique({ where: { launchAddress: row.launchAddress }, select: { level: true, stats: true } }).catch(() => null);
  const xs = (xr?.stats ?? {}) as { sniperPct?: number; bundleCount?: number };
  const xray = xr ? { xrayLevel: xr.level, xraySniperPct: xs.sniperPct ?? null, xrayBundles: xs.bundleCount ?? null } : {};
  // Concurrent first views can race on the unique (launchAddress, day) key; fall back to the stored row.
  const today = await prisma.cTOSnapshot.upsert({
    where,
    create: { launchAddress: row.launchAddress, day, holders: r.holders.count, top10Pct: r.holders.top10Pct, curvePct: r.graduation.curvePct, ethRaised: r.graduation.ethRaised, graduated: r.graduation.graduated, healthScore: r.health.score, flags, ...xray },
    update: {},
  }).catch(async (e) => {
    const existing = await prisma.cTOSnapshot.findUnique({ where });
    if (!existing) throw e;
    return existing;
  });
  // Today's X-ray fields follow the latest scan (same single-source rule as health).
  if (xr && (today.xrayLevel !== xray.xrayLevel || today.xraySniperPct !== xray.xraySniperPct || today.xrayBundles !== xray.xrayBundles)) {
    Object.assign(today, await prisma.cTOSnapshot.update({ where, data: xray }).catch(() => ({})));
  }
  // Health has one source of truth: the current report score (with Promise + X-ray factors). Today's row follows it,
  // so the report card, Health panel and share image always agree and yesterday's value is that day's final score.
  if (today.healthScore !== r.health.score) {
    await prisma.cTOSnapshot.update({ where, data: { healthScore: r.health.score } }).catch(() => null);
    today.healthScore = r.health.score;
  }
  const prev = await prisma.cTOSnapshot.findUnique({ where: { launchAddress_day: { launchAddress: row.launchAddress, day: yesterday } } });
  const strip = (s: typeof today | null) => s && { day: s.day, holders: s.holders, top10Pct: s.top10Pct, curvePct: s.curvePct, ethRaised: s.ethRaised, graduated: s.graduated, healthScore: s.healthScore, flags: s.flags, xrayLevel: s.xrayLevel, xraySniperPct: s.xraySniperPct, xrayBundles: s.xrayBundles };
  return { today: strip(today), yesterday: strip(prev) };
}
