// Read-only agent tools. Isomorphic: runs in the browser or in server routes, using the app's existing
// Robinhood Chain config (lib/chain.ts) and its RPC. No AI involved.
import { createPublicClient, formatUnits, http, isAddress, parseAbi, toEventSelector, getAddress, type Address, type Hex } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { STAKING_FACTORIES, STAKING_FACTORY_OLD } from '@/lib/staking/factories';

export const publicClient = createPublicClient({ chain: robinhoodChain, transport: http() });

// ---------- cache (30s) ----------
const TTL = 30_000;
const cache = new Map<string, { at: number; p: Promise<unknown> }>();
export function cached<T>(key: string, fn: () => Promise<T>, ttl = TTL): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>;
  const p = fn().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { at: Date.now(), p });
  return p;
}

export function requireAddress(a: string | undefined | null): Address {
  const v = (a ?? '').trim();
  if (!isAddress(v, { strict: false })) throw new Error('Enter a valid 0x address.');
  return getAddress(v);
}

export const ZERO = '0x0000000000000000000000000000000000000000';
export const DEAD = '0x000000000000000000000000000000000000dead';
export const isBurn = (a: string) => a.toLowerCase() === ZERO || a.toLowerCase() === DEAD;

const toNum = (v: bigint | null | undefined, d: number) => (v == null ? null : Number(formatUnits(v, d)));

// ---------- ABIs ----------
export const STAKING_FACTORY_V2 = STAKING_FACTORY_OLD;
const KNOWN_POOLS: { address: string }[] = [
  { address: '0xadf34a657cf2dcd3703a5478d9fae4a325dba8ad' },
  { address: '0xe798d753ba2d9584e86e490b48d8c572e726cf33' },
  { address: '0x0f50043e172b8652bb786c4f14f30c415e5760ab' },
];

const factoryAbi = parseAbi([
  'function poolsLength() view returns (uint256)',
  'function allPools(uint256) view returns (address)',
  'function verified(address) view returns (bool)',
]);
export const poolAbi = parseAbi([
  'function name() view returns (string)',
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
  'function isActive() view returns (bool)',
  'function funded() view returns (bool)',
  'function principalBacking() view returns (uint256)',
  'function description() view returns (string)',
  'function claimFeeBps() view returns (uint256)',
]);
export const erc20ReadAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function owner() view returns (address)',
]);

export async function tryRead<T>(address: Address, abi: any, functionName: string, args: readonly unknown[] = []): Promise<T | null> {
  try {
    return (await publicClient.readContract({ address, abi, functionName, args } as any)) as T;
  } catch {
    return null;
  }
}

export async function tokenMeta(address: Address) {
  return cached(`meta:${address}`, async () => {
    const [symbol, decimals] = await Promise.all([
      tryRead<string>(address, erc20ReadAbi, 'symbol'),
      tryRead<number>(address, erc20ReadAbi, 'decimals'),
    ]);
    return { symbol: symbol ?? 'n/a', decimals: decimals == null ? 18 : Number(decimals), decimalsKnown: decimals != null };
  }, 300_000);
}

// ---------- Poly Agent: staking ----------
export type PoolVersion = 'v2';

export async function listPoolAddresses(): Promise<{ address: Address; version: PoolVersion; factory: Address }[]> {
  return cached('pools:list', async () => {
    const out = new Map<string, { address: Address; version: PoolVersion; factory: Address }>();
    for (const { address: factory } of STAKING_FACTORIES) {
      const n = await tryRead<bigint>(factory, factoryAbi, 'poolsLength');
      if (n == null) continue;
      const idx = Array.from({ length: Math.min(Number(n), 200) }, (_, i) => BigInt(i));
      const addrs = await Promise.all(idx.map((i) => tryRead<Address>(factory, factoryAbi, 'allPools', [i])));
      addrs.forEach((a) => { if (a && !out.has(a.toLowerCase())) out.set(a.toLowerCase(), { address: getAddress(a), version: 'v2', factory }); });
    }
    for (const k of KNOWN_POOLS) if (!out.has(k.address)) out.set(k.address, { address: getAddress(k.address), version: 'v2', factory: STAKING_FACTORY_OLD });
    return Array.from(out.values());
  });
}

