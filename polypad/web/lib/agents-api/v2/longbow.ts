/**
 * Longbow lending on Morpho Blue (Robinhood Chain) for the Polypad agent API.
 *
 * Longbow is a curated lending protocol on Robinhood Chain. It settles on
 * Morpho Blue (0x9D53…), an immutable, formally verified lending primitive,
 * and curates isolated markets (tokenized stocks, crypto, RWAs) plus three
 * ERC-4626 vaults (Core / Frontier / ETH). Longbow's own contracts are NOT
 * published as audited; the Morpho primitive is. Nothing here is presented
 * as audited, and every prepare summary says so.
 *
 * Data sources (read-only, keyless):
 *   - Longbow REST: GET https://longbow.finance/api/markets (82 markets),
 *     GET https://longbow.finance/api/v2/vaults (3 vaults). Cached 60s.
 *   - Morpho Blue reads through viem (market, position, idToMarketParams).
 *
 * Two phases, one registry:
 *   - Phase 1 (read, live now): markets, market, position, vaults,
 *     plan_multiply. No flag, no signing.
 *   - Phase 2 (prepare, built but gated): supply, borrow, repay,
 *     add_collateral, withdraw_collateral, close, multiply, stake_bow,
 *     claim_rebate. Gated by LONGBOW_PREPARE_ENABLED (default false);
 *     runTool refuses them and tools/list hides them while the flag is off.
 *     The legal memo gates flipping the flag on — this file builds the code,
 *     it never flips the flag.
 *
 * Prepare design (direct Morpho calls, not Bundler3, except multiply):
 * Longbow's own bundles call Morpho directly (supplyCollateral + borrow,
 * deposit into the vault, stake into the staking contract), so these tools
 * do the same. Exact-amount approvals only, never unlimited. Step 1 is
 * simulated; the signing page re-checks later steps. Attribution is OFF for
 * every Longbow prepare: the ERC-8021 suffix must never be appended to
 * third-party (Morpho / vault / staking) calldata.
 *
 * Guardrails (all enforced before anything is built):
 *   - Per-market screen (prepare only): Chainlink-oracled markets only, and
 *     LLTV <= 0.625. Jon-approved exceptions go in LONGBOW_MARKET_ALLOWLIST
 *     (comma-separated market keys, e.g. "ETH,SPY").
 *   - Health factor floor 1.15 on every borrow / withdraw / multiply. The
 *     resulting health factor and liquidation price are in every summary.
 *   - USDG amounts: 25,000 USDG cap per action, confirmLarge above 1,000
 *     USDG (the USDG analogue of the 25 ETH / 1 ETH rules). WETH amounts
 *     use the existing guardAmountWei.
 *   - No flash-loan multiply: the multiply is a single atomic Bundler3
 *     multicall (borrow against existing/new collateral, swap the borrowed
 *     USDG for WETH on Uniswap V4, supply the swapped WETH) — the borrow is
 *     sized so the position stays above the health-factor floor BEFORE the
 *     swap leg, so the swap only improves it. No sequential-steps multiply.
 *
 * Known limits (see the build report for detail):
 *   - claim_rebate refuses with 409: the rebate distributor (0x23e9…) is
 *     verified on-chain, but the exact claim function and the Merkle-proof
 *     source are not, so no claim transaction can be built correctly yet.
 *   - Health factors use Longbow's REST price and Morpho's stored totals,
 *     which are stale since the market's last interaction (interest accrues
 *     lazily). The on-chain simulation is the safety net.
 */
import { encodeFunctionData, getAddress, isAddress, type Hex } from 'viem';
import { bowStakingAbi, bundler3Abi, erc20Abi, erc4626Abi, morphoAbi, permit2Abi, rebateDistributorAbi } from './abis';
import { ADDR, CHAIN_ID, LIMITS } from './config';
import {
  ApiError, assertNotFeeWallet, bodyGuard, cached, ethDisplay, guardAmountWei, optUint, parseUnits10,
  reqAddress, slippageOf, unitsDisplay, type Addr, type Ctx, type Meta,
} from './core';
import { finishPrepared, validReturnUrl, type StepInput } from './prepared';
import { encodeGenericV4Swap } from './prepare-swap';
import { findUniswapPool, resolveSwapToken } from './swap-quotes';
import { RISKS } from './trade';

const LONGBOW_MARKETS_URL = 'https://longbow.finance/api/markets';
const LONGBOW_VAULTS_URL = 'https://longbow.finance/api/v2/vaults';
const FETCH_TIMEOUT_MS = 8_000;
const UA = 'Polypad/2.2 (+https://polypad.family)';

/** Health factor below this is refused. Longbow's own bundles show ~1.27 for a typical borrow; 1.15 leaves a buffer. */
export const LONGBOW_HF_FLOOR = 1.15;
/** Default per-market screen: LLTV at or below this. */
export const LONGBOW_MAX_LLTV = 0.625;
/** USDG cap per prepared action (6 decimals), and the confirmLarge threshold — the USDG analogue of 25 ETH / 1 ETH. */
export const LONGBOW_USDG_MAX = 25_000n * 10n ** 6n;
export const LONGBOW_USDG_CONFIRM = 1_000n * 10n ** 6n;
export const USDG_DECIMALS = 6;

/** Phase 2 flag. Default false; the legal memo gates turning it on. */
export function longbowPrepareEnabled(): boolean {
  return process.env.LONGBOW_PREPARE_ENABLED === 'true';
}

export const LONGBOW_PREPARE_TOOL_NAMES = new Set([
  'polypad_prepare_longbow_supply',
  'polypad_prepare_longbow_borrow',
  'polypad_prepare_longbow_repay',
  'polypad_prepare_longbow_add_collateral',
  'polypad_prepare_longbow_withdraw_collateral',
  'polypad_prepare_longbow_close',
  'polypad_prepare_longbow_multiply',
  'polypad_prepare_longbow_stake_bow',
  'polypad_prepare_longbow_claim_rebate',
]);

export function isLongbowPrepareTool(name: string): boolean {
  return LONGBOW_PREPARE_TOOL_NAMES.has(name);
}

/** Market keys Jon has approved as exceptions to the per-market screen (comma-separated, e.g. "ETH,SPY"). */
function marketAllowlist(): Set<string> {
  return new Set(
    (process.env.LONGBOW_MARKET_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// ---------------------------------------------------------------- REST

async function fetchLongbowJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': UA } });
  } catch {
    throw new ApiError(503, 'longbow_unavailable', 'Longbow did not answer. Try again shortly.');
  }
  if (!res.ok) throw new ApiError(503, 'longbow_unavailable', `Longbow did not answer (HTTP ${res.status}). Try again shortly.`);
  return res.json() as Promise<unknown>;
}

export type LongbowMarket = {
  key: string;
  name: string;
  symbol: string;
  category: string;
  status: string;
  loan: string;
  price: number;
  lltv: number;
  oracleLabel: string;
  oracleType: string;
  marketId: string;
  collateralAddress: Addr;
  loanAddress: Addr;
  borrowAPR: number;
  supplyAPR: number;
  utilization: number;
  cap: number;
  totalSupply: number;
  totalBorrow: number;
  enabled: boolean;
  isMemeMarket: boolean;
  availableToBorrow: number;
};

export type LongbowVaultMarket = {
  key: string;
  marketId: string;
  symbol: string;
  supplyAPR: number;
  cap: number;
  lltv: number;
  collateralAddress: Addr;
};

export type LongbowVault = {
  key: string;
  name: string;
  symbol: string;
  address: Addr;
  asset: Addr;
  assetSymbol: string;
  decimals: number;
  risk: string;
  status: string;
  closed: boolean;
  tvl: number;
  apy: number;
  performanceFee: number;
  idle: number;
  allocated: number;
  withdrawableNow: number;
  totalShares: number;
  markets: LongbowVaultMarket[];
};

function asMarket(raw: Record<string, unknown>): LongbowMarket {
  const s = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
  const n = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
  const marketId = s('marketId');
  const collateral = s('collateralAddress');
  const loan = s('loanAddress');
  if (!/^0x[0-9a-fA-F]{64}$/.test(marketId) || !isAddress(collateral) || !isAddress(loan)) {
    throw new ApiError(503, 'longbow_unavailable', 'Longbow returned a market in an unexpected shape.');
  }
  return {
    key: s('key'),
    name: s('name'),
    symbol: s('symbol'),
    category: s('category'),
    status: s('status'),
    loan: s('loan'),
    price: n('price'),
    lltv: n('lltv'),
    oracleLabel: s('oracleLabel'),
    oracleType: s('oracleType'),
    marketId: marketId.toLowerCase(),
    collateralAddress: getAddress(collateral),
    loanAddress: getAddress(loan),
    borrowAPR: n('borrowAPR'),
    supplyAPR: n('supplyAPR'),
    utilization: n('utilization'),
    cap: n('cap'),
    totalSupply: n('totalSupply'),
    totalBorrow: n('totalBorrow'),
    enabled: raw.enabled === true,
    isMemeMarket: raw.isMemeMarket === true,
    availableToBorrow: n('availableToBorrow'),
  };
}

function asVault(raw: Record<string, unknown>): LongbowVault {
  const s = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
  const n = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
  const address = s('address');
  const asset = s('asset');
  if (!isAddress(address) || !isAddress(asset)) throw new ApiError(503, 'longbow_unavailable', 'Longbow returned a vault in an unexpected shape.');
  const markets = Array.isArray(raw.markets)
    ? (raw.markets as Record<string, unknown>[]).map((m) => ({
        key: typeof m.key === 'string' ? m.key : '',
        marketId: typeof m.marketId === 'string' ? (m.marketId as string).toLowerCase() : '',
        symbol: typeof m.symbol === 'string' ? m.symbol : '',
        supplyAPR: typeof m.supplyAPR === 'number' ? m.supplyAPR : 0,
        cap: typeof m.cap === 'number' ? m.cap : 0,
        lltv: typeof m.lltv === 'number' ? m.lltv : 0,
        collateralAddress: (typeof m.collateralAddress === 'string' && isAddress(m.collateralAddress) ? getAddress(m.collateralAddress) : ADDR.weth) as Addr,
      }))
    : [];
  return {
    key: s('key'),
    name: s('name'),
    symbol: s('symbol'),
    address: getAddress(address),
    asset: getAddress(asset),
    assetSymbol: s('assetSymbol'),
    decimals: typeof raw.decimals === 'number' ? raw.decimals : 18,
    risk: s('risk'),
    status: s('status'),
    closed: raw.closed === true,
    tvl: n('tvl'),
    apy: n('apy'),
    performanceFee: n('performanceFee'),
    idle: n('idle'),
    allocated: n('allocated'),
    withdrawableNow: n('withdrawableNow'),
    totalShares: n('totalShares'),
    markets,
  };
}

export async function fetchLongbowMarkets(ctx: Ctx): Promise<LongbowMarket[]> {
  return cached(ctx, 'longbow-markets', 60_000, async () => {
    const j = await fetchLongbowJson(LONGBOW_MARKETS_URL);
    if (!Array.isArray(j)) throw new ApiError(503, 'longbow_unavailable', 'Longbow returned markets in an unexpected shape.');
    return (j as Record<string, unknown>[]).map(asMarket);
  });
}

export async function fetchLongbowVaults(ctx: Ctx): Promise<LongbowVault[]> {
  return cached(ctx, 'longbow-vaults', 60_000, async () => {
    const j = await fetchLongbowJson(LONGBOW_VAULTS_URL);
    const arr = (j as { vaults?: unknown }).vaults;
    if (!Array.isArray(arr)) throw new ApiError(503, 'longbow_unavailable', 'Longbow returned vaults in an unexpected shape.');
    return (arr as Record<string, unknown>[]).map(asVault);
  });
}

/** Resolve a market by key, symbol, name, or marketId. Prefers an exact key match. */
export async function resolveLongbowMarket(ctx: Ctx, ref: unknown): Promise<LongbowMarket> {
  const raw = String(ref ?? '').trim();
  if (!raw) throw new ApiError(400, 'invalid_params', 'market is required: a market key (ETH, NVDA, SPY), symbol, name, or marketId.', { field: 'market' });
  const markets = await fetchLongbowMarkets(ctx);
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    const hit = markets.find((m) => m.marketId === raw.toLowerCase());
    if (!hit) throw new ApiError(404, 'not_found', `No Longbow market has marketId ${raw.slice(0, 18)}….`);
    return hit;
  }
  const q = raw.toLowerCase();
  const byKey = markets.filter((m) => m.key.toLowerCase() === q);
  if (byKey.length === 1) return byKey[0];
  const bySymbol = markets.filter((m) => m.symbol.toLowerCase() === q);
  if (bySymbol.length === 1) return bySymbol[0];
  const byName = markets.filter((m) => m.name.toLowerCase() === q || m.name.toLowerCase().startsWith(q));
  const hits = [...byKey, ...bySymbol, ...byName].filter((m, i, a) => a.indexOf(m) === i);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new ApiError(409, 'ambiguous_market', `More than one Longbow market matches "${raw}". Use the market key or marketId.`, {
      matches: hits.slice(0, 8).map((m) => ({ key: m.key, name: m.name, marketId: m.marketId })),
    });
  }
  throw new ApiError(404, 'not_found', `No Longbow market matches "${raw}". List them with polypad_longbow_markets.`);
}

