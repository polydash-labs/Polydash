/**
 * Read side for token launches: list, search, trending feed, one launch, and plain-words protections.
 * All values come from Robinhood Chain reads. Nothing is predicted.
 */
import { erc20Abi, hookAbi, launchAbi, launchFactoryAbi, stakingFactoryAbi, stateViewAbi, vestingFactoryAbi, bondFactoryAbi } from './abis';
import { ADDR, EXPLORER, LIMITS, PHASE_NAME, POOL_LP_FEE, POOL_TICK_SPACING, WORDING } from './config';
import { ApiError, cached, ethDisplay, optUint, unitsDisplay, type Addr, type Ctx } from './core';
import { getAddress, isAddress } from 'viem';
import { AGENT_LAUNCH_MARK, isAgentLaunched } from '../../agent-mark';
import { getLogsChunked, blocksPerSecond } from './logs';

export type LaunchInfo = {
  launch: Addr;
  token: Addr;
  factoryId: string;
  hook: Addr;
  name: string;
  symbol: string;
  imageUri: string;
  description: string;
  creator: Addr;
  creatorFeeBps: number;
  creatorPayoutWallet: Addr;
  phase: number;
  phaseName: string;
  spotPriceWei: bigint;
  realEthRaisedWei: bigint;
  graduationThresholdWei: bigint;
  tokensSoldWei: bigint;
  curveSupplyWei: bigint;
  totalSupplyWei: bigint;
  launchTime: number;
  devBuyTokensWei: bigint;
  totalCommittedWei: bigint;
  socialLinks: string[];
  agentLaunched: boolean;
  progressPct: number;
};

const LAUNCH_FIELDS = [
  'token', 'creator', 'creatorFeeBps', 'creatorPayoutWallet', 'phase', 'spotPrice', 'realEthRaised', 'graduationThreshold',
  'tokensSold', 'curveSupply', 'totalSupply', 'launchTime', 'devBuyTokens', 'totalCommitted',
] as const;
const TOKEN_FIELDS = ['name', 'symbol', 'imageUri', 'description', 'socialLinks'] as const;

export async function listLaunchAddresses(ctx: Ctx): Promise<{ launch: Addr; factoryId: string; hook: Addr }[]> {
  return cached(ctx, 'launch-addrs', 20_000, async () => {
    const out: { launch: Addr; factoryId: string; hook: Addr }[] = [];
    for (const f of ADDR.launchFactories) {
      const len = (await ctx.client.readContract({ address: f.factory, abi: launchFactoryAbi, functionName: 'allLaunchesLength' })) as bigint;
      const n = Number(len);
      if (n === 0) continue;
      const res = await ctx.client.multicall({
        contracts: Array.from({ length: n }, (_, i) => ({ address: f.factory, abi: launchFactoryAbi, functionName: 'allLaunches' as const, args: [BigInt(i)] as const })),
        allowFailure: true,
      });
      for (const r of res) if (r.status === 'success') out.push({ launch: r.result as Addr, factoryId: f.id, hook: f.hook });
    }
    return out;
  });
}