// Only pools created by the V2 staking factories (old and new) are supported.
async function poolVersion(pool: Address): Promise<PoolVersion | null> {
  const list = await listPoolAddresses();
  return list.some((p) => p.address.toLowerCase() === pool.toLowerCase()) ? 'v2' : null;
}

export type RewardRate =
  | { kind: 'ratio'; perThousandPerDay: number; rewardSymbol: string; stakeSymbol: string }
  | { kind: 'ended' }
  | { kind: 'undefined' }
  | { kind: 'na' };

export interface PoolStats {
  address: Address;
  version: PoolVersion;
  name: string | null;
  description: string | null;
  stakeToken: Address | null;
  rewardToken: Address | null;
  stakeSymbol: string;
  rewardSymbol: string;
  totalStaked: number | null;
  totalRewards: number | null;
  totalRewardsPaid: number | null;
  startTime: number | null;
  endTime: number | null;
  startDate: string | null; // YYYY-MM-DD (UTC)
  endDate: string | null;
  stakerCount: number | null;
  maxTotalStake: number | null; // 0 = no cap
  isActive: boolean | null;
  funded: boolean | null;
  claimFeeBps: number | null;
  principalBacking: number | null;
  verified: boolean | null;
  ended: boolean;
  full: boolean;
  rewardRate: RewardRate;
}

export async function poolStats(poolInput: string): Promise<PoolStats> {
  const pool = requireAddress(poolInput);
  return cached(`pool:${pool}`, async () => {
    const version = await poolVersion(pool);
    if (!version) throw new Error('This address is not a Polypad staking pool.');
    const r = <T,>(fn: string) => tryRead<T>(pool, poolAbi, fn);
    const [name, stakeToken, rewardToken, totalStaked, rewardRate, startTime, endTime, totalRewards, totalRewardsPaid, stakerCount, maxTotalStake, isActive, funded] =
      await Promise.all([
        r<string>('name'), r<Address>('stakeToken'), r<Address>('rewardToken'), r<bigint>('totalStaked'), r<bigint>('rewardRate'),
        r<bigint>('startTime'), r<bigint>('endTime'), r<bigint>('totalRewards'), r<bigint>('totalRewardsPaid'), r<bigint>('stakerCount'),
        r<bigint>('maxTotalStake'), r<boolean>('isActive'), r<boolean>('funded'),
      ]);
    const [principalBacking, description, claimFeeBps, verified] = await Promise.all([r<bigint>('principalBacking'), r<string>('description'), r<bigint>('claimFeeBps'),
      listPoolAddresses().then((l) => tryRead<boolean>(l.find((p) => p.address.toLowerCase() === pool.toLowerCase())?.factory ?? STAKING_FACTORY_OLD, factoryAbi, 'verified', [pool]))]);
    if (!stakeToken && totalStaked == null) throw new Error('This address does not look like a Polypad staking pool.');
    const sm = stakeToken ? await tokenMeta(stakeToken) : { symbol: 'n/a', decimals: 18 };
    const rm = rewardToken ? await tokenMeta(rewardToken) : { symbol: 'n/a', decimals: 18 };
    const now = Math.floor(Date.now() / 1000);
    const end = endTime == null ? null : Number(endTime);
    const ended = end != null && end > 0 && now >= end;
    const full = maxTotalStake != null && totalStaked != null && maxTotalStake > BigInt(0) && totalStaked >= maxTotalStake;

    // rewardRate is stored with 1e18 precision on these pools; detect it from totalRewards so the math is unit-correct.
    let rate: RewardRate = { kind: 'na' };
    if (ended) rate = { kind: 'ended' };
    else if (totalStaked != null && totalStaked === BigInt(0)) rate = { kind: 'undefined' };
    else if (rewardRate != null && totalStaked != null && stakeToken && rewardToken) {
      const dur = startTime != null && endTime != null ? endTime - startTime : BigInt(0);
      const scaled = totalRewards != null && dur > BigInt(0) && rewardRate * dur > totalRewards * BigInt(1_000_000_000);
      const perSecRaw = scaled ? Number(rewardRate) / 1e18 : Number(rewardRate);
      const perDay = (perSecRaw * 86_400) / 10 ** rm.decimals;
      const staked = Number(formatUnits(totalStaked, sm.decimals));
      rate = { kind: 'ratio', perThousandPerDay: (perDay / staked) * 1000, rewardSymbol: rm.symbol, stakeSymbol: sm.symbol };
    }

    return {
      address: pool, version, name, description: description || null, stakeToken, rewardToken,
      stakeSymbol: sm.symbol, rewardSymbol: rm.symbol,
      totalStaked: toNum(totalStaked, sm.decimals), totalRewards: toNum(totalRewards, rm.decimals),
      totalRewardsPaid: toNum(totalRewardsPaid, rm.decimals),
      startTime: startTime == null ? null : Number(startTime), endTime: end,
      startDate: startTime == null || startTime === BigInt(0) ? null : new Date(Number(startTime) * 1000).toISOString().slice(0, 10),
      endDate: end == null || end === 0 ? null : new Date(end * 1000).toISOString().slice(0, 10),
      stakerCount: stakerCount == null ? null : Number(stakerCount),
      maxTotalStake: toNum(maxTotalStake, sm.decimals), isActive, funded,
      claimFeeBps: claimFeeBps == null ? null : Number(claimFeeBps),
      principalBacking: toNum(principalBacking, sm.decimals), verified, ended, full, rewardRate: rate,
    };
  });
}