/** Resolve a vault by key (core, frontier, eth) or address. */
export async function resolveLongbowVault(ctx: Ctx, ref: unknown): Promise<LongbowVault> {
  const raw = String(ref ?? '').trim();
  if (!raw) throw new ApiError(400, 'invalid_params', 'vault is required: core, frontier, or eth (or the vault address).', { field: 'vault' });
  const vaults = await fetchLongbowVaults(ctx);
  if (isAddress(raw)) {
    const hit = vaults.find((v) => v.address.toLowerCase() === raw.toLowerCase());
    if (!hit) throw new ApiError(404, 'not_found', `No Longbow vault has address ${raw}.`);
    return hit;
  }
  const q = raw.toLowerCase();
  const hit = vaults.find((v) => v.key.toLowerCase() === q || v.name.toLowerCase() === q || v.symbol.toLowerCase() === q);
  if (!hit) throw new ApiError(404, 'not_found', `No Longbow vault matches "${raw}". Use core, frontier, or eth.`);
  return hit;
}

// ---------------------------------------------------------------- Morpho reads + math

export type MarketParams = readonly [Addr, Addr, Addr, Addr, bigint];

export async function marketParamsOf(ctx: Ctx, marketId: string): Promise<MarketParams> {
  const p = await ctx.client.readContract({
    address: ADDR.morpho, abi: morphoAbi, functionName: 'idToMarketParams', args: [marketId as `0x${string}`],
  });
  return [p[0], p[1], p[2], p[3], p[4]];
}

export type MorphoMarketState = {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
};

export async function marketStateOf(ctx: Ctx, marketId: string): Promise<MorphoMarketState> {
  const m = await ctx.client.readContract({
    address: ADDR.morpho, abi: morphoAbi, functionName: 'market', args: [marketId as `0x${string}`],
  });
  return {
    totalSupplyAssets: m[0], totalSupplyShares: m[1], totalBorrowAssets: m[2],
    totalBorrowShares: m[3], lastUpdate: m[4], fee: m[5],
  };
}

export type MorphoPosition = { supplyShares: bigint; borrowShares: bigint; collateral: bigint };

export async function positionOf(ctx: Ctx, marketId: string, user: Addr): Promise<MorphoPosition> {
  const p = await ctx.client.readContract({
    address: ADDR.morpho, abi: morphoAbi, functionName: 'position', args: [marketId as `0x${string}`, user],
  });
  return { supplyShares: p[0], borrowShares: p[1], collateral: p[2] };
}

/** Morpho SharesMathLib: VIRTUAL_SHARES 1e6, VIRTUAL_ASSETS 1. "Down" rounds against the caller, which is the safe direction here. */
const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;

