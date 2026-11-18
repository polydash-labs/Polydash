// Promise Ledger evaluation runner: incremental log scans (<=10k-block chunks) from each promise's
// lastCheckedBlock, at most once a minute per token. Any read failure leaves every status unchanged.
import { decodeEventLog, getAddress, pad, parseAbi, parseAbiItem, toEventSelector, type Hex } from 'viem';
import { prisma } from '@/lib/db';
import { PolydashLaunchABI } from '@/lib/contracts/abis';
import { addAlerts, blockTime, getLogsRange } from '@/lib/cto/chain';
import { publicClient, listPoolAddresses, erc20ReadAbi, ZERO, DEAD } from '@/lib/agents/tools';
import { evaluatePromise, walletsOf, type EvalCtx, type EvalLogs, type EvalPromise } from './core';
import { COMMIT_VAULTS, KNOWN_ROUTERS, STAKING_V2_FACTORY } from './routers';
import { invalidatePromiseCounts } from './summary';
import type { PromiseParams, PromiseStatus } from './presets';

const CHUNK = 10_000;
const MAX_CHUNKS = 20;
const THROTTLE_MS = 60_000;

const SEL = {
  transfer: toEventSelector('Transfer(address,address,uint256)'),
  sold: toEventSelector('Sold(address,uint256,uint256,uint256,uint256,uint256)'),
  graduated: toEventSelector('Graduated(address,uint256,uint256,uint256,bytes32,uint256)'),
  payoutInit: toEventSelector('PayoutWalletChangeInitiated(address,address,uint256)'),
  payoutChanged: toEventSelector('PayoutWalletChanged(address,address)'),
  poolCreated: toEventSelector('PoolCreated(address,address,address,address,uint256,uint256,uint256,uint256)'),
};
const poolCreatedAbi = [parseAbiItem('event PoolCreated(address indexed pool, address indexed creator, address indexed stakeToken, address rewardToken, uint256 rewardAmount, uint256 startTime, uint256 endTime, uint256 claimFeeBps)')];
const launchReadAbi = parseAbi(['function graduated() view returns (bool)']);

const topicAddr = (t?: Hex) => (t ? `0x${t.slice(26)}`.toLowerCase() : ZERO);
const num = (h: Hex) => Number(BigInt(h));

const lastRun = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();

/** Evaluate every launch that has open promises (called from the CTO sync). */
export async function evaluateAllPromises() {
  const launches = await prisma.creatorPromise.findMany({ where: { status: { in: ['active', 'needs_review'] } }, select: { launchAddress: true }, distinct: ['launchAddress'] });
  for (const l of launches) await evaluateLaunchPromises(l.launchAddress).catch((e) => console.error('promise eval failed', l.launchAddress, e?.message));
}