export async function listPools(): Promise<PoolStats[]> {
  const list = await listPoolAddresses();
  const res = await Promise.all(list.map((p) => poolStats(p.address).catch(() => null)));
  return res.filter((x): x is PoolStats => !!x);
}

export async function openPools(): Promise<PoolStats[]> {
  return (await listPools()).filter((p) => !p.ended && !p.full && p.isActive === true);
}

export interface FlowRow { type: 'Stake' | 'Withdraw' | 'Emergency withdraw'; user: Address; amount: number | null; block: number; txHash: Hex; time: number | null }

const EV = {
  v2Staked: toEventSelector('Staked(address,uint256,uint256)'),
  v2Withdrawn: toEventSelector('Withdrawn(address,uint256,uint256)'),
  v2Emergency: toEventSelector('EmergencyWithdrawn(address,uint256,uint256)'),
};

export function word(data: Hex, i: number): bigint | null {
  const s = data.slice(2 + 64 * i, 2 + 64 * (i + 1));
  return s.length === 64 ? BigInt('0x' + s) : null;
}

async function chunkedLogs(address: Address, topics: (Hex | Hex[] | null)[], span: number, chunk = 10_000) {
  const latest = await publicClient.getBlockNumber();
  const from = latest > BigInt(span) ? latest - BigInt(span) : BigInt(0);
  const ranges: [bigint, bigint][] = [];
  for (let s = from; s <= latest; s += BigInt(chunk)) {
    const e = s + BigInt(chunk - 1) > latest ? latest : s + BigInt(chunk - 1);
    ranges.push([s, e]);
  }
  const logs: any[] = [];
  for (let i = 0; i < ranges.length; i += 5) {
    const batch = await Promise.all(ranges.slice(i, i + 5).map(([fromBlock, toBlock]) =>
      publicClient.request({ method: 'eth_getLogs', params: [{ address, topics, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }] } as any)));
    batch.forEach((b: any) => logs.push(...(b ?? [])));
  }
  return { logs, latest, from };
}