export function toAssetsDown(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (shares * (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
}

export function toSharesDown(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (assets * (totalShares + VIRTUAL_SHARES)) / (totalAssets + VIRTUAL_ASSETS);
}

/**
 * Health factor = (collateral value x LLTV) / debt. Infinity when there is no
 * debt. Uses Longbow's REST price and Morpho's stored totals, which are stale
 * since the market's last interaction — the on-chain simulation is the safety
 * net, and every summary says the figure is a reading.
 */
export function healthFactor(collateralBase: bigint, collateralDec: number, priceUsd: number, lltv: number, debtBase: bigint, loanDec: number): number {
  if (debtBase <= 0n) return Number.POSITIVE_INFINITY;
  const collateralValue = (Number(collateralBase) / 10 ** collateralDec) * priceUsd;
  const debtValue = Number(debtBase) / 10 ** loanDec;
  if (debtValue <= 0) return Number.POSITIVE_INFINITY;
  return (collateralValue * lltv) / debtValue;
}

/** The collateral price at which the health factor hits 1 (liquidation). Null when there is no position. */
export function liquidationPrice(collateralBase: bigint, collateralDec: number, lltv: number, debtBase: bigint, loanDec: number): number | null {
  if (collateralBase <= 0n || debtBase <= 0n || lltv <= 0) return null;
  const collateral = Number(collateralBase) / 10 ** collateralDec;
  const debt = Number(debtBase) / 10 ** loanDec;
  return debt / (collateral * lltv);
}

export function fmtHf(hf: number): string {
  if (!Number.isFinite(hf)) return 'no debt';
  return hf.toFixed(2);
}

async function tokenDecimals(ctx: Ctx, token: Addr): Promise<number> {
  return cached(ctx, `longbow-decimals:${token.toLowerCase()}`, 3_600_000, async () => {
    try {
      const d = await ctx.client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' });
      return Number(d);
    } catch {
      return 18;
    }
  });
}

// ---------------------------------------------------------------- guards

/** Per-market screen for prepare tools. Reads are never screened. */
export function screenMarket(m: LongbowMarket): { ok: true } | { ok: false; reason: string } {
  const allow = marketAllowlist();
  if (allow.has(m.key.toLowerCase()) || allow.has(m.symbol.toLowerCase())) return { ok: true };
  if (!m.enabled || m.status !== 'live') {
    return { ok: false, reason: `The ${m.symbol} market is not live on Longbow right now (status ${m.status}, enabled ${m.enabled}).` };
  }
  if (m.oracleType !== 'chainlink') {
    return { ok: false, reason: `The ${m.symbol} market is priced by ${m.oracleType} (${m.oracleLabel}), not Chainlink. Longbow prepares only use Chainlink-priced markets by default; Jon can allowlist this market with LONGBOW_MARKET_ALLOWLIST.` };
  }
  if (m.lltv > LONGBOW_MAX_LLTV) {
    return { ok: false, reason: `The ${m.symbol} market lets a borrower take up to ${(m.lltv * 100).toFixed(0)}% of the collateral value (LLTV), above the ${(LONGBOW_MAX_LLTV * 100).toFixed(0)}% limit for Longbow prepares. Jon can allowlist this market with LONGBOW_MARKET_ALLOWLIST.` };
  }
  return { ok: true };
}

function requireScreen(m: LongbowMarket): void {
  const s = screenMarket(m);
  if (!s.ok) throw new ApiError(409, 'market_not_approved', s.reason, { market: m.key, oracleType: m.oracleType, lltv: m.lltv });
}

/** USDG analogue of guardAmountWei: 25,000 USDG cap per action, confirmLarge above 1,000 USDG. */
export function guardUsdgAmount(amount: bigint, input: Record<string, unknown>, label = 'amount'): void {
  if (amount <= 0n) throw new ApiError(400, 'invalid_params', `${label} must be above zero.`);
  if (amount > LONGBOW_USDG_MAX) {
    throw new ApiError(400, 'amount_too_large', `${label} is above the 25,000 USDG cap for one prepared action. Split it into smaller actions.`);
  }
  if (amount > LONGBOW_USDG_CONFIRM && input.confirmLarge !== true) {
    throw new ApiError(400, 'confirm_large_required', `${label} is above 1,000 USDG. Ask the user to confirm the amount, then resend with "confirmLarge": true.`);
  }
}

/** Parse a plain decimal ("100", "0.5") into base units. */
export function parseDecimalUnits(v: unknown, decimals: number, field: string): bigint {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  if (!/^\d+(\.\d+)?$/.test(s)) throw new ApiError(400, 'invalid_params', `${field} must be a plain decimal number such as 100 or 0.5.`, { field });
  const [w, f = ''] = s.split('.');
  if (f.length > decimals) throw new ApiError(400, 'invalid_params', `${field} has more decimal places than the token supports (${decimals}).`, { field });
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0') || '0');
}

/**
 * Amount input convention (mirrors prepareBuy's amountEth/amountWei):
 * a decimal field (100.5 USDG) or a base-units field. Exactly one is needed.
 */
export function parseTokenAmount(input: Record<string, unknown>, decimals: number, decimalField: string, baseField: string, label: string): bigint {
  const dec = input[decimalField];
  if (dec !== undefined && dec !== '') return parseDecimalUnits(dec, decimals, decimalField);
  const base = input[baseField];
  if (base !== undefined && base !== '') return parseUnits10(base, baseField);
  throw new ApiError(400, 'invalid_params', `Provide ${label} as ${decimalField} (a decimal, e.g. 100) or ${baseField} (base units).`, { field: decimalField });
}

function boolFlag(input: Record<string, unknown>, field: string): boolean {
  return input[field] === true || input[field] === 'true' || input[field] === '1';
}

/** The contract addresses a prepare response names, so the /sign page permits the steps. */
function contractsExtra(addrs: Record<string, string>): Record<string, unknown> {
  return { contracts: addrs };
}

function marketView(m: LongbowMarket): Record<string, unknown> {
  return {
    key: m.key, name: m.name, symbol: m.symbol, category: m.category, status: m.status,
    loan: m.loan, price: m.price, priceDisplay: `$${m.price.toLocaleString('en-US', { maximumFractionDigits: 4 })}`,
    lltv: m.lltv, maxLtvPct: `${(m.lltv * 100).toFixed(1)}%`,
    oracle: m.oracleLabel, oracleType: m.oracleType,
    marketId: m.marketId, collateralAddress: m.collateralAddress, loanAddress: m.loanAddress,
    borrowAPR: m.borrowAPR, supplyAPR: m.supplyAPR, utilization: m.utilization,
    cap: m.cap, totalSupply: m.totalSupply, totalBorrow: m.totalBorrow,
    availableToBorrow: m.availableToBorrow, enabled: m.enabled, isMemeMarket: m.isMemeMarket,
  };
}

// ---------------------------------------------------------------- Phase 1: read tools

export async function listLongbowMarkets(ctx: Ctx, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const markets = await fetchLongbowMarkets(ctx);
  const category = typeof input.category === 'string' && input.category !== '' ? input.category.trim().toLowerCase() : undefined;
  const oracleType = typeof input.oracleType === 'string' && input.oracleType !== '' ? input.oracleType.trim().toLowerCase() : undefined;
  const liveOnly = input.liveOnly === undefined ? true : boolFlag(input, 'liveOnly');
  const limit = optUint(input.limit, 'limit', 50, 1, 100);
  let list = markets;
  if (liveOnly) list = list.filter((m) => m.enabled && m.status === 'live');
  if (category) list = list.filter((m) => m.category.toLowerCase() === category);
  if (oracleType) list = list.filter((m) => m.oracleType.toLowerCase() === oracleType);
  const shown = list.slice(0, limit);
  return {
    ok: true,
    chainId: CHAIN_ID,
    source: 'Longbow REST (longbow.finance/api/markets), cached 60s',
    total: markets.length,
    live: markets.filter((m) => m.enabled && m.status === 'live').length,
    showing: shown.length,
    markets: shown.map(marketView),
    reading: 'Prices and rates are one reading at one moment. Longbow settles on Morpho Blue; Longbow\u2019s own contracts are not published as audited.',
  };
}

export async function getLongbowMarket(ctx: Ctx, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const m = await resolveLongbowMarket(ctx, input.market ?? input.symbol ?? input.key);
  const state = await marketStateOf(ctx, m.marketId).catch(() => null);
  const screen = screenMarket(m);
  return {
    ok: true,
    chainId: CHAIN_ID,
    market: marketView(m),
    onchain: state
      ? {
          totalSupplyAssets: state.totalSupplyAssets.toString(),
          totalSupplyShares: state.totalSupplyShares.toString(),
          totalBorrowAssets: state.totalBorrowAssets.toString(),
          totalBorrowShares: state.totalBorrowShares.toString(),
          lastUpdate: Number(state.lastUpdate),
          fee: state.fee.toString(),
          note: 'Totals are as of the market\u2019s last interaction; interest accrues lazily.',
        }
      : null,
    prepareScreen: screen.ok
      ? { approved: true, note: 'This market passes the prepare screen (Chainlink-priced, LLTV within the limit).' }
      : { approved: false, reason: screen.reason },
    reading: 'A reading, not a promise. Borrowing against a position can lose the collateral if the price falls.',
  };
}

export async function getLongbowPosition(ctx: Ctx, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const m = await resolveLongbowMarket(ctx, input.market ?? input.symbol ?? input.key);
  const user = reqAddress(input, 'address');
  const [pos, state] = await Promise.all([positionOf(ctx, m.marketId, user), marketStateOf(ctx, m.marketId)]);
  const collateralDec = await tokenDecimals(ctx, m.collateralAddress);
  const loanDec = await tokenDecimals(ctx, m.loanAddress);
  const suppliedAssets = toAssetsDown(pos.supplyShares, state.totalSupplyAssets, state.totalSupplyShares);
  const borrowedAssets = toAssetsDown(pos.borrowShares, state.totalBorrowAssets, state.totalBorrowShares);
  const hf = healthFactor(pos.collateral, collateralDec, m.price, m.lltv, borrowedAssets, loanDec);
  const liq = liquidationPrice(pos.collateral, collateralDec, m.lltv, borrowedAssets, loanDec);
  const collateralValue = (Number(pos.collateral) / 10 ** collateralDec) * m.price;
  const debtValue = Number(borrowedAssets) / 10 ** loanDec;
  return {
    ok: true,
    chainId: CHAIN_ID,
    market: marketView(m),
    address: user,
    position: {
      collateral: pos.collateral.toString(),
      collateralDisplay: `${unitsDisplay(pos.collateral, collateralDec)} ${m.symbol}`,
      collateralValueUsd: collateralValue,
      supplyShares: pos.supplyShares.toString(),
      suppliedAssets: suppliedAssets.toString(),
      suppliedAssetsDisplay: `${unitsDisplay(suppliedAssets, loanDec)} ${m.loan}`,
      borrowShares: pos.borrowShares.toString(),
      borrowedAssets: borrowedAssets.toString(),
      borrowedAssetsDisplay: `${unitsDisplay(borrowedAssets, loanDec)} ${m.loan}`,
      debtValueUsd: debtValue,
      healthFactor: Number.isFinite(hf) ? Number(hf.toFixed(4)) : null,
      healthFactorDisplay: fmtHf(hf),
      liquidationPrice: liq,
      liquidationPriceDisplay: liq === null ? null : `$${liq.toLocaleString('en-US', { maximumFractionDigits: 2 })} per ${m.symbol}`,
      atRisk: Number.isFinite(hf) && hf < 1.15,
    },
    note: 'Health factor and liquidation price use Longbow\u2019s price and Morpho\u2019s stored totals, which are stale since the market\u2019s last interaction. Below 1.15 the position is close to liquidation; at 1.0 it can be liquidated.',
  };
}

export async function listLongbowVaults(ctx: Ctx, _input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const vaults = await fetchLongbowVaults(ctx);
  return {
    ok: true,
    chainId: CHAIN_ID,
    source: 'Longbow REST (longbow.finance/api/v2/vaults), cached 60s',
    vaults: vaults.map((v) => ({
      key: v.key, name: v.name, symbol: v.symbol, address: v.address,
      asset: v.asset, assetSymbol: v.assetSymbol, decimals: v.decimals,
      risk: v.risk, status: v.status, closed: v.closed,
      tvlUsd: v.tvl, apy: v.apy, performanceFee: v.performanceFee,
      idle: v.idle, allocated: v.allocated, withdrawableNow: v.withdrawableNow, totalShares: v.totalShares,
      marketCount: v.markets.length,
      markets: v.markets.map((mk) => ({ key: mk.key, marketId: mk.marketId, symbol: mk.symbol, supplyAPR: mk.supplyAPR, cap: mk.cap, lltv: mk.lltv })),
    })),
    reading: 'Vaults are ERC-4626 MetaMorpho vaults curated by Longbow. APY is a reading, not a promise. Longbow\u2019s own contracts are not published as audited.',
  };
}

/**
 * Leverage analysis for a multiply: borrow USDG against collateral, swap it
 * for more of the same collateral, supply it — one atomic bundle. No flash
 * loan: the borrow is sized so the position stays above the health-factor
 * floor BEFORE the swap, so the swap only improves it. WETH-collateral
 * markets only (the swap leg is USDG -> WETH on Uniswap V4).
 */
export async function planLongbowMultiply(ctx: Ctx, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const m = await resolveLongbowMarket(ctx, input.market ?? input.symbol ?? input.key);
  const slip = slippageOf(input);
  if (m.collateralAddress.toLowerCase() !== ADDR.weth.toLowerCase()) {
    return {
      ok: true, chainId: CHAIN_ID, market: marketView(m), feasible: false,
      reason: `Multiply needs a WETH-collateral market: the swap leg turns borrowed USDG into WETH. The ${m.symbol} market uses ${m.collateralAddress} as collateral, which has no reliable USDG swap route here.`,
    };
  }
  const newCollateral = parseTokenAmount(input, 18, 'collateralAmountEth', 'collateralAmount', 'collateral');
  if (newCollateral < 0n) throw new ApiError(400, 'invalid_params', 'collateralAmount must be above zero or omitted.', { field: 'collateralAmount' });
  const borrowAmount = parseTokenAmount(input, USDG_DECIMALS, 'borrowAmountUsdg', 'amount', 'borrow amount');
  guardUsdgAmount(borrowAmount, input, 'borrow amount');
  const user = input.address !== undefined && input.address !== '' ? reqAddress(input, 'address') : null;
  let existingCollateral = 0n;
  let existingDebt = 0n;
  if (user) {
    const [pos, state] = await Promise.all([positionOf(ctx, m.marketId, user), marketStateOf(ctx, m.marketId)]);
    existingCollateral = pos.collateral;
    existingDebt = toAssetsDown(pos.borrowShares, state.totalBorrowAssets, state.totalBorrowShares);
  }
  const totalCollateral = existingCollateral + newCollateral;
  const totalCollateralValue = (Number(totalCollateral) / 1e18) * m.price;
  const existingDebtValue = Number(existingDebt) / 10 ** USDG_DECIMALS;
  const borrowValue = Number(borrowAmount) / 10 ** USDG_DECIMALS;
  // Max new borrow that keeps HF >= floor against the collateral BEFORE the swap.
  const maxBorrowValue = Math.max(0, (totalCollateralValue * m.lltv) / LONGBOW_HF_FLOOR - existingDebtValue);
  const maxBorrowBase = BigInt(Math.floor(maxBorrowValue * 10 ** USDG_DECIMALS));
  if (borrowValue > maxBorrowValue) {
    return {
      ok: true, chainId: CHAIN_ID, market: marketView(m), feasible: false,
      reason: `Borrowing ${borrowValue.toLocaleString('en-US')} USDG would leave the health factor below ${LONGBOW_HF_FLOOR}. The most this collateral supports at that floor is about ${maxBorrowValue.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDG.`,
      collateralValueUsd: totalCollateralValue, existingDebtUsd: existingDebtValue,
      maxBorrowUsdg: maxBorrowValue, maxBorrowBaseUnits: maxBorrowBase.toString(),
      healthFactorFloor: LONGBOW_HF_FLOOR,
    };
  }
  const usdg = await resolveSwapToken(ctx, 'usdg');
  const weth = await resolveSwapToken(ctx, 'weth');
  const pool = await findUniswapPool(ctx, usdg, weth, borrowAmount);
  if (!pool) {
    return {
      ok: true, chainId: CHAIN_ID, market: marketView(m), feasible: false,
      reason: 'No Uniswap V4 pool on Robinhood Chain quoted USDG -> WETH at any probed fee tier, so the swap leg cannot be priced.',
    };
  }
  const minOut = (pool.out * BigInt(10_000 - slip)) / 10_000n;
  const finalCollateral = totalCollateral + minOut;
  const finalDebt = existingDebt + borrowAmount;
  const finalHf = healthFactor(finalCollateral, 18, m.price, m.lltv, finalDebt, USDG_DECIMALS);
  const finalLiq = liquidationPrice(finalCollateral, 18, m.lltv, finalDebt, USDG_DECIMALS);
  const ownCapitalValue = totalCollateralValue;
  const finalValue = (Number(finalCollateral) / 1e18) * m.price;
  const leverage = ownCapitalValue > 0 ? finalValue / ownCapitalValue : null;
  const screen = screenMarket(m);
  return {
    ok: true,
    chainId: CHAIN_ID,
    market: marketView(m),
    feasible: true,
    prepareScreen: screen.ok ? { approved: true } : { approved: false, reason: screen.reason },
    inputs: {
      newCollateral: newCollateral.toString(),
      newCollateralDisplay: `${ethDisplay(newCollateral)} WETH`,
      existingCollateral: existingCollateral.toString(),
      borrowAmount: borrowAmount.toString(),
      borrowAmountDisplay: `${unitsDisplay(borrowAmount, USDG_DECIMALS)} USDG`,
      slippageBps: slip,
    },
    swap: {
      venue: 'Uniswap V4',
      feePct: pool.fee === 0 ? '0' : String(pool.fee / 10000),
      expectedOut: pool.out.toString(),
      expectedOutDisplay: `${ethDisplay(pool.out)} WETH`,
      minOut: minOut.toString(),
      minOutDisplay: `${ethDisplay(minOut)} WETH`,
    },
    result: {
      finalCollateral: finalCollateral.toString(),
      finalCollateralDisplay: `${ethDisplay(finalCollateral)} WETH`,
      finalDebt: finalDebt.toString(),
      finalDebtDisplay: `${unitsDisplay(finalDebt, USDG_DECIMALS)} USDG`,
      healthFactor: Number(finalHf.toFixed(4)),
      healthFactorDisplay: fmtHf(finalHf),
      liquidationPrice: finalLiq,
      liquidationPriceDisplay: finalLiq === null ? null : `$${finalLiq.toLocaleString('en-US', { maximumFractionDigits: 2 })} per WETH`,
      leverage: leverage === null ? null : Number(leverage.toFixed(3)),
      maxBorrowUsdg: maxBorrowValue,
    },
    healthFactorFloor: LONGBOW_HF_FLOOR,
    note: 'The borrow is sized against the collateral before the swap, so the health factor is above the floor at every step. Figures use the minimum swap output (after slippage); a better fill only improves them. Multiply is a prepare tool and is gated by the flag until the legal review is complete.',
  };
}

// ---------------------------------------------------------------- Phase 2: prepare tools (flag-gated)

const LONGBOW_RISKS = [
  'Longbow\u2019s own contracts are not published as audited. Morpho Blue, the lending primitive underneath, is formally verified and heavily audited — but the Longbow curation layer, vaults, and staking contract are not.',
  'Borrowing can lose the collateral: if the collateral price falls far enough, the position can be liquidated.',
  'Prices and health factors here are readings, not promises. They can move between this reading and signing.',
];

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

type BundleCall = readonly [Addr, Hex, bigint, boolean, Hex];

function bundleCall(to: Addr, data: Hex): BundleCall {
  return [to, data, 0n, false, ZERO_HASH];
}

async function tokenBalance(ctx: Ctx, token: Addr, user: Addr): Promise<bigint> {
  return (await ctx.client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [user] })) as bigint;
}