export async function loadLaunches(ctx: Ctx, items: { launch: Addr; factoryId: string; hook: Addr }[]): Promise<LaunchInfo[]> {
  if (items.length === 0) return [];
  const lres = await ctx.client.multicall({
    contracts: items.flatMap((it) => LAUNCH_FIELDS.map((f) => ({ address: it.launch, abi: launchAbi, functionName: f }) as never)),
    allowFailure: true,
  });
  const per = items.map((_, i) => {
    const o: Record<string, unknown> = {};
    LAUNCH_FIELDS.forEach((f, j) => {
      const r = lres[i * LAUNCH_FIELDS.length + j];
      o[f] = r.status === 'success' ? r.result : undefined;
    });
    return o;
  });
  const tres = await ctx.client.multicall({
    contracts: per.flatMap((l) => TOKEN_FIELDS.map((f) => ({ address: (l.token as Addr) ?? ADDR.weth, abi: erc20Abi, functionName: f }) as never)),
    allowFailure: true,
  });
  return items.map((it, i) => {
    const l = per[i];
    const t: Record<string, unknown> = {};
    TOKEN_FIELDS.forEach((f, j) => {
      const r = tres[i * TOKEN_FIELDS.length + j];
      t[f] = r.status === 'success' ? r.result : undefined;
    });
    const phase = Number(l.phase ?? 0);
    const raised = (l.realEthRaised as bigint) ?? 0n;
    const thr = (l.graduationThreshold as bigint) ?? 0n;
    const links = ((t.socialLinks as string[]) ?? []).filter(Boolean);
    const progress = phase === 4 ? 100 : thr > 0n ? Math.min(100, Number((raised * 1000n) / thr) / 10) : 0;
    return {
      launch: it.launch,
      token: (l.token as Addr) ?? ADDR.weth,
      factoryId: it.factoryId,
      hook: it.hook,
      name: (t.name as string) ?? 'Unknown',
      symbol: (t.symbol as string) ?? '???',
      imageUri: (t.imageUri as string) ?? '',
      description: ((t.description as string) ?? '').slice(0, 600),
      creator: (l.creator as Addr) ?? ADDR.weth,
      creatorFeeBps: Number(l.creatorFeeBps ?? 0),
      creatorPayoutWallet: (l.creatorPayoutWallet as Addr) ?? ADDR.weth,
      phase,
      phaseName: PHASE_NAME[phase] ?? 'unknown',
      spotPriceWei: (l.spotPrice as bigint) ?? 0n,
      realEthRaisedWei: raised,
      graduationThresholdWei: thr,
      tokensSoldWei: (l.tokensSold as bigint) ?? 0n,
      curveSupplyWei: (l.curveSupply as bigint) ?? 0n,
      totalSupplyWei: (l.totalSupply as bigint) ?? 0n,
      launchTime: Number((l.launchTime as bigint) ?? 0n),
      devBuyTokensWei: (l.devBuyTokens as bigint) ?? 0n,
      totalCommittedWei: (l.totalCommitted as bigint) ?? 0n,
      socialLinks: links,
      agentLaunched: isAgentLaunched(links),
      progressPct: progress,
    } satisfies LaunchInfo;
  });
}

export async function allLaunches(ctx: Ctx): Promise<LaunchInfo[]> {
  return cached(ctx, 'launch-all', 15_000, async () => loadLaunches(ctx, await listLaunchAddresses(ctx)));
}

/** Accepts a launch address, a token address, or a symbol / name (exact, then prefix). */
export async function resolveLaunch(ctx: Ctx, ref: string, opts: { fresh?: boolean } = {}): Promise<LaunchInfo> {
  const hit = await resolveLaunchCached(ctx, ref);
  if (!opts.fresh) return hit;
  // Trading reads must be current: reload this one launch instead of using the shared list cache.
  const [again] = await loadLaunches(ctx, [{ launch: hit.launch, factoryId: hit.factoryId, hook: hit.hook }]);
  return again ?? hit;
}

async function resolveLaunchCached(ctx: Ctx, ref: string): Promise<LaunchInfo> {
  const all = await allLaunches(ctx);
  const q = ref.trim();
  if (isAddress(q, { strict: false })) {
    const a = getAddress(q);
    const hit = all.find((l) => l.launch === a || l.token === a);
    if (hit) return hit;
    throw new ApiError(404, 'not_found', 'That address is not a Polypad launch or launch token.', { address: a });
  }
  const lower = q.replace(/^\$/, '').toLowerCase();
  const exact = all.filter((l) => l.symbol.toLowerCase() === lower || l.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new ApiError(409, 'ambiguous_token', `More than one launch matches "${q}". Ask the user which one, or use the token address.`, {
      matches: exact.map((l) => brief(l)),
    });
  }
  const pre = all.filter((l) => l.symbol.toLowerCase().startsWith(lower) || l.name.toLowerCase().startsWith(lower));
  if (pre.length === 1) return pre[0];
  if (pre.length > 1) {
    throw new ApiError(409, 'ambiguous_token', `More than one launch starts with "${q}". Ask the user which one, or use the token address.`, { matches: pre.map((l) => brief(l)) });
  }
  throw new ApiError(404, 'not_found', `No Polypad launch matches "${q}". Try list tokens to browse.`, { query: q });
}

export function brief(l: LaunchInfo) {
  return {
    name: l.name,
    symbol: l.symbol,
    token: l.token,
    launch: l.launch,
    phase: l.phaseName,
    progressPct: l.progressPct,
    agentLaunched: l.agentLaunched,
  };
}