export async function recentFlows(poolInput: string): Promise<{ rows: FlowRow[]; blocks: number; symbol: string }> {
  const pool = requireAddress(poolInput);
  return cached(`flows:${pool}`, async () => {
    if (!(await poolVersion(pool))) throw new Error('This address is not a Polypad staking pool.');
    const stake = await tryRead<Address>(pool, poolAbi, 'stakeToken');
    const meta = stake ? await tokenMeta(stake) : { symbol: '', decimals: 18 };
    const sels = [EV.v2Staked, EV.v2Withdrawn, EV.v2Emergency];
    const { logs } = await chunkedLogs(pool, [sels], 50_000);
    const rows: FlowRow[] = logs.map((l: any) => {
      const t0 = l.topics[0];
      const type: FlowRow['type'] = t0 === EV.v2Emergency ? 'Emergency withdraw' : t0 === EV.v2Staked ? 'Stake' : 'Withdraw';
      const idx = type === 'Stake' ? 0 : 1;
      const user = (l.topics[1] ? `0x${l.topics[1].slice(26)}` : ZERO) as Address;
      return { type, user: getAddress(user), amount: toNum(word(l.data, idx), meta.decimals), block: Number(BigInt(l.blockNumber)), txHash: l.transactionHash, time: null };
    }).sort((a, b) => b.block - a.block).slice(0, 25);
    const blocks = Array.from(new Set(rows.map((r) => r.block)));
    const ts = await Promise.all(blocks.map((b) => publicClient.getBlock({ blockNumber: BigInt(b) }).then((x) => Number(x.timestamp)).catch(() => null)));
    rows.forEach((r) => { r.time = ts[blocks.indexOf(r.block)] ?? null; });
    return { rows, blocks: 50_000, symbol: meta.symbol };
  });
}

// ---------- PolyCTO: token analysis ----------
export interface TokenAnalysis {
  address: Address; isContract: boolean; name: string | null; symbol: string | null; decimals: number | null;
  totalSupply: number | null; owner: Address | null; renounced: boolean;
}

export async function analyzeToken(input: string): Promise<TokenAnalysis> {
  const address = requireAddress(input);
  return cached(`token:${address}`, async () => {
    const code = await publicClient.getCode({ address }).catch(() => undefined);
    const isContract = !!code && code !== '0x';
    const [name, symbol, decimals, totalSupply, owner] = await Promise.all([
      tryRead<string>(address, erc20ReadAbi, 'name'), tryRead<string>(address, erc20ReadAbi, 'symbol'),
      tryRead<number>(address, erc20ReadAbi, 'decimals'), tryRead<bigint>(address, erc20ReadAbi, 'totalSupply'),
      tryRead<Address>(address, erc20ReadAbi, 'owner'),
    ]);
    const d = decimals == null ? null : Number(decimals);
    return { address, isContract, name, symbol, decimals: d, totalSupply: toNum(totalSupply, d ?? 18), owner, renounced: owner != null && isBurn(owner) };
  });
}

export interface HolderReport {
  top: { address: Address; balance: number; pct: number | null }[];
  top10Pct: number | null; transfers: number; burned: number; symbol: string; blocks: number;
}

const TRANSFER = toEventSelector('Transfer(address,address,uint256)');

export async function holdersAndFlows(input: string): Promise<HolderReport> {
  const address = requireAddress(input);
  return cached(`holders:${address}`, async () => {
    const t = await analyzeToken(address);
    if (!t.isContract) throw new Error('That address is not a contract.');
    const dec = t.decimals ?? 18;
    const { logs } = await chunkedLogs(address, [TRANSFER], 200_000);
    const net = new Map<string, bigint>();
    let burned = BigInt(0);
    let transfers = 0;
    for (const l of logs) {
      if (!l.topics?.[1] || !l.topics?.[2]) continue;
      const from = `0x${l.topics[1].slice(26)}`.toLowerCase();
      const to = `0x${l.topics[2].slice(26)}`.toLowerCase();
      const v = word(l.data, 0) ?? BigInt(0);
      transfers++;
      net.set(from, (net.get(from) ?? BigInt(0)) - v);
      net.set(to, (net.get(to) ?? BigInt(0)) + v);
      if (isBurn(to)) burned += v;
    }
    const top = Array.from(net.entries()).filter(([a, v]) => !isBurn(a) && v > BigInt(0))
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, 10)
      .map(([a, v]) => {
        const balance = Number(formatUnits(v, dec));
        return { address: getAddress(a), balance, pct: t.totalSupply ? (balance / t.totalSupply) * 100 : null };
      });
    const top10Pct = t.totalSupply ? top.reduce((s, h) => s + (h.pct ?? 0), 0) : null;
    return { top, top10Pct, transfers, burned: Number(formatUnits(burned, dec)), symbol: t.symbol ?? '', blocks: 200_000 };
  });
}