async function tokenAllowance(ctx: Ctx, token: Addr, owner: Addr, spender: Addr): Promise<bigint> {
  return (await ctx.client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] })) as bigint;
}

function approveStep(token: Addr, spender: Addr, amount: bigint, description: string, simulate: boolean): StepInput {
  return {
    kind: 'approve',
    description,
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
    value: 0n,
    simulate,
  };
}

export async function prepareLongbowSupply(ctx: Ctx, rawInput: unknown, meta: Meta): Promise<Record<string, unknown>> {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const vault = await resolveLongbowVault(ctx, input.vault);
  if (vault.closed || vault.status !== 'live') {
    throw new ApiError(409, 'vault_not_live', `The ${vault.name} vault is not live right now (status ${vault.status}).`);
  }
  const isUsdg = vault.asset.toLowerCase() === ADDR.usdg.toLowerCase();
  const amount = isUsdg
    ? parseTokenAmount(input, USDG_DECIMALS, 'amountUsdg', 'amount', 'amount')
    : parseTokenAmount(input, vault.decimals, 'amountEth', 'amount', 'amount');
  if (isUsdg) guardUsdgAmount(amount, input, 'amount');
  else guardAmountWei(amount, input, 'amount');
  const bal = await tokenBalance(ctx, vault.asset, from);
  if (bal < amount) {
    throw new ApiError(409, 'insufficient_balance', `The wallet holds ${unitsDisplay(bal, vault.decimals)} ${vault.assetSymbol}, less than the ${unitsDisplay(amount, vault.decimals)} ${vault.assetSymbol} requested.`, { balance: bal.toString() });
  }
  const expectedShares = await ctx.client.readContract({ address: vault.address, abi: erc4626Abi, functionName: 'convertToShares', args: [amount] }).catch(() => null);
  const steps: StepInput[] = [
    approveStep(vault.asset, vault.address, amount, `Approve the ${vault.name} vault to take exactly this much ${vault.assetSymbol}.`, true),
    {
      kind: 'supply',
      description: `Deposit into the ${vault.name} vault. Send after the approval is confirmed.`,
      to: vault.address,
      data: encodeFunctionData({ abi: erc4626Abi, functionName: 'deposit', args: [amount, from] }),
      value: 0n,
      simulate: false,
    },
  ];
  const headline = `Supply ${unitsDisplay(amount, vault.decimals)} ${vault.assetSymbol} to the ${vault.name} vault`;
  const lines = [
    `Vault: ${vault.name} (${vault.risk} risk, ${vault.apy}% APY right now)`,
    `You supply: ${unitsDisplay(amount, vault.decimals)} ${vault.assetSymbol}`,
    expectedShares !== null ? `Expected shares: about ${unitsDisplay(expectedShares as bigint, vault.decimals)} ${vault.symbol}` : 'Shares are set by the vault at deposit time.',
    `Performance fee: ${(vault.performanceFee * 100).toFixed(0)}% of yield. Withdrawable now: about $${vault.withdrawableNow.toLocaleString('en-US')} across the vault.`,
    'This takes 2 wallet confirmations: approve, then deposit.',
    'The vault lends your deposit into Longbow markets. Yield is a reading, not a promise.',
  ];
  return finishPrepared(ctx, {
    action: 'longbow-supply',
    signParams: { v: vault.key, amt: amount.toString() },
    from,
    steps,
    meta,
    allowTargets: [vault.address, vault.asset],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: { headline, lines, youPay: `${unitsDisplay(amount, vault.decimals)} ${vault.assetSymbol}`, risks: LONGBOW_RISKS },
    attribute: false,
    extra: {
      ...contractsExtra({ vault: vault.address, asset: vault.asset }),
      vault: { key: vault.key, name: vault.name, address: vault.address, assetSymbol: vault.assetSymbol, apy: vault.apy, risk: vault.risk },
      amount: amount.toString(),
    },
  });
}