export function launchView(l: LaunchInfo) {
  return {
    name: l.name,
    symbol: l.symbol,
    token: l.token,
    launch: l.launch,
    imageUri: l.imageUri,
    description: l.description,
    creator: l.creator,
    creatorFeeBps: l.creatorFeeBps,
    phase: l.phaseName,
    onCurve: l.phase === 3,
    graduated: l.phase === 4,
    spotPriceWei: l.spotPriceWei.toString(),
    spotPriceEthDisplay: ethDisplay(l.spotPriceWei, 12),
    ethRaisedWei: l.realEthRaisedWei.toString(),
    ethRaisedDisplay: ethDisplay(l.realEthRaisedWei),
    graduationThresholdWei: l.graduationThresholdWei.toString(),
    graduationThresholdDisplay: ethDisplay(l.graduationThresholdWei),
    progressPct: l.progressPct,
    totalSupplyDisplay: unitsDisplay(l.totalSupplyWei, 18, 0),
    launchedAt: l.launchTime ? new Date(l.launchTime * 1000).toISOString() : null,
    agentLaunched: l.agentLaunched,
    agentMark: l.agentLaunched ? AGENT_LAUNCH_MARK : null,
    socialLinks: l.socialLinks.filter((s) => s !== AGENT_LAUNCH_MARK).slice(0, 6),
    links: { token: `https://polypad.family/token/${l.launch}`, explorer: `${EXPLORER}/address/${l.token}` },
  };
}

// ---------------------------------------------------------------- feeds

type Activity = { trades24h: number; ethVolume24hWei: bigint };

async function activityFor(ctx: Ctx, l: LaunchInfo, sinceBlock: bigint): Promise<Activity> {
  try {
    const bought = launchAbi.find((x) => x.type === 'event' && x.name === 'Bought')!;
    const sold = launchAbi.find((x) => x.type === 'event' && x.name === 'Sold')!;
    const [b, s] = await Promise.all([
      getLogsChunked(ctx, { address: l.launch, event: bought, fromBlock: sinceBlock }),
      getLogsChunked(ctx, { address: l.launch, event: sold, fromBlock: sinceBlock }),
    ]);
    let vol = 0n;
    for (const x of b as { args: { ethIn?: bigint } }[]) vol += x.args.ethIn ?? 0n;
    for (const x of s as { args: { ethOut?: bigint } }[]) vol += x.args.ethOut ?? 0n;
    return { trades24h: b.length + s.length, ethVolume24hWei: vol };
  } catch {
    return { trades24h: 0, ethVolume24hWei: 0n };
  }
}

export type TokenFeedInput = { sort?: string; q?: string; limit?: number; phase?: string; agentLaunched?: boolean };

export async function tokenFeed(ctx: Ctx, input: TokenFeedInput) {
  const limit = Math.min(LIMITS.listMax, Math.max(1, input.limit ?? 12));
  let rows = await allLaunches(ctx);
  const q = input.q?.trim().replace(/^\$/, '').toLowerCase();
  if (q) rows = rows.filter((l) => l.symbol.toLowerCase().includes(q) || l.name.toLowerCase().includes(q) || l.token.toLowerCase() === q || l.launch.toLowerCase() === q);
  if (input.phase) rows = rows.filter((l) => l.phaseName === input.phase);
  if (input.agentLaunched !== undefined) rows = rows.filter((l) => l.agentLaunched === input.agentLaunched);
  const sort = input.sort ?? 'trending';
  const act = new Map<string, Activity>();
  if (sort === 'trending' || sort === 'volume') {
    const bps = await blocksPerSecond(ctx);
    const head = await ctx.client.getBlockNumber();
    const since = head - BigInt(Math.floor(bps * 86_400));
    const pool = [...rows].sort((a, b) => b.launchTime - a.launchTime).slice(0, 40);
    const results = await cached(ctx, `activity:${since / 10_000n}`, 120_000, async () => {
      const entries = await Promise.all(pool.map(async (l) => [l.launch, await activityFor(ctx, l, since)] as const));
      return entries;
    });
    for (const [k, v] of results) act.set(k, v);
  }
  const score = (l: LaunchInfo) => {
    const a = act.get(l.launch);
    const recency = Math.max(0, 1 - (ctx.nowSec() - l.launchTime) / (14 * 86_400));
    return (a?.trades24h ?? 0) * 10 + Number((a?.ethVolume24hWei ?? 0n) / 10n ** 15n) / 10 + recency * 3 + l.progressPct / 25;
  };
  const sorters: Record<string, (a: LaunchInfo, b: LaunchInfo) => number> = {
    trending: (a, b) => score(b) - score(a),
    volume: (a, b) => Number((act.get(b.launch)?.ethVolume24hWei ?? 0n) - (act.get(a.launch)?.ethVolume24hWei ?? 0n)),
    new: (a, b) => b.launchTime - a.launchTime,
    graduating: (a, b) => (b.phase === 3 ? b.progressPct : -1) - (a.phase === 3 ? a.progressPct : -1),
    graduated: (a, b) => (b.phase === 4 ? 1 : 0) - (a.phase === 4 ? 1 : 0),
  };
  if (!sorters[sort]) throw new ApiError(400, 'invalid_params', 'sort must be one of trending, new, graduating, volume, graduated.', { field: 'sort' });
  rows = [...rows].sort(sorters[sort]).slice(0, limit);
  return {
    ok: true,
    sort,
    count: rows.length,
    totalLaunches: (await allLaunches(ctx)).length,
    tokens: rows.map((l) => {
      const a = act.get(l.launch);
      return {
        ...launchView(l),
        ...(a ? { last24h: { trades: a.trades24h, ethVolumeDisplay: ethDisplay(a.ethVolume24hWei, 4) } } : {}),
      };
    }),
    note: 'Activity is counted from on-chain trade events. It describes what happened, not what will happen.',
  };
}