// ---------- PolyCTO: security heuristics (call from server; Sourcify has no CORS guarantee) ----------
export type Severity = 'high' | 'medium' | 'info';
export interface SecurityFlag { id: string; severity: Severity; title: string; meaning: string; files?: string[] }
export interface SecurityReport { address: Address; verified: boolean; flags: SecurityFlag[]; implementation: Address | null }

const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const RULES: { id: string; severity: Severity; re: RegExp; title: string; meaning: string }[] = [
  { id: 'owner_mint', severity: 'high', re: /function\s+mint\s*\([^)]*\)[^{]*\b(onlyOwner|onlyRole|onlyMinter)/, title: 'Privileged mint', meaning: 'An owner or role can create new tokens, which can dilute holders.' },
  { id: 'blacklist', severity: 'high', re: /(blacklist|blackList|isBlacklisted|_isBot|isBot|denylist)/, title: 'Blacklist', meaning: 'Some addresses can be blocked from transferring or selling.' },
  { id: 'pausable', severity: 'medium', re: /(whenNotPaused|function\s+pause\s*\(|Pausable)/, title: 'Pausable', meaning: 'Transfers or key functions can be paused by an admin.' },
  { id: 'fee_tax_setter', severity: 'high', re: /function\s+(set|update)\w*(Fee|Tax)(?!\w*(Recipient|Receiver|Wallet|Address|Collector|Exempt|Exclude))\w*\s*\(/, title: 'Adjustable fee or tax', meaning: 'An admin can change transfer fees or taxes after launch.' },
  { id: 'max_tx_wallet', severity: 'medium', re: /(maxTx|maxTransaction|maxWallet|_maxTxAmount|maxWalletSize)/, title: 'Transaction or wallet limits', meaning: 'Limits on transaction size or wallet balance can restrict buying or selling.' },
  { id: 'proxy_upgradeable', severity: 'high', re: /(upgradeTo|UUPSUpgradeable|TransparentUpgradeableProxy|delegatecall|Initializable)/, title: 'Upgradeable code', meaning: 'Contract logic can be replaced, so behaviour can change later.' },
  { id: 'trading_toggle', severity: 'high', re: /(tradingEnabled|tradingOpen|enableTrading|swapEnabled\s*=|canTrade)/, title: 'Trading switch', meaning: 'Trading can be turned on or off by an admin.' },
];
const SKIP_PATH = /@openzeppelin|node_modules|\/lib\/|\/oz\//;

export async function securityScan(input: string): Promise<SecurityReport> {
  const address = requireAddress(input);
  return cached(`sec:${address}`, async () => {
    const flags: SecurityFlag[] = [];
    const slot = await publicClient.getStorageAt({ address, slot: IMPL_SLOT }).catch(() => undefined);
    let implementation: Address | null = null;
    if (slot && BigInt(slot) !== BigInt(0)) {
      implementation = getAddress(`0x${slot.slice(-40)}`);
      flags.push({ id: 'eip1967_proxy', severity: 'high', title: 'Upgradeable proxy', meaning: `This is an EIP-1967 proxy. Its logic lives at ${implementation} and can be swapped by whoever controls upgrades.` });
    }
    const owner = await tryRead<Address>(address, erc20ReadAbi, 'owner');
    if (owner && !isBurn(owner)) flags.push({ id: 'owner_active', severity: 'info', title: 'Ownership not renounced', meaning: `Owner is ${owner}. Check what owner-only functions can do.` });

    let verified = false;
    try {
      const res = await fetch(`https://sourcify.dev/server/v2/contract/${robinhoodChain.id}/${address}?fields=sources,compilation,proxyResolution`, {
        headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        verified = true;
        const data = await res.json();
        const sources: Record<string, { content?: string }> = data?.sources ?? {};
        for (const rule of RULES) {
          const files = Object.entries(sources).filter(([p, s]) => !SKIP_PATH.test(p) && rule.re.test(s?.content ?? '')).map(([p]) => p);
          if (files.length) flags.push({ id: rule.id, severity: rule.severity, title: rule.title, meaning: rule.meaning, files });
        }
      } else if (res.status !== 404) {
        throw new Error(`Sourcify returned ${res.status}`);
      }
    } catch (e) {
      flags.push({ id: 'sourcify_unreachable', severity: 'info', title: 'Source check unavailable', meaning: 'Could not reach Sourcify right now, so source patterns were not scanned. Try again shortly.' });
      return { address, verified: false, flags, implementation };
    }
    if (!verified) flags.push({ id: 'unverified', severity: 'medium', title: 'Not verified on Sourcify', meaning: 'Source code is not verified on Sourcify. That alone is a risk signal: the code cannot be reviewed.' });
    return { address, verified, flags, implementation };
  });
}

// ---------- PolyCTO: scam message check (local only) ----------
const SCAM_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'Mentions seed phrase', re: /seed\s*phrase/i },
  { label: 'Mentions private key', re: /private\s*key/i },
  { label: 'Mentions recovery phrase', re: /recovery\s*phrase/i },
  { label: '"DM me"', re: /\bdm\s+me\b/i },
  { label: 'Airdrop claim', re: /airdrop[\s\S]{0,60}claim|claim[\s\S]{0,60}airdrop/i },
  { label: '"Connect your wallet"', re: /connect\s+(your\s+)?wallet/i },
  { label: 'Fake support DM', re: /support\s+team[\s\S]{0,60}\bdm\b/i },
  { label: 'Private Telegram invite', re: /t\.me\/\+/i },
  { label: 'Guaranteed profit/return', re: /guaranteed\s+(profit|return)s?/i },
  { label: '"Double your"', re: /double\s+your/i },
  { label: '"Validate wallet"', re: /validate\s+(your\s+)?wallet/i },
  { label: '"Wallet sync"', re: /wallet\s+sync/i },
];

export interface ScamResult { score: number; matches: string[]; links: number; action: 'delete + warn' | 'review' | 'none' }
export function scamCheck(text: string): ScamResult {
  const t = text ?? '';
  const matches = SCAM_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.label);
  const links = (t.match(/(https?:\/\/|www\.|t\.me\/)\S+/gi) ?? []).length;
  const score = Math.min(100, 30 * matches.length + 10 * links);
  return { score, matches, links, action: score >= 60 ? 'delete + warn' : score >= 30 ? 'review' : 'none' };
}