export async function prepareLongbowBorrow(ctx: Ctx, rawInput: unknown, meta: Meta): Promise<Record<string, unknown>> {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const m = await resolveLongbowMarket(ctx, input.market ?? input.symbol ?? input.key);
  requireScreen(m);
  const borrowAmount = parseTokenAmount(input, USDG_DECIMALS, 'amountUsdg', 'amount', 'borrow amount');
  guardUsdgAmount(borrowAmount, input, 'borrow amount');
  const params = await marketParamsOf(ctx, m.marketId);
  const [pos, state] = await Promise.all([positionOf(ctx, m.marketId, from), marketStateOf(ctx, m.marketId)]);
  const collateralDec = await tokenDecimals(ctx, m.collateralAddress);
  const loanDec = await tokenDecimals(ctx, m.loanAddress);
  const existingDebt = toAssetsDown(pos.borrowShares, state.totalBorrowAssets, state.totalBorrowShares);
  // Optional new collateral supplied in the same prepare (Longbow's borrow bundle does both).
  let newCollateral = 0n;
  const hasCollateralInput = input.collateralAmount !== undefined && input.collateralAmount !== '' || input.collateralAmountEth !== undefined && input.collateralAmountEth !== '';
  if (hasCollateralInput) {
    newCollateral = m.collateralAddress.toLowerCase() === ADDR.weth.toLowerCase()
      ? parseTokenAmount(input, 18, 'collateralAmountEth', 'collateralAmount', 'collateral')
      : parseUnits10(input.collateralAmount, 'collateralAmount');
    if (newCollateral <= 0n) throw new ApiError(400, 'invalid_params', 'collateralAmount must be above zero.', { field: 'collateralAmount' });
    if (m.collateralAddress.toLowerCase() === ADDR.weth.toLowerCase()) guardAmountWei(newCollateral, input, 'collateralAmount');
    const cbal = await tokenBalance(ctx, m.collateralAddress, from);
    if (cbal < newCollateral) {
      throw new ApiError(409, 'insufficient_balance', `The wallet holds ${unitsDisplay(cbal, collateralDec)} ${m.symbol}, less than the ${unitsDisplay(newCollateral, collateralDec)} ${m.symbol} requested.`, { balance: cbal.toString() });
    }
  }
  const totalCollateral = pos.collateral + newCollateral;
  if (totalCollateral <= 0n) {
    throw new ApiError(409, 'no_collateral', `The wallet has no ${m.symbol} collateral in the ${m.symbol} market. Supply collateral first (polypad_prepare_longbow_add_collateral), or pass collateralAmount to supply it in this same action.`);
  }
  if (m.availableToBorrow > 0 && Number(borrowAmount) / 10 ** USDG_DECIMALS > m.availableToBorrow) {
    throw new ApiError(409, 'market_illiquid', `The ${m.symbol} market only has about ${m.availableToBorrow.toLocaleString('en-US')} USDG available to borrow right now.`);
  }
  const newDebt = existingDebt + borrowAmount;
  const hf = healthFactor(totalCollateral, collateralDec, m.price, m.lltv, newDebt, loanDec);
  if (hf < LONGBOW_HF_FLOOR) {
    throw new ApiError(409, 'health_factor_too_low', `Borrowing ${unitsDisplay(borrowAmount, USDG_DECIMALS)} USDG would leave the health factor at ${hf.toFixed(2)}, below the ${LONGBOW_HF_FLOOR} floor. Add more collateral or borrow less.`, { healthFactor: Number(hf.toFixed(4)) });
  }
  const liq = liquidationPrice(totalCollateral, collateralDec, m.lltv, newDebt, loanDec);
  const steps: StepInput[] = [];
  if (newCollateral > 0n) {
    steps.push(approveStep(m.collateralAddress, ADDR.morpho, newCollateral, `Approve Morpho to take exactly this much ${m.symbol} as collateral.`, true));
    steps.push({
      kind: 'supply_collateral',
      description: `Post ${unitsDisplay(newCollateral, collateralDec)} ${m.symbol} as collateral. Send after the approval is confirmed.`,
      to: ADDR.morpho,
      data: encodeFunctionData({ abi: morphoAbi, functionName: 'supplyCollateral', args: [params, newCollateral, from, '0x'] }),
      value: 0n,
      simulate: false,
    });
  }
  steps.push({
    kind: 'borrow',
    description: `Borrow ${unitsDisplay(borrowAmount, USDG_DECIMALS)} USDG against the ${m.symbol} collateral.`,
    to: ADDR.morpho,
    // Morpho.borrow takes (marketParams, assets, shares, onBehalf, receiver):
    // assets is the exact USDG to borrow (shares=0 mints what that needs),
    // so there is no slippage parameter — the amount is exact.
    data: encodeFunctionData({ abi: morphoAbi, functionName: 'borrow', args: [params, borrowAmount, 0n, from, from] }),
    value: 0n,
    simulate: steps.length === 0,
  });
  const headline = `Borrow ${unitsDisplay(borrowAmount, USDG_DECIMALS)} USDG against ${m.symbol}`;
  const lines = [
    `Market: ${m.name} — ${m.oracleLabel}, LLTV ${(m.lltv * 100).toFixed(0)}%, borrow APR ${m.borrowAPR}% right now`,
    newCollateral > 0n ? `Collateral posted: ${unitsDisplay(newCollateral, collateralDec)} ${m.symbol} (total ${unitsDisplay(totalCollateral, collateralDec)} ${m.symbol})` : `Collateral: ${unitsDisplay(totalCollateral, collateralDec)} ${m.symbol} already posted`,
    `You borrow: ${unitsDisplay(borrowAmount, USDG_DECIMALS)} USDG, sent to your wallet`,
    `Health factor after: ${fmtHf(hf)} (floor ${LONGBOW_HF_FLOOR})`,
    liq !== null ? `Liquidation price: $${liq.toLocaleString('en-US', { maximumFractionDigits: 2 })} per ${m.symbol} — below that, the position can be liquidated` : 'No liquidation price: no debt after this action.',
    steps.length > 1 ? `This takes ${steps.length} wallet confirmations: ${steps.map((s) => s.kind).join(', then ')}.` : 'This takes 1 wallet confirmation.',
  ];
  return finishPrepared(ctx, {
    action: 'longbow-borrow',
    signParams: { m: m.key, amt: borrowAmount.toString(), col: newCollateral > 0n ? newCollateral.toString() : undefined },
    from,
    steps,
    meta,
    allowTargets: [ADDR.morpho, m.collateralAddress, m.loanAddress],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: { headline, lines, youReceiveAtLeast: `${unitsDisplay(borrowAmount, USDG_DECIMALS)} USDG`, risks: LONGBOW_RISKS },
    attribute: false,
    extra: {
      ...contractsExtra({ morpho: ADDR.morpho, collateralToken: m.collateralAddress, loanToken: m.loanAddress }),
      market: marketView(m),
      borrowAmount: borrowAmount.toString(),
      newCollateral: newCollateral.toString(),
      healthFactor: Number(hf.toFixed(4)),
      liquidationPrice: liq,
    },
  });
}

export async function prepareLongbowRepay(ctx: Ctx, rawInput: unknown, meta: Meta): Promise<Record<string, unknown>> {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const m = await resolveLongbowMarket(ctx, input.market ?? input.symbol ?? input.key);
  requireScreen(m);
  const params = await marketParamsOf(ctx, m.marketId);
  const [pos, state] = await Promise.all([positionOf(ctx, m.marketId, from), marketStateOf(ctx, m.marketId)]);
  if (pos.borrowShares <= 0n) throw new ApiError(409, 'no_debt', `The wallet has no debt in the ${m.symbol} market. Nothing to repay.`);
  const borrowedAssets = toAssetsDown(pos.borrowShares, state.totalBorrowAssets, state.totalBorrowShares);
  const all = boolFlag(input, 'all');
  let repayAssets: bigint;
  let repayShares: bigint;
  if (all) {
    // Repay-all burns the borrow shares, so it stays correct as interest
    // accrues. The approval is the current amount plus a 0.5% buffer for
    // interest between now and signing — bounded, never unlimited.
    repayShares = pos.borrowShares;
    repayAssets = borrowedAssets;
  } else {
    repayAssets = parseTokenAmount(input, USDG_DECIMALS, 'amountUsdg', 'amount', 'repay amount');
    guardUsdgAmount(repayAssets, input, 'repay amount');
    if (repayAssets > borrowedAssets) {
      throw new ApiError(409, 'repay_exceeds_debt', `The wallet owes ${unitsDisplay(borrowedAssets, USDG_DECIMALS)} USDG in the ${m.symbol} market, less than the ${unitsDisplay(repayAssets, USDG_DECIMALS)} USDG requested. Pass all: true to repay everything.`, { debt: borrowedAssets.toString() });
    }
    repayShares = 0n;
  }
  const approvalAmount = all ? repayAssets + repayAssets / 200n + 1n : repayAssets;
  const bal = await tokenBalance(ctx, ADDR.usdg, from);
  if (bal < approvalAmount) {
    throw new ApiError(409, 'insufficient_balance', `The wallet holds ${unitsDisplay(bal, USDG_DECIMALS)} USDG, less than the ${unitsDisplay(approvalAmount, USDG_DECIMALS)} USDG needed to repay.`, { balance: bal.toString() });
  }
  const collateralDec = await tokenDecimals(ctx, m.collateralAddress);
  const loanDec = await tokenDecimals(ctx, m.loanAddress);
  const remainingDebt = all ? 0n : borrowedAssets - repayAssets;
  const hfAfter = healthFactor(pos.collateral, collateralDec, m.price, m.lltv, remainingDebt, loanDec);
  const liqAfter = liquidationPrice(pos.collateral, collateralDec, m.lltv, remainingDebt, loanDec);
  const steps: StepInput[] = [
    approveStep(ADDR.usdg, ADDR.morpho, approvalAmount, `Approve Morpho to take ${unitsDisplay(approvalAmount, USDG_DECIMALS)} USDG for the repayment.`, true),
    {
      kind: 'repay',
      description: all ? 'Repay the whole debt. Send after the approval is confirmed.' : `Repay ${unitsDisplay(repayAssets, USDG_DECIMALS)} USDG. Send after the approval is confirmed.`,
      to: ADDR.morpho,
      data: encodeFunctionData({ abi: morphoAbi, functionName: 'repay', args: [params, all ? 0n : repayAssets, repayShares, from, '0x'] }),
      value: 0n,
      simulate: false,
    },
  ];
  const headline = all ? `Repay all ${unitsDisplay(borrowedAssets, USDG_DECIMALS)} USDG of debt in the ${m.symbol} market` : `Repay ${unitsDisplay(repayAssets, USDG_DECIMALS)} USDG in the ${m.symbol} market`;
  const lines = [
    `Market: ${m.name}`,
    all ? 'You repay the whole debt (by burning the borrow shares, so interest since this reading is covered).' : `You repay: ${unitsDisplay(repayAssets, USDG_DECIMALS)} USDG`,
    `Debt left after: ${unitsDisplay(remainingDebt, USDG_DECIMALS)} USDG`,
    `Health factor after: ${fmtHf(hfAfter)}`,
    liqAfter !== null ? `Liquidation price after: $${liqAfter.toLocaleString('en-US', { maximumFractionDigits: 2 })} per ${m.symbol}` : 'No liquidation price: no debt left.',
    'This takes 2 wallet confirmations: approve, then repay.',
  ];
  return finishPrepared(ctx, {
    action: 'longbow-repay',
    signParams: { m: m.key, amt: all ? undefined : repayAssets.toString(), all: all ? '1' : undefined },
    from,
    steps,
    meta,
    allowTargets: [ADDR.morpho, ADDR.usdg],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: { headline, lines, youPay: `${unitsDisplay(approvalAmount, USDG_DECIMALS)} USDG`, risks: LONGBOW_RISKS },
    attribute: false,
    extra: {
      ...contractsExtra({ morpho: ADDR.morpho, loanToken: ADDR.usdg }),
      market: marketView(m),
      repayAmount: repayAssets.toString(),
      repayAll: all,
      remainingDebt: remainingDebt.toString(),
      healthFactor: Number(hfAfter.toFixed(4)),
    },
  });
}

