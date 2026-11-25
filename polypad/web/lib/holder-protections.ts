// Holder Protections: a 5-check on-chain checklist with a tier, for factory launches (server-side).
// Errors are never a pass: a failed read makes that check "unknown" (tier null). Cached 5 min.
import { prisma } from '@/lib/db';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { getLaunchLookup, getLaunchesSnapshot } from '@/lib/launches-server';
import { evaluateStakingStatus, getAllPools, type StakingStatus } from '@/lib/staking-status';
import type { LaunchToken } from '@/lib/token-types';
import { getExternalToken } from '@/lib/listed-tokens';
import { createPublicClient, erc20Abi, formatUnits, http, type Address } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { VESTING_FACTORY_ABI, VESTING_VAULT_ABI } from '@/lib/vestingArtifacts';
import { vestingFactory } from '@/lib/vesting';
import { BOND_ABI, BOND_FACTORY_ABI } from '@/lib/bondArtifacts';
import { bondFactory, bondMeetsBadge, STATUS_SLASHED } from '@/lib/bond';
import { getSourceVerified, type SourceVerified } from '@/lib/source-verified';

export type CheckStatus = 'pass' | 'pending' | 'unknown' | 'fail';
export type CheckId = 'liquidity_locked' | 'creator_staking_pool' | 'security_clean' | 'creator_vesting' | 'creator_bond';
export type Tier = 'gold' | 'silver' | 'bronze' | null;
export interface HolderCheck { id: CheckId; status: CheckStatus; detail: string; evidence: string | null }
export interface TierChange { at: string; from: Tier; to: Tier }
export interface HolderProtections {
  version: 2; tier: Tier; allPassed: boolean; passed: number; total: 5; checks: HolderCheck[]; checkedAt: string; disclaimer: string;
  /** Backward compatible mirrors of the creator_vesting / creator_bond checks. met null = read failed. */
  vesting?: VestingFactor;
  bond?: BondFactor;
  history?: TierChange[];
}
export interface VestingFactor { met: boolean | null; detail: string }
export type BondFactor = VestingFactor;

export interface VaultRead { address: string; meets: boolean; locked: bigint; cliffEnd: number; endTime: number }
export interface BondRead { address: string; status: number; amount: bigint; duration: number; endTime: number }
export type VestingInput = { vaults: VaultRead[]; totalSupply: bigint | null } | 'error';
export type BondInput = { bonds: BondRead[] } | 'error';

export const HP_DISCLAIMER = 'Checks can change and are not a guarantee. Scans are not audits. Not financial advice.';
export const HP_TOOLTIP = "Tier based on Polypad's live on-chain checks. Checks can change and are not a guarantee. Scans are not audits. Not financial advice.";
const TTL = 5 * 60_000;
const STAKE_URL = 'https://polypad.family/stake';

const client = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 10_000 }) });