// ---------------------------------------------------------------- protections in plain words

export type Check = { id: string; status: 'met' | 'not_met' | 'unknown' | 'info'; title: string; plain: string; evidence?: string };

export async function protectionsFor(ctx: Ctx, l: LaunchInfo) {
  const checks: Check[] = [];
  const evid = (a: string) => `${EXPLORER}/address/${a}`;

  // 1. Liquidity
  if (l.phase === 4) {
    let poolLive: boolean | null = null;
    try {
      const poolId = (await ctx.client.readContract({ address: l.hook, abi: hookAbi, functionName: 'computePoolId', args: [l.token] })) as `0x${string}`;
      const slot0 = (await ctx.client.readContract({ address: ADDR.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] })) as readonly [bigint, number, number, number];
      poolLive = slot0[0] > 0n;
    } catch {
      poolLive = null;
    }
    checks.push({
      id: 'liquidity_locked',
      status: poolLive === false ? 'unknown' : 'met',
      title: 'Liquidity',
      plain: 'The token has graduated. Its liquidity sits in a Uniswap V4 pool and the Polypad hook holds the position. The hook has no code that removes it. Locked liquidity does not mean the price will hold.',
      evidence: evid(l.hook),
    });
  } else {
    checks.push({
      id: 'liquidity_locked',
      status: 'not_met',
      title: 'Liquidity',
      plain: `Still on the bonding curve. The launch contract holds the ETH raised (${ethDisplay(l.realEthRaisedWei)} of ${ethDisplay(l.graduationThresholdWei)} ETH). At graduation the liquidity moves into a locked Uniswap V4 pool. A token may never graduate.`,
      evidence: evid(l.launch),
    });
  }

  // 2. Creator fee and payout wallet
  checks.push({
    id: 'creator_fee',
    status: 'info',
    title: 'Fees',
    plain: `Each trade pays a ${(l.creatorFeeBps / 100).toFixed(2)}% creator fee plus a 0.2% platform fee. The creator fee goes to ${l.creatorPayoutWallet === l.creator ? "the creator's own wallet" : 'a separate payout wallet'}, and a change of that wallet waits 48 hours.`,
    evidence: evid(l.launch),
  });

  // 3. Creator holdings
  try {
    const bal = (await ctx.client.readContract({ address: l.token, abi: erc20Abi, functionName: 'balanceOf', args: [l.creator] })) as bigint;
    const pct = l.totalSupplyWei > 0n ? Number((bal * 10_000n) / l.totalSupplyWei) / 100 : 0;
    checks.push({
      id: 'creator_holdings',
      status: 'info',
      title: 'Creator holdings',
      plain: `The creator wallet holds ${pct}% of the supply right now. A creator who holds a lot can sell a lot. Holdings can move to other wallets, so this is one reading.`,
      evidence: evid(l.creator),
    });
  } catch {
    checks.push({ id: 'creator_holdings', status: 'unknown', title: 'Creator holdings', plain: 'Could not read the creator balance.' });
  }

  // 4. Creator staking pool, vesting lock, bond
  const [pools, locked, bonds] = await Promise.all([
    ctx.client.readContract({ address: ADDR.stakingFactoryV2, abi: stakingFactoryAbi, functionName: 'poolsByCreator', args: [l.creator] }).catch(() => null),
    ctx.client.readContract({ address: ADDR.vestingFactory, abi: vestingFactoryAbi, functionName: 'totalLockedForToken', args: [l.token] }).catch(() => null),
    ctx.client.readContract({ address: ADDR.bondFactory, abi: bondFactoryAbi, functionName: 'bondsByToken', args: [l.token] }).catch(() => null),
  ]);
  let activePool = false;
  if (Array.isArray(pools) && pools.length) {
    const infos = await ctx.client.multicall({
      contracts: (pools as Addr[]).slice(0, 10).map((p) => ({ address: ADDR.stakingFactoryV2, abi: stakingFactoryAbi, functionName: 'getPoolInfo' as const, args: [p] as const })),
      allowFailure: true,
    });
    for (const r of infos) {
      if (r.status === 'success') {
        const info = r.result as { stakeToken: Addr; endTime: bigint };
        if (info.stakeToken === l.token && Number(info.endTime) > ctx.nowSec()) activePool = true;
      }
    }
  }
  checks.push({
    id: 'creator_staking_pool',
    status: pools === null ? 'unknown' : activePool ? 'met' : 'not_met',
    title: 'Creator staking pool',
    plain: pools === null ? 'Could not read the staking factory.' : activePool ? 'The creator runs an active staking pool for this token. Rewards vary and can be zero.' : 'The creator has no active staking pool for this token.',
    evidence: evid(ADDR.stakingFactoryV2),
  });
  const lockedWei = typeof locked === 'bigint' ? locked : null;
  checks.push({
    id: 'creator_vesting',
    status: lockedWei === null ? 'unknown' : lockedWei > 0n ? 'met' : 'not_met',
    title: 'Creator token vesting',
    plain:
      lockedWei === null
        ? 'Could not read the vesting factory.'
        : lockedWei > 0n && l.totalSupplyWei > 0n
          ? `${Number((lockedWei * 10_000n) / l.totalSupplyWei) / 100}% of supply is locked in a vesting vault.`
          : 'No creator tokens are locked in a vesting vault.',
    evidence: evid(ADDR.vestingFactory),
  });
  checks.push({
    id: 'creator_bond',
    status: bonds === null ? 'unknown' : (bonds as unknown[]).length > 0 ? 'met' : 'not_met',
    title: 'Creator bond',
    plain: bonds === null ? 'Could not read the bond factory.' : (bonds as unknown[]).length > 0 ? 'The creator has posted a bond for this token.' : 'The creator has not posted a bond for this token.',
    evidence: evid(ADDR.bondFactory),
  });
  checks.push({
    id: 'agent_launched',
    status: 'info',
    title: 'How it was launched',
    plain: l.agentLaunched ? 'Prepared through the Polypad agent API. That label records how the launch was prepared, not its quality.' : 'Launched from the website, not through the agent API.',
  });

  const met = checks.filter((c) => c.status === 'met').length;
  const countable = checks.filter((c) => c.status !== 'info').length;
  const gaps = checks.filter((c) => c.status === 'not_met').map((c) => c.title.toLowerCase());
  return {
    ok: true,
    token: l.token,
    launch: l.launch,
    name: l.name,
    symbol: l.symbol,
    met,
    of: countable,
    checks,
    plainSummary: `${l.symbol}: ${met} of ${countable} on-chain protection checks are met${gaps.length ? `. Not met: ${gaps.join(', ')}` : ''}. These are public on-chain readings. They are not a promise about price, and tokens can lose all their value.`,
    cannotTellYou: ['Whether the team behind the token will keep building.', 'Whether other wallets hold a large share.', 'Where the price goes next.'],
    disclaimer: `${WORDING.scan} ${WORDING.notAudited}`,
    checkedAt: new Date(ctx.now()).toISOString(),
  };
}

export { optUint };
export const POOL = { fee: POOL_LP_FEE, tickSpacing: POOL_TICK_SPACING };
export { launchFactoryAbi };