export async function prepareLongbowAddCollateral(ctx: Ctx, rawInput: unknown, meta: Meta): Promise<Record<string, unknown>> {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const m = await resolveLongbowMarket(ctx, input.market ?? input.symbol ?? input.key);
  requireScreen(m);
  const params = await marketParamsOf(ctx, m.marketId);
  const collateralDec = await tokenDecimals(ctx, m.collateralAddress);
  const amount = m.collateralAddress.toLowerCase() === ADDR.weth.toLowerCase()
    ? parseTokenAmount(input, 18, 'amountEth', 'amount', 'collateral')
    : parseUnits10(input.amount, 'amount');
  if (amount <= 0n) throw new ApiError(400, 'invalid_params', 'amount must be above zero.', { field: 'amount' });
  if (m.collateralAddress.toLowerCase() === ADDR.weth.toLowerCase()) guardAmountWei(amount, input, 'amount');
  const bal = await tokenBalance(ctx, m.collateralAddress, from);
  if (bal < amount) {
    throw new ApiError(409, 'insufficient_balance', `The wallet holds ${unitsDisplay(bal, collateralDec)} ${m.symbol}, less than the ${unitsDisplay(amount, collateralDec)} ${m.symbol} requested.`, { balance: bal.toString() });
  }
  const [pos, state] = await Promise.all([positionOf(ctx, m.marketId, from), marketStateOf(ctx, m.marketId)]);
  const loanDec = await tokenDecimals(ctx, m.loanAddress);
  const debt = toAssetsDown(pos.borrowShares, state.totalBorrowAssets, state.totalBorrowShares);
  const totalCollateral = pos.collateral + amount;
  const hf = healthFactor(totalCollateral, collateralDec, m.price, m.lltv, debt, loanDec);
  const liq = liquidationPrice(totalCollateral, collateralDec, m.lltv, debt, loanDec);
  const steps: StepInput[] = [
    approveStep(m.collateralAddress, ADDR.morpho, amount, `Approve Morpho to take exactly this much ${m.symbol} as collateral.`, true),
    {
      kind: 'supply_collateral',
      description: `Post ${unitsDisplay(amount, collateralDec)} ${m.symbol} as collateral. Send after the approval is confirmed.`,
      to: ADDR.morpho,
      data: encodeFunctionData({ abi: morphoAbi, functionName: 'supplyCollateral', args: [params, amount, from, '0x'] }),
      value: 0n,
      simulate: false,
    },
  ];
  const headline = `Add ${unitsDisplay(amount, collateralDec)} ${m.symbol} as collateral in the ${m.symbol} market`;
  const lines = [
    `Market: ${m.name}`,
    `Collateral after: ${unitsDisplay(totalCollateral, collateralDec)} ${m.symbol}`,
    `Debt: ${unitsDisplay(debt, loanDec)} ${m.loan}`,
    `Health factor after: ${fmtHf(hf)}`,
    liq !== null ? `Liquidation price after: $${liq.toLocaleString('en-US', { maximumFractionDigits: 2 })} per ${m.symbol}` : 'No liquidation price: no debt.',
    'This takes 2 wallet confirmations: approve, then post collateral.',
  ];
  return finishPrepared(ctx, {
    action: 'longbow-add-collateral',
    signParams: { m: m.key, amt: amount.toString() },
    from,
    steps,
    meta,
    allowTargets: [ADDR.morpho, m.collateralAddress],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: { headline, lines, youPay: `${unitsDisplay(amount, collateralDec)} ${m.symbol}`, risks: LONGBOW_RISKS },
    attribute: false,
    extra: {
      ...contractsExtra({ morpho: ADDR.morpho, collateralToken: m.collateralAddress }),
      market: marketView(m),
      amount: amount.toString(),
      healthFactor: Number(hf.toFixed(4)),
    },
  });
}

export async function prepareLongbowWithdrawCollateral(ctx: Ctx, rawInput: unknown, meta: Meta): Promise<Record<string, unknown>> {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const m = await resolveLongbowMarket(ctx, input.market ?? input.symbol ?? input.key);
  requireScreen(m);
  const params = await marketParamsOf(ctx, m.marketId);
  const collateralDec = await tokenDecimals(ctx, m.collateralAddress);
  const loanDec = await tokenDecimals(ctx, m.loanAddress);
  const [pos, state] = await Promise.all([positionOf(ctx, m.marketId, from), marketStateOf(ctx, m.marketId)]);
  if (pos.collateral <= 0n) throw new ApiError(409, 'no_collateral', `The wallet has no ${m.symbol} collateral in the ${m.symbol} market. Nothing to withdraw.`);
  const all = boolFlag(input, 'all');
  const amount = all
    ? pos.collateral
    : m.collateralAddress.toLowerCase() === ADDR.weth.toLowerCase()
      ? parseTokenAmount(input, 18, 'amountEth', 'amount', 'collateral')
      : parseUnits10(input.amount, 'amount');
  if (amount <= 0n) throw new ApiError(400, 'invalid_params', 'amount must be above zero.', { field: 'amount' });
  if (amount > pos.collateral) {
    throw new ApiError(409, 'withdraw_exceeds_collateral', `The wallet has ${unitsDisplay(pos.collateral, collateralDec)} ${m.symbol} posted, less than the ${unitsDisplay(amount, collateralDec)} ${m.symbol} requested. Pass all: true to withdraw everything.`, { collateral: pos.collateral.toString() });
  }
  const debt = toAssetsDown(pos.borrowShares, state.totalBorrowAssets, state.totalBorrowShares);
  const remainingCollateral = pos.collateral - amount;
  const hf = healthFactor(remainingCollateral, collateralDec, m.price, m.lltv, debt, loanDec);
  if (debt > 0n && hf < LONGBOW_HF_FLOOR) {
    throw new ApiError(409, 'health_factor_too_low', `Withdrawing ${unitsDisplay(amount, collateralDec)} ${m.symbol} would leave the health factor at ${hf.toFixed(2)}, below the ${LONGBOW_HF_FLOOR} floor. Withdraw less, or repay some debt first.`, { healthFactor: Number(hf.toFixed(4)) });
  }
  const liq = liquidationPrice(remainingCollateral, collateralDec, m.lltv, debt, loanDec);
  const steps: StepInput[] = [
    {
      kind: 'withdraw_collateral',
      description: all ? `Withdraw all ${unitsDisplay(amount, collateralDec)} ${m.symbol} of collateral.` : `Withdraw ${unitsDisplay(amount, collateralDec)} ${m.symbol} of collateral.`,
      to: ADDR.morpho,
      data: encodeFunctionData({ abi: morphoAbi, functionName: 'withdrawCollateral', args: [params, amount, from, from] }),
      value: 0n,
      simulate: true,
    },
  ];
  const headline = all ? `Withdraw all ${unitsDisplay(amount, collateralDec)} ${m.symbol} of collateral from the ${m.symbol} market` : `Withdraw ${unitsDisplay(amount, collateralDec)} ${m.symbol} of collateral from the ${m.symbol} market`;
  const lines = [
    `Market: ${m.name}`,
    `Collateral left after: ${unitsDisplay(remainingCollateral, collateralDec)} ${m.symbol}`,
    `Debt: ${unitsDisplay(debt, loanDec)} ${m.loan}`,
    `Health factor after: ${fmtHf(hf)}`,
    liq !== null ? `Liquidation price after: $${liq.toLocaleString('en-US', { maximumFractionDigits: 2 })} per ${m.symbol}` : 'No liquidation price: no debt left.',
    'This takes 1 wallet confirmation.',
  ];
  return finishPrepared(ctx, {
    action: 'longbow-withdraw-collateral',
    signParams: { m: m.key, amt: all ? undefined : amount.toString(), all: all ? '1' : undefined },
    from,
    steps,
    meta,
    allowTargets: [ADDR.morpho, m.collateralAddress],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: { headline, lines, youReceiveAtLeast: `${unitsDisplay(amount, collateralDec)} ${m.symbol}`, risks: LONGBOW_RISKS },
    attribute: false,
    extra: {
      ...contractsExtra({ morpho: ADDR.morpho, collateralToken: m.collateralAddress }),
      market: marketView(m),
      amount: amount.toString(),
      healthFactor: Number(hf.toFixed(4)),
    },
  });
}