// ---------- chat intents ----------
export type AgentId = 'polycto' | 'poly-agent' | 'polyforge';
export type Intent =
  | { tool: 'listPools' } | { tool: 'openPools' }
  | { tool: 'poolStats' | 'rewardRate' | 'flows'; address: string }
  | { tool: 'analyze' | 'holders' | 'security'; address: string }
  | { tool: 'scam'; text: string }
  | { tool: 'forgeLaunch' } | { tool: 'forgePool' };

export function parseIntent(agent: AgentId, raw: string): Intent | null {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const addr = text.match(/0x[a-fA-F0-9]{40}/)?.[0];
  if (agent === 'poly-agent') {
    if (/open\s+pools?/.test(lower)) return { tool: 'openPools' };
    if (addr && /(flow|stake[sd]?\b|withdraw|activity)/.test(lower)) return { tool: 'flows', address: addr };
    if (addr && /(rate|apr|apy|reward)/.test(lower)) return { tool: 'rewardRate', address: addr };
    if (addr) return { tool: 'poolStats', address: addr };
    if (/(list|all|show)?\s*pools?\b/.test(lower)) return { tool: 'listPools' };
  }
  if (agent === 'polycto') {
    if (/^(scam|check)\b/.test(lower) && !addr) return { tool: 'scam', text: text.replace(/^(scam|check)( message)?:?/i, '').trim() };
    if (addr && /(scan|security|audit|risk|safe)/.test(lower)) return { tool: 'security', address: addr };
    if (addr && /(holder|flow|whale|distribution)/.test(lower)) return { tool: 'holders', address: addr };
    if (addr) return { tool: 'analyze', address: addr };
  }
  if (agent === 'polyforge') {
    if (/(staking|pool)/.test(lower)) return { tool: 'forgePool' };
    if (/(launch|token|create)/.test(lower)) return { tool: 'forgeLaunch' };
  }
  return null;
}

export function extractAddresses(text: string): Address[] {
  return Array.from(new Set(text.match(/0x[a-fA-F0-9]{40}/g) ?? [])).filter((a) => isAddress(a, { strict: false })).map((a) => getAddress(a)).slice(0, 3);
}