export function evaluateLaunchPromises(launch: string, force = false): Promise<void> {
  const key = launch.toLowerCase();
  const running = inflight.get(key);
  if (running) return running;
  if (!force && Date.now() - (lastRun.get(key) ?? 0) < THROTTLE_MS) return Promise.resolve();
  lastRun.set(key, Date.now());
  const p = run(key).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function gradTimestamp(launch: string, createdBlock: number, latest: number): Promise<number | null> {
  const grad = await publicClient.readContract({ address: getAddress(launch), abi: launchReadAbi, functionName: 'graduated' });
  if (!grad) return null;
  const hit = await prisma.cTOReportCache.findUnique({ where: { launchAddress: launch }, select: { report: true } });
  const ts = (hit?.report as any)?.graduation?.event?.timestamp;
  if (typeof ts === 'number' && ts > 0) return ts;
  const logs = await getLogsRange(launch, [SEL.graduated], createdBlock || 85405135, latest);
  if (!logs.length) throw new Error('graduated but no Graduated log found');
  const g = decodeEventLog({ abi: PolydashLaunchABI, data: logs[0].data, topics: logs[0].topics as any }).args as any;
  return Number(g.timestamp);
}

async function run(launch: string) {
  const rows = await prisma.creatorPromise.findMany({ where: { launchAddress: launch, status: { in: ['active', 'needs_review'] } } });
  if (!rows.length) return;
  const cto = await prisma.tokenCTO.findUnique({ where: { launchAddress: launch } });
  if (!cto) return;
  const token = cto.tokenAddress.toLowerCase();

  const head = Number(await publicClient.getBlockNumber());
  const from = Math.min(...rows.map((r) => r.lastCheckedBlock)) + 1;
  const to = Math.min(head, from + CHUNK * MAX_CHUNKS - 1);
  if (from > to) return;

  const kinds = new Set(rows.map((r) => r.kind));
  const wallets = new Set<string>();
  for (const r of rows) walletsOf({ creator: r.creator, params: r.params as unknown as PromiseParams }).forEach((w) => wallets.add(w));
  const walletTopics = Array.from(wallets).map((w) => pad(w as Hex));
  const needTransfers = kinds.has('no_sell') || kinds.has('hold');
  const needPools = kinds.has('staking_live') || kinds.has('staking_rewards');

  // Every read below throws on failure, which aborts the whole run with no status change.
  const [transferLogs, soldLogs, payoutLogs, poolLogs, toTs, stakingPools, gradTs] = await Promise.all([
    needTransfers ? getLogsRange(token, [SEL.transfer, walletTopics], from, to, CHUNK, 5) : [],
    kinds.has('no_sell') ? getLogsRange(launch, [SEL.sold, walletTopics], from, to, CHUNK, 5) : [],
    kinds.has('payout_fixed') ? getLogsRange(launch, [[SEL.payoutInit, SEL.payoutChanged]], from, to, CHUNK, 5) : [],
    needPools ? getLogsRange(STAKING_V2_FACTORY, [SEL.poolCreated, null, walletTopics], from, to, CHUNK, 5) : [],
    blockTime(to),
    needTransfers ? listPoolAddresses() : Promise.resolve([]),
    kinds.has('staking_live') ? gradTimestamp(launch, cto.createdBlock, head) : Promise.resolve(null),
  ]);
  if (needTransfers && !stakingPools.length) throw new Error('staking pool list unavailable');

  const logs: EvalLogs = {
    transfers: transferLogs.map((l) => ({ from: topicAddr(l.topics[1]), to: topicAddr(l.topics[2]), value: BigInt(l.data === '0x' ? 0 : l.data), block: num(l.blockNumber), logIndex: num(l.logIndex), tx: l.transactionHash })),
    sells: soldLogs.map((l) => ({ seller: topicAddr(l.topics[1]), block: num(l.blockNumber), logIndex: num(l.logIndex), tx: l.transactionHash })),
    payouts: payoutLogs.map((l) => ({ kind: l.topics[0] === SEL.payoutChanged ? 'changed' as const : 'initiated' as const, newWallet: topicAddr(l.topics[2]), block: num(l.blockNumber), logIndex: num(l.logIndex), tx: l.transactionHash })),
    pools: poolLogs.map((l) => {
      const a = decodeEventLog({ abi: poolCreatedAbi, data: l.data, topics: l.topics as any }).args as any;
      return { pool: String(a.pool).toLowerCase(), creator: String(a.creator).toLowerCase(), stakeToken: String(a.stakeToken).toLowerCase(), rewardToken: String(a.rewardToken).toLowerCase(), rewardAmount: BigInt(a.rewardAmount), block: num(l.blockNumber), logIndex: num(l.logIndex), tx: l.transactionHash };
    }),
  };

  const exempt = new Set<string>([ZERO, DEAD, ...COMMIT_VAULTS, ...stakingPools.map((p) => p.address.toLowerCase()), ...logs.pools.map((p) => p.pool)]);
  const routers = new Set<string>([...KNOWN_ROUTERS, launch]);
  const codeCache = new Map<string, boolean>();
  const ctx: EvalCtx = {
    toBlock: to, toTs, symbol: cto.symbol, gradTs,
    isExempt: (a) => exempt.has(a),
    isRouter: (a) => routers.has(a),
    isContract: async (a) => {
      if (!codeCache.has(a)) { const code = await publicClient.getCode({ address: getAddress(a) }); codeCache.set(a, !!code && code !== '0x'); }
      return codeCache.get(a)!;
    },
    blockTs: (n) => blockTime(n),
    balanceAt: async (ws, block) => {
      const bals = await Promise.all(ws.map((w) => publicClient.readContract({ address: getAddress(token), abi: erc20ReadAbi, functionName: 'balanceOf', args: [getAddress(w)], blockNumber: BigInt(block) })));
      return bals.reduce((s, b) => s + (b as bigint), BigInt(0));
    },
  };

  // Evaluate everything first; write only if every promise evaluated without a read error.
  const results = [];
  for (const r of rows) {
    const p: EvalPromise = { id: r.id, kind: r.kind, params: r.params as unknown as PromiseParams, creator: r.creator, tokenAddress: r.tokenAddress, endsAt: r.endsAt, baselineBalance: r.baselineBalance, status: r.status as PromiseStatus, lastCheckedBlock: r.lastCheckedBlock, progress: r.progress };
    results.push({ r, out: await evaluatePromise(p, logs, ctx) });
  }

  let changed = false;
  const alerts: Parameters<typeof addAlerts>[0] = [];
  for (const { r, out } of results) {
    const statusChanged = out.status !== r.status;
    if (statusChanged) changed = true;
    // Guarded update: only rows still open (kept/broken are final).
    await prisma.creatorPromise.updateMany({
      where: { id: r.id, status: { in: ['active', 'needs_review'] } },
      data: {
        lastCheckedBlock: Math.max(r.lastCheckedBlock, to), progress: out.progress,
        ...(statusChanged ? { status: out.status, statusAt: new Date(), evidenceTx: out.evidenceTx, evidenceNote: out.evidenceNote } : {}),
      },
    });
    for (const a of out.alerts) alerts.push({ launchAddress: launch, type: a.type, message: a.message, txHash: a.tx, dedupeKey: `${launch}:promise:${a.key}` });
  }
  await addAlerts(alerts);
  if (changed) invalidatePromiseCounts();
}