export async function prepareLongbowClose(ctx: Ctx, rawInput: unknown, meta: Meta): Promise<Record<string, unknown>> {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const m = await resolveLongbowMarket(ctx, input.market ?? input.symbol ?? input.key);
  requireScreen(m);
  const params = await marketParamsOf(ctx, m.marketId);
  const [pos, state] = await Promise.all([positionOf(ctx, m.marketId, from), marketStateOf(ctx, m.marketId)]);
  if (pos.borrowShares <= 0n && pos.collateral <= 0n) {
    throw new ApiError(409, 'no_position', `The wallet has no position in the ${m.symbol} market. Nothing to close.`);
  }
  const collateralDec = await tokenDecimals(ctx, m.collateralAddress);
  const borrowedAssets = toAssetsDown(pos.borrowShares, state.totalBorrowAssets, state.totalBorrowShares);
  const steps: StepInput[] = [];
  if (pos.borrowShares > 0n) {
    // Repay-all burns the borrow shares; the approval is the current amount
    // plus a 0.5% buffer for interest between now and signing.
    const approvalAmount = borrowedAssets + borrowedAssets / 200n + 1n;
    const bal = await tokenBalance(ctx, ADDR.usdg, from);
    if (bal < approvalAmount) {
      throw new ApiError(409, 'insufficient_balance', `Closing needs ${unitsDisplay(approvalAmount, USDG_DECIMALS)} USDG to repay the debt, but the wallet holds ${unitsDisplay(bal, USDG_DECIMALS)} USDG.`, { balance: bal.toString() });
    }
    steps.push(approveStep(ADDR.usdg, ADDR.morpho, approvalAmount, `Approve Morpho to take ${unitsDisplay(approvalAmount, USDG_DECIMALS)} USDG to repay the debt.`, true));
    steps.push({
      kind: 'repay',
      description: 'Repay the whole debt. Send after the approval is confirmed.',
      to: ADDR.morpho,
      data: encodeFunctionData({ abi: morphoAbi, functionName: 'repay', args: [params, 0n, pos.borrowShares, from, '0x'] }),
      value: 0n,
      simulate: false,
    });
  }
  steps.push({
    kind: 'withdraw_collateral',
    description: `Withdraw all ${unitsDisplay(pos.collateral, collateralDec)} ${m.symbol} of collateral.`,
    to: ADDR.morpho,
    data: encodeFunctionData({ abi: morphoAbi, functionName: 'withdrawCollateral', args: [params, pos.collateral, from, from] }),
    value: 0n,
    simulate: steps.length === 0,
  });
  const headline = `Close the ${m.symbol} position: repay ${unitsDisplay(borrowedAssets, USDG_DECIMALS)} USDG and withdraw ${unitsDisplay(pos.collateral, collateralDec)} ${m.symbol}`;
  const lines = [
    `Market: ${m.name}`,
    pos.borrowShares > 0n ? `Debt repaid: ${unitsDisplay(borrowedAssets, USDG_DECIMALS)} USDG` : 'No debt to repay.',
    `Collateral returned: ${unitsDisplay(pos.collateral, collateralDec)} ${m.symbol}`,
    `This takes ${steps.length} wallet confirmation${steps.length > 1 ? 's' : ''}: ${steps.map((s) => s.kind).join(', then ')}.`,
    'After this the position is empty: no debt, no collateral.',
  ];
  return finishPrepared(ctx, {
    action: 'longbow-close',
    signParams: { m: m.key },
    from,
    steps,
    meta,
    allowTargets: [ADDR.morpho, ADDR.usdg, m.collateralAddress],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: { headline, lines, youReceiveAtLeast: `${unitsDisplay(pos.collateral, collateralDec)} ${m.symbol}`, risks: LONGBOW_RISKS },
    attribute: false,
    extra: {
      ...contractsExtra({ morpho: ADDR.morpho, loanToken: ADDR.usdg, collateralToken: m.collateralAddress }),
      market: marketView(m),
      repaid: borrowedAssets.toString(),
      collateralReturned: pos.collateral.toString(),
    },
  });
}