export interface ReviewInput { status: string; target: string | null; critical: number; high: number; medium: number }
export interface HpInputs {
  launch: Pick<LaunchToken, 'launchAddress' | 'tokenAddress' | 'graduated'> | null; // null = read failed
  staking: StakingStatus | null; // null = read failed
  review: ReviewInput | null | 'error'; // null = no scan row yet
  /** Sourcify OR Blockscout result; undefined/unknown falls back to the Bevor review status. */
  source?: SourceVerified | null;
  vesting: VestingInput;
  bond: BondInput;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const fmtAmt = (wei: bigint) => Number(formatUnits(wei, 18)).toLocaleString('en-US', { maximumFractionDigits: 0 });

const SIDE: CheckId[] = ['creator_staking_pool', 'creator_vesting', 'creator_bond'];

/** Pure tier rule. Any unknown check, or a broken bond, means no tier. */
export function computeTier(checks: HolderCheck[]): Tier {
  if (checks.some((c) => c.status === 'unknown' || c.status === 'fail')) return null;
  const ok = (id: CheckId) => checks.find((c) => c.id === id)?.status === 'pass';
  const side = SIDE.filter(ok).length;
  if (checks.length === 5 && checks.every((c) => c.status === 'pass')) return 'gold';
  if (ok('security_clean') && ok('liquidity_locked') && side >= 2) return 'silver';
  if (ok('security_clean') && side >= 1) return 'bronze';
  return null;
}

export function vestingCheck(v: VestingInput, now: number): HolderCheck {
  if (v === 'error') return { id: 'creator_vesting', status: 'unknown', detail: 'Could not read vesting vaults right now', evidence: null };
  if (!v.vaults.length) return { id: 'creator_vesting', status: 'pending', detail: 'No creator vesting vault', evidence: null };
  const best = v.vaults.filter((x) => x.meets).sort((a, b) => (b.locked > a.locked ? 1 : -1))[0];
  if (!best) return { id: 'creator_vesting', status: 'pending', detail: 'No vault meets the 30-day cliff and 180-day schedule minimum', evidence: getExplorerAddressUrl(v.vaults[0].address) };
  const pct = v.totalSupply && v.totalSupply > BigInt(0) ? `${(Number((best.locked * BigInt(1_000_000)) / v.totalSupply) / 10_000).toFixed(2)}% of supply` : '% of supply unavailable';
  const cliff = best.cliffEnd > now ? `cliff ends ${day(best.cliffEnd)}` : `cliff ended ${day(best.cliffEnd)}`;
  return { id: 'creator_vesting', status: 'pass', detail: `${fmtAmt(best.locked)} tokens locked (${pct}); ${cliff}, vesting ends ${day(best.endTime)}`, evidence: getExplorerAddressUrl(best.address) };
}

export function bondCheck(b: BondInput, now: number): HolderCheck {
  if (b === 'error') return { id: 'creator_bond', status: 'unknown', detail: 'Could not read creator bonds right now', evidence: null };
  const broken = b.bonds.find((x) => x.status === STATUS_SLASHED && x.endTime > now);
  if (broken) return { id: 'creator_bond', status: 'fail', detail: 'Bond broken', evidence: getExplorerAddressUrl(broken.address) };
  if (!b.bonds.length) return { id: 'creator_bond', status: 'pending', detail: 'No creator bond', evidence: null };
  const good = b.bonds.find((x) => bondMeetsBadge(x.status, x.amount, x.duration));
  if (good) return { id: 'creator_bond', status: 'pass', detail: `Active creator bond of ${formatUnits(good.amount, 18)} ETH until ${day(good.endTime)}`, evidence: getExplorerAddressUrl(good.address) };
  return { id: 'creator_bond', status: 'pending', detail: 'No active bond of at least 0.1 ETH for at least 90 days', evidence: getExplorerAddressUrl(b.bonds[0].address) };
}

/** Pure: builds the 5-check list and tier from inputs. */
export function evaluateHolderProtections(i: HpInputs, nowDate = new Date()): HolderProtections {
  const now = Math.floor(nowDate.getTime() / 1000);
  const checks: HolderCheck[] = [];

  if (!i.launch) checks.push({ id: 'liquidity_locked', status: 'unknown', detail: 'Could not read the launch right now', evidence: null });
  else if (i.launch.graduated) checks.push({ id: 'liquidity_locked', status: 'pass', detail: 'Graduated; liquidity is held by the Polydash hook', evidence: getExplorerAddressUrl(i.launch.launchAddress) });
  else checks.push({ id: 'liquidity_locked', status: 'pending', detail: 'On bonding curve until graduation', evidence: getExplorerAddressUrl(i.launch.launchAddress) });

  const s = i.staking;
  if (!s || s.state === 'unknown') checks.push({ id: 'creator_staking_pool', status: 'unknown', detail: 'Could not read staking pools right now', evidence: null });
  else {
    const mine = s.pools.find((p) => p.active && p.byCreator);
    const community = s.pools.find((p) => p.active && !p.byCreator);
    if (mine) checks.push({ id: 'creator_staking_pool', status: 'pass', detail: 'Active staking pool created by the token creator', evidence: `${STAKE_URL}/${mine.pool}` });
    else if (community) checks.push({ id: 'creator_staking_pool', status: 'pending', detail: 'Only community pools; badge needs a pool created by the token creator', evidence: `${STAKE_URL}/${community.pool}` });
    else checks.push({ id: 'creator_staking_pool', status: 'pending', detail: 'No creator staking pool', evidence: STAKE_URL });
  }

  const r = i.review;
  const src = i.source && i.source.known ? i.source : null;
  if (r === 'error') checks.push({ id: 'security_clean', status: 'unknown', detail: 'Could not read the security check right now', evidence: null });
  else if (src && !src.verified) checks.push({ id: 'security_clean', status: 'pending', detail: 'Source not verified on Sourcify or Blockscout', evidence: i.launch ? getExplorerAddressUrl(i.launch.tokenAddress) : null });
  else if (!r || r.status === 'pending' || r.status === 'running' || r.status === 'failed') checks.push({ id: 'security_clean', status: 'pending', detail: 'No scan yet', evidence: src?.url ?? null });
  else {
    const ev = src?.url ?? (r.target ? getExplorerAddressUrl(r.target) : null);
    const via = src?.via === 'sourcify' ? 'Sourcify' : src?.via === 'blockscout' ? 'Blockscout' : null;
    if (r.status === 'unsupported' && !src) checks.push({ id: 'security_clean', status: 'pending', detail: 'Source not verified', evidence: ev });
    else if (r.critical > 0) checks.push({ id: 'security_clean', status: 'pending', detail: `${plural(r.critical, 'critical finding')}${r.high ? `, ${r.high} high` : ''}`, evidence: ev });
    else if (r.high > 0) checks.push({ id: 'security_clean', status: 'pending', detail: plural(r.high, 'high finding'), evidence: ev });
    else checks.push({
      id: 'security_clean', status: 'pass',
      detail: `Source verified${via ? ` on ${via}` : ''}; 0 critical and 0 high findings${r.medium > 0 ? `; ${plural(r.medium, 'medium finding')}, see PolyCTO` : ''}`,
      evidence: ev,
    });
  }

  const vest = vestingCheck(i.vesting, now);
  const bond = bondCheck(i.bond, now);
  checks.push(vest, bond);

  const passed = checks.filter((c) => c.status === 'pass').length;
  const tier = computeTier(checks);
  const mirror = (c: HolderCheck): VestingFactor => ({ met: c.status === 'unknown' ? null : c.status === 'pass', detail: c.detail });
  return { version: 2, tier, allPassed: tier === 'gold', passed, total: 5, checks, checkedAt: nowDate.toISOString(), disclaimer: HP_DISCLAIMER, vesting: mirror(vest), bond: mirror(bond) };
}

/** Live reads for many tokens, batched with multicall. Logs each factory call. */
export async function readCreatorFactors(tokens: string[]): Promise<Map<string, { vesting: VestingInput; bond: BondInput }>> {
  const out = new Map<string, { vesting: VestingInput; bond: BondInput }>();
  const vf = vestingFactory();
  const bf = bondFactory();
  const fail = () => { for (const t of tokens) out.set(t.toLowerCase(), { vesting: 'error', bond: 'error' }); return out; };
  if (!tokens.length) return out;
  if (!vf || !bf) return fail();
  try {
    console.log(`[hp] multicall ${vf}.vaultsByToken and ${bf}.bondsByToken for ${tokens.length} token(s)`);
    const lists = await client.multicall({
      allowFailure: true,
      contracts: tokens.flatMap((t) => [
        { address: vf, abi: VESTING_FACTORY_ABI as any, functionName: 'vaultsByToken', args: [t as Address] },
        { address: bf, abi: BOND_FACTORY_ABI as any, functionName: 'bondsByToken', args: [t as Address] },
      ]),
    });
    const vaultsOf = tokens.map((_, k) => lists[2 * k]);
    const bondsOf = tokens.map((_, k) => lists[2 * k + 1]);
    const calls: any[] = [];
    const plan: { kind: 'v' | 'b' | 's'; k: number; addr?: string; at: number }[] = [];
    tokens.forEach((t, k) => {
      const v = vaultsOf[k];
      if (v.status === 'success' && (v.result as Address[]).length) {
        plan.push({ kind: 's', k, at: calls.length }); calls.push({ address: t as Address, abi: erc20Abi, functionName: 'totalSupply' });
        for (const a of v.result as Address[]) {
          plan.push({ kind: 'v', k, addr: a, at: calls.length });
          calls.push({ address: vf, abi: VESTING_FACTORY_ABI, functionName: 'vaultMeetsBadgeMinimum', args: [a] },
            { address: a, abi: VESTING_VAULT_ABI, functionName: 'lockedAmount' }, { address: a, abi: VESTING_VAULT_ABI, functionName: 'cliffEnd' }, { address: a, abi: VESTING_VAULT_ABI, functionName: 'endTime' });
        }
      }
      const b = bondsOf[k];
      if (b.status === 'success') for (const a of b.result as Address[]) {
        plan.push({ kind: 'b', k, addr: a, at: calls.length });
        calls.push(...(['status', 'bondAmount', 'duration', 'endTime'] as const).map((functionName) => ({ address: a, abi: BOND_ABI, functionName })));
      }
    });
    const res = calls.length ? await client.multicall({ allowFailure: true, contracts: calls }) : [];
    const okAll = (at: number, n: number) => res.slice(at, at + n).every((x) => x.status === 'success');
    tokens.forEach((t, k) => {
      let vesting: VestingInput = vaultsOf[k].status === 'success' ? { vaults: [], totalSupply: null } : 'error';
      let bond: BondInput = bondsOf[k].status === 'success' ? { bonds: [] } : 'error';
      for (const p of plan.filter((x) => x.k === k)) {
        if (p.kind === 's' && vesting !== 'error') vesting.totalSupply = res[p.at]?.status === 'success' ? (res[p.at].result as bigint) : null;
        if (p.kind === 'v' && vesting !== 'error') {
          if (!okAll(p.at, 4)) { vesting = 'error'; continue; }
          vesting.vaults.push({ address: p.addr!, meets: res[p.at].result === true, locked: res[p.at + 1].result as bigint, cliffEnd: Number(res[p.at + 2].result), endTime: Number(res[p.at + 3].result) });
        }
        if (p.kind === 'b' && bond !== 'error') {
          if (!okAll(p.at, 4)) { bond = 'error'; continue; }
          bond.bonds.push({ address: p.addr!, status: Number(res[p.at].result), amount: res[p.at + 1].result as bigint, duration: Number(res[p.at + 2].result), endTime: Number(res[p.at + 3].result) });
        }
      }
      out.set(t.toLowerCase(), { vesting, bond });
    });
    const nV = [...out.values()].reduce((s, x) => s + (x.vesting === 'error' ? 0 : x.vesting.vaults.length), 0);
    const nB = [...out.values()].reduce((s, x) => s + (x.bond === 'error' ? 0 : x.bond.bonds.length), 0);
    console.log(`[hp] factory results: ${nV} vault(s), ${nB} bond(s)`);
    return out;
  } catch (e) {
    console.error('holder-protections factory read failed', (e as Error)?.message);
    return fail();
  }
}

async function readReviews(launches: string[]): Promise<Map<string, ReviewInput> | 'error'> {
  try {
    const rows = await prisma.bevorAudit.findMany({ where: { launchAddress: { in: launches.map((a) => a.toLowerCase()) } } });
    return new Map(rows.map((r) => [r.launchAddress.toLowerCase(), { status: r.status, target: r.target, critical: r.critical, high: r.high, medium: r.medium }]));
  } catch (e) {
    console.error('holder-protections review read failed', (e as Error)?.message);
    return 'error';
  }
}

async function readPools() {
  try { return await getAllPools(); } catch { return null; }
}

// ---------- tier history ----------
const lastTier = new Map<string, Tier>();
let lastLoaded = false;
async function loadLast() {
  if (lastLoaded) return;
  const rows = await prisma.holderTierChange.findMany({ orderBy: { createdAt: 'desc' }, distinct: ['launchAddress'], select: { launchAddress: true, newTier: true } });
  for (const r of rows) lastTier.set(r.launchAddress, (r.newTier as Tier) ?? null);
  lastLoaded = true;
}
/** Writes a row when the tier differs from the last stored one (first-ever null is not a change). */
async function recordTier(launch: string, tier: Tier, passed: number) {
  try {
    await loadLast();
    const key = launch.toLowerCase();
    const prev = lastTier.has(key) ? lastTier.get(key)! : null;
    if (prev === tier) return;
    lastTier.set(key, tier);
    await prisma.holderTierChange.create({ data: { launchAddress: key, oldTier: prev, newTier: tier, passed } });
  } catch (e) {
    console.error('holder-protections tier history write failed', (e as Error)?.message);
  }
}
async function readHistory(launch: string): Promise<TierChange[]> {
  const rows = await prisma.holderTierChange.findMany({ where: { launchAddress: launch.toLowerCase() }, orderBy: { createdAt: 'desc' }, take: 10 }).catch(() => []);
  return rows.map((r) => ({ at: r.createdAt.toISOString(), from: (r.oldTier as Tier) ?? null, to: (r.newTier as Tier) ?? null }));
}

const one = new Map<string, { at: number; value: HolderProtections }>();

/** null = not a Polypad factory launch (404). Throws nothing. */
export async function getHolderProtections(address: string): Promise<HolderProtections | null> {
  const key = address.toLowerCase();
  const hit = one.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  if (getExternalToken(address)) return null; // listed (non-factory) tokens never get the checklist
  const { token, missing } = await getLaunchLookup(address, 6_000);
  if (missing) return null;
  const [list, reviews, factors, source] = await Promise.all([
    readPools(),
    token ? readReviews([token.launchAddress]) : Promise.resolve('error' as const),
    token ? readCreatorFactors([token.tokenAddress]) : Promise.resolve(null),
    token ? getSourceVerified([token.tokenAddress, token.launchAddress]).catch(() => null) : Promise.resolve(null),
  ]);
  const staking = list && token ? evaluateStakingStatus(token.tokenAddress, list.pools, list.complete, token.creator, Math.floor(Date.now() / 1000)) : null;
  const review = reviews === 'error' ? 'error' : token ? reviews.get(token.launchAddress.toLowerCase()) ?? null : 'error';
  const f = token ? factors?.get(token.tokenAddress.toLowerCase()) : undefined;
  const value = evaluateHolderProtections({ launch: token, staking, review, source, vesting: f?.vesting ?? 'error', bond: f?.bond ?? 'error' });
  if (token) {
    await recordTier(token.launchAddress, value.tier, value.passed);
    value.history = await readHistory(token.launchAddress);
    one.set(key, { at: Date.now(), value });
  }
  return value;
}

export interface HpLite { passed: number; allPassed: boolean; tier: Tier; token: string; creatorPools: string[] }
let allCache: { at: number; value: Record<string, HpLite> } | null = null;

/** Batch for lists: launch address (lowercase) -> { passed, allPassed, tier, token }. null when launches can't be read. */
export async function getAllHolderProtections(): Promise<Record<string, HpLite> | null> {
  if (allCache && Date.now() - allCache.at < TTL) return allCache.value;
  const launches = await getLaunchesSnapshot(6_000);
  if (!launches) return null;
  const [list, reviews, factors] = await Promise.all([readPools(), readReviews(launches.map((l) => l.launchAddress)), readCreatorFactors(launches.map((l) => l.tokenAddress))]);
  const now = Math.floor(Date.now() / 1000);
  const out: Record<string, HpLite> = {};
  for (const l of launches) {
    const staking = list ? evaluateStakingStatus(l.tokenAddress, list.pools, list.complete, l.creator, now) : null;
    const review = reviews === 'error' ? 'error' : reviews.get(l.launchAddress.toLowerCase()) ?? null;
    const f = factors.get(l.tokenAddress.toLowerCase());
    const single = one.get(l.launchAddress.toLowerCase()) ?? one.get(l.tokenAddress.toLowerCase());
    const hp = single && Date.now() - single.at < TTL ? single.value : evaluateHolderProtections({ launch: l, staking, review, vesting: f?.vesting ?? 'error', bond: f?.bond ?? 'error' });
    out[l.launchAddress.toLowerCase()] = { passed: hp.passed, allPassed: hp.allPassed, tier: hp.tier, token: l.tokenAddress.toLowerCase(), creatorPools: (staking?.pools ?? []).filter((p) => p.active && p.byCreator).map((p) => p.pool.toLowerCase()) };
  }
  allCache = { at: Date.now(), value: out };
  return out;
}