export async function prepareLongbowMultiply(ctx: Ctx, rawInput: unknown, meta: Meta): Promise<Record<string, unknown>> {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const m = await resolveLongbowMarket(ctx, input.market ?? input.symbol ?? input.key);
  requireScreen(m);
  if (m.collateralAddress.toLowerCase() !== ADDR.weth.toLowerCase()) {
    throw new ApiError(409, 'multiply_requires_weth_collateral', `Multiply needs a WETH-collateral market: the swap leg turns borrowed USDG into WETH. The ${m.symbol} market uses ${m.collateralAddress} as collateral.`);
  }
  const slip = slippageOf(input);
  const borrowAmount = parseTokenAmount(input, USDG_DECIMALS, 'borrowAmountUsdg', 'amount', 'borrow amount');
  guardUsdgAmount(borrowAmount, input, 'borrow amount');
  const hasCollateralInput = (input.collateralAmount !== undefined && input.collateralAmount !== '') || (input.collateralAmountEth !== undefined && input.collateralAmountEth !== '');
  const newCollateral = hasCollateralInput ? parseTokenAmount(input, 18, 'collateralAmountEth', 'collateralAmount', 'collateral') : 0n;
  if (newCollateral < 0n) throw new ApiError(400, 'invalid_params', 'collateralAmount must be above zero or omitted.', { field: 'collateralAmount' });
  if (newCollateral > 0n) guardAmountWei(newCollateral, input, 'collateralAmount');
  const params = await marketParamsOf(ctx, m.marketId);
  const [pos, state] = await Promise.all([positionOf(ctx, m.marketId, from), marketStateOf(ctx, m.marketId)]);
  const existingDebt = toAssetsDown(pos.borrowShares, state.totalBorrowAssets, state.totalBorrowShares);
  const totalCollateral = pos.collateral + newCollateral;
  if (totalCollateral <= 0n) {
    throw new ApiError(409, 'no_collateral', `Multiply needs collateral: the wallet has no WETH posted in the ${m.symbol} market. Pass collateralAmount to post it in this same action.`);
  }
  const totalCollateralValue = (Number(totalCollateral) / 1e18) * m.price;
  const existingDebtValue = Number(existingDebt) / 10 ** USDG_DECIMALS;
  const borrowValue = Number(borrowAmount) / 10 ** USDG_DECIMALS;
  const maxBorrowValue = Math.max(0, (totalCollateralValue * m.lltv) / LONGBOW_HF_FLOOR - existingDebtValue);
  if (borrowValue > maxBorrowValue) {
    throw new ApiError(409, 'health_factor_too_low', `Borrowing ${borrowValue.toLocaleString('en-US')} USDG would leave the health factor below ${LONGBOW_HF_FLOOR} before the swap. The most this collateral supports at that floor is about ${maxBorrowValue.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDG.`, { maxBorrowUsdg: maxBorrowValue });
  }
  if (m.availableToBorrow > 0 && borrowValue > m.availableToBorrow) {
    throw new ApiError(409, 'market_illiquid', `The ${m.symbol} market only has about ${m.availableToBorrow.toLocaleString('en-US')} USDG available to borrow right now.`);
  }
  if (newCollateral > 0n) {
    const cbal = await tokenBalance(ctx, ADDR.weth, from);
    if (cbal < newCollateral) {
      throw new ApiError(409, 'insufficient_balance', `The wallet holds ${ethDisplay(cbal)} WETH, less than the ${ethDisplay(newCollateral)} WETH requested.`, { balance: cbal.toString() });
    }
  }
  const usdg = await resolveSwapToken(ctx, 'usdg');
  const weth = await resolveSwapToken(ctx, 'weth');
  const pool = await findUniswapPool(ctx, usdg, weth, borrowAmount);
  if (!pool) throw new ApiError(409, 'aggregator_no_quote', 'No Uniswap V4 pool on Robinhood Chain quoted USDG -> WETH at any probed fee tier, so the swap leg cannot be priced.');
  const minOut = (pool.out * BigInt(10_000 - slip)) / 10_000n;
  const finalCollateral = totalCollateral + minOut;
  const finalDebt = existingDebt + borrowAmount;
  const finalHf = healthFactor(finalCollateral, 18, m.price, m.lltv, finalDebt, USDG_DECIMALS);
  const finalLiq = liquidationPrice(finalCollateral, 18, m.lltv, finalDebt, USDG_DECIMALS);
  const leverage = totalCollateralValue > 0 ? (Number(finalCollateral) / 1e18) * m.price / totalCollateralValue : null;
  const deadline = BigInt(ctx.nowSec() + LIMITS.deadlineSeconds);
  const swapData = encodeGenericV4Swap(pool, borrowAmount, minOut, deadline);
  const expiry = ctx.nowSec() + 1800;

  // The bundle runs inside one Bundler3 multicall, so it is atomic: any
  // step reverting reverts the whole multiply. The borrow is sized against
  // the collateral BEFORE the swap, so the health factor is above the floor
  // at every step and the swap only improves it. callbackHash is 0 for every
  // call: no reentrance is used (no flash loan).
  const bundle: BundleCall[] = [];
  if (newCollateral > 0n) {
    bundle.push(bundleCall(ADDR.weth, encodeFunctionData({ abi: erc20Abi, functionName: 'transferFrom', args: [from, ADDR.bundler3, newCollateral] })));
    bundle.push(bundleCall(ADDR.weth, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ADDR.morpho, newCollateral] })));
    bundle.push(bundleCall(ADDR.morpho, encodeFunctionData({ abi: morphoAbi, functionName: 'supplyCollateral', args: [params, newCollateral, from, '0x'] })));
  }
  // Morpho.borrow takes (marketParams, assets, shares, onBehalf, receiver):
  // the borrowed USDG goes to the bundler (receiver) for the swap, and the
  // debt is on the user's position (onBehalf). Assets is exact; shares=0.
  bundle.push(bundleCall(ADDR.morpho, encodeFunctionData({ abi: morphoAbi, functionName: 'borrow', args: [params, borrowAmount, 0n, from, ADDR.bundler3] })));
  bundle.push(bundleCall(ADDR.usdg, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ADDR.permit2, borrowAmount] })));
  bundle.push(bundleCall(ADDR.permit2, encodeFunctionData({ abi: permit2Abi, functionName: 'approve', args: [ADDR.usdg, ADDR.universalRouter, borrowAmount, expiry] })));
  bundle.push(bundleCall(ADDR.universalRouter, swapData));
  bundle.push(bundleCall(ADDR.weth, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ADDR.morpho, minOut] })));
  bundle.push(bundleCall(ADDR.morpho, encodeFunctionData({ abi: morphoAbi, functionName: 'supplyCollateral', args: [params, minOut, from, '0x'] })));

  const steps: StepInput[] = [];
  if (newCollateral > 0n) {
    const allowance = await tokenAllowance(ctx, ADDR.weth, from, ADDR.bundler3);
    if (allowance < newCollateral) {
      steps.push(approveStep(ADDR.weth, ADDR.bundler3, newCollateral, 'Approve the Bundler3 contract to pull exactly this much WETH for the multiply.', steps.length === 0));
    }
  }
  const authorized = await ctx.client.readContract({ address: ADDR.morpho, abi: morphoAbi, functionName: 'isAuthorized', args: [from, ADDR.bundler3] });
  if (!authorized) {
    steps.push({
      kind: 'authorize',
      description: 'Let the Bundler3 contract borrow on your behalf in Morpho (one-time; you can revoke it on Morpho any time). Send before the multiply.',
      to: ADDR.morpho,
      data: encodeFunctionData({ abi: morphoAbi, functionName: 'setAuthorization', args: [ADDR.bundler3, true] }),
      value: 0n,
      simulate: steps.length === 0,
    });
  }
  steps.push({
    kind: 'multiply',
    description: 'Multiply in one atomic bundle: borrow USDG, swap it for WETH on Uniswap V4, post the WETH as more collateral.',
    to: ADDR.bundler3,
    data: encodeFunctionData({ abi: bundler3Abi, functionName: 'multicall', args: [bundle] }),
    value: 0n,
    simulate: steps.length === 0,
  });

  const feePct = pool.fee === 0 ? '0' : String(pool.fee / 10000);
  const headline = `Multiply ${m.symbol}: borrow ${unitsDisplay(borrowAmount, USDG_DECIMALS)} USDG, swap for WETH, post it as collateral`;
  const lines = [
    `Market: ${m.name} — ${m.oracleLabel}, LLTV ${(m.lltv * 100).toFixed(0)}%`,
    newCollateral > 0n ? `New collateral posted: ${ethDisplay(newCollateral)} WETH (total ${ethDisplay(totalCollateral)} WETH)` : `Collateral: ${ethDisplay(totalCollateral)} WETH already posted`,
    `Borrow: ${unitsDisplay(borrowAmount, USDG_DECIMALS)} USDG, swapped for at least ${ethDisplay(minOut)} WETH on Uniswap V4 (${feePct}% fee pool)`,
    `Leverage after: about ${leverage === null ? '?' : leverage.toFixed(2)}x`,
    `Health factor after: ${fmtHf(finalHf)} (floor ${LONGBOW_HF_FLOOR})`,
    finalLiq !== null ? `Liquidation price after: $${finalLiq.toLocaleString('en-US', { maximumFractionDigits: 2 })} per WETH` : 'No liquidation price.',
    `This takes ${steps.length} wallet confirmation${steps.length > 1 ? 's' : ''}: ${steps.map((s) => s.kind).join(', then ')}.`,
    'If the swap returns more WETH than the minimum, the small excess stays in the Bundler3 contract and can be recovered with a later multicall — it is not lost.',
    'No flash loan is used. The borrow is sized against the collateral before the swap, so the position is above the health-factor floor at every step.',
  ];
  return finishPrepared(ctx, {
    action: 'longbow-multiply',
    signParams: { m: m.key, amt: borrowAmount.toString(), col: newCollateral > 0n ? newCollateral.toString() : undefined, sl: slip },
    from,
    steps,
    meta,
    allowTargets: [ADDR.bundler3, ADDR.morpho, ADDR.weth, ADDR.usdg, ADDR.permit2, ADDR.universalRouter],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: { headline, lines, youPay: newCollateral > 0n ? `${ethDisplay(newCollateral)} WETH` : '0 WETH (uses posted collateral)', youReceiveAtLeast: `${ethDisplay(minOut)} WETH of new collateral`, slippageBps: slip, risks: LONGBOW_RISKS },
    attribute: false,
    extra: {
      ...contractsExtra({ bundler3: ADDR.bundler3, morpho: ADDR.morpho, weth: ADDR.weth, usdg: ADDR.usdg, permit2: ADDR.permit2, universalRouter: ADDR.universalRouter }),
      market: marketView(m),
      borrowAmount: borrowAmount.toString(),
      newCollateral: newCollateral.toString(),
      minSwapOut: minOut.toString(),
      healthFactor: Number(finalHf.toFixed(4)),
      liquidationPrice: finalLiq,
      leverage: leverage === null ? null : Number(leverage.toFixed(3)),
    },
  });
}

export async function prepareLongbowStakeBow(ctx: Ctx, rawInput: unknown, meta: Meta): Promise<Record<string, unknown>> {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const amount = parseTokenAmount(input, 18, 'amountBow', 'amount', 'amount');
  if (amount <= 0n) throw new ApiError(400, 'invalid_params', 'amount must be above zero.', { field: 'amount' });
  const bal = await tokenBalance(ctx, ADDR.bowToken, from);
  if (bal < amount) {
    throw new ApiError(409, 'insufficient_balance', `The wallet holds ${unitsDisplay(bal, 18)} BOW, less than the ${unitsDisplay(amount, 18)} BOW requested.`, { balance: bal.toString() });
  }
  const steps: StepInput[] = [
    approveStep(ADDR.bowToken, ADDR.bowStaking, amount, 'Approve the BOW staking contract to take exactly this much BOW.', true),
    {
      kind: 'stake',
      description: `Stake ${unitsDisplay(amount, 18)} BOW. Send after the approval is confirmed.`,
      to: ADDR.bowStaking,
      data: encodeFunctionData({ abi: bowStakingAbi, functionName: 'stake', args: [amount] }),
      value: 0n,
      simulate: false,
    },
  ];
  const headline = `Stake ${unitsDisplay(amount, 18)} BOW to earn USDG`;
  const lines = [
    'Staking contract: BOW StakingRewards — borrower interest and a share of BOW trading fees are paid to stakers in USDG, streamed per second.',
    `You stake: ${unitsDisplay(amount, 18)} BOW`,
    'No lock, no cooldown: withdraw any time. Staking is not a borrow, so there is no liquidation risk.',
    'This takes 2 wallet confirmations: approve, then stake.',
    'Rewards are a reading, not a promise.',
  ];
  return finishPrepared(ctx, {
    action: 'longbow-stake-bow',
    signParams: { amt: amount.toString() },
    from,
    steps,
    meta,
    allowTargets: [ADDR.bowStaking, ADDR.bowToken],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: { headline, lines, youPay: `${unitsDisplay(amount, 18)} BOW`, risks: LONGBOW_RISKS },
    attribute: false,
    extra: {
      ...contractsExtra({ bowStaking: ADDR.bowStaking, bowToken: ADDR.bowToken }),
      amount: amount.toString(),
    },
  });
}

export async function prepareLongbowClaimRebate(ctx: Ctx, rawInput: unknown, meta: Meta): Promise<Record<string, unknown>> {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const epoch = optUint(input.epoch, 'epoch', 0, 1, 1_000_000);
  if (!epoch) throw new ApiError(400, 'invalid_params', 'epoch is required: the rebate epoch to claim.', { field: 'epoch' });
  // (viem infers this single-bool read as literal `false`; annotate so the
  // comparison below type-checks. The runtime value is a real boolean.)
  const claimed: boolean | null = await ctx.client.readContract({
    address: ADDR.rebateDistributor, abi: rebateDistributorAbi, functionName: 'hasClaimed', args: [BigInt(epoch), from],
  }).catch(() => null);
  // Capture before the if narrows `claimed` to `false | null`.
  const alreadyClaimed = claimed === true;
  if (alreadyClaimed) {
    throw new ApiError(409, 'rebate_already_claimed', `Epoch ${epoch} was already claimed for this wallet.`, { epoch, distributor: ADDR.rebateDistributor });
  }
  // The distributor is verified on-chain, but its claim function and the
  // Merkle-proof source are not: a claim needs the epoch's Merkle proof,
  // which Longbow publishes per epoch, and the exact claim calldata. Building
  // a claim on a guessed function would hand the user a transaction that
  // cannot work. Refuse honestly instead.
  throw new ApiError(409, 'claim_rebate_unavailable', `Borrow-rebate claims are not built yet: the rebate distributor (${ADDR.rebateDistributor}) is verified on-chain, but the exact claim function and the per-epoch Merkle proof source are not. Claim from Longbow's staking page, which publishes each epoch's proof, until this tool is completed.`, {
    epoch,
    distributor: ADDR.rebateDistributor,
    alreadyClaimed,
    note: 'Rebates are a Merkle distribution per epoch. Claims are permissionless and never expire, so nothing is lost by waiting.',
  });
}
