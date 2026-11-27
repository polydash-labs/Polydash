/**
 * Poly credits top-up pricing — server-only.
 *
 * Balances are integer cents. The credited amount is computed at
 * confirmation time from the actual amount received, at live prices:
 *
 * - ETH/USD: getEthUsd() from lib/eth-price.ts (Coinbase spot, 60 s cache)
 *   — already the site's ETH price source (launches, staking, creator
 *   fees). ETH is a major asset with a correct Coinbase price; the
 *   CoinGecko-POLYDASH problem does not apply to ETH.
 * - POLYDASH/USD: StateView.getSlot0 on the POLYDASH/WETH V4 pool, the
 *   same math as lib/total-tvl.ts. Fallback when the StateView read fails:
 *   the facilitator's Dexscreener price (same pool, on-chain-derived).
 *   NEVER CoinGecko for POLYDASH (its simple-price was ~2,790x too high).
 *   When both sources fail the top-up fails with 'price_unavailable' —
 *   never credit at a guessed price.
 *
 * All money math after the initial price rounding is integer bigint:
 * prices are carried at 12 dp, USD values at 6 dp, cents are floored.
 */
import { createPublicClient, formatUnits, http, parseAbi, type Address, type PublicClient } from "viem";
import { robinhoodChain } from "@/lib/chain";
import { getEthUsd } from "@/lib/eth-price";
import { POLYDASH_ADDRESS } from "@/lib/x402/constants";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

// Uniswap V4 POLYDASH/WETH pool (1% fee, no hook). PoolManager.getSlot0
// reverts on this chain, so the price is read from StateView — same as
// lib/total-tvl.ts.
const STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" as Address;
const POLYDASH_WETH_POOL_ID =
  "0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5" as `0x${string}`;

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

const Q192 = 2n ** 192n;

/**
 * WETH (wei) for an amount of POLYDASH (wei) at a pool sqrtPriceX96.
 * Pure — unit-testable. Same formula as lib/total-tvl.ts:
 * wethWei = polydashWei * 2^192 / sqrtPriceX96^2.
 */
export function polydashWethFromSqrtPrice(sqrtPriceX96: bigint, amountWei: bigint): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  return (amountWei * Q192) / (sqrtPriceX96 * sqrtPriceX96);
}

/** USD value at 6 dp of an 18-dp token amount at a USD price (JS number). */
export function usd6FromWei(amountWei: bigint, priceUsd: number): bigint {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return 0n;
  // The price needs 12 dp of precision (at ~$0.000000194, 6 dp rounds
  // to 0): value6 = amount * price12 / 1e24.
  const price12 = BigInt(Math.round(priceUsd * 1e12));
  if (price12 <= 0n) return 0n;
  return (amountWei * price12) / 10n ** 24n;
}

/** Whole cents (floored) in a 6-dp USD value. 1 cent = 10,000 units. */
export function centsFromUsd6(usd6: bigint): number {
  return Number(usd6 / 10_000n);
}

/** A block timestamp is fresh when it is within `windowMs` of now. */
export function isFresh(blockTimestampSec: number, nowMs: number, windowMs: number): boolean {
  return nowMs / 1000 - blockTimestampSec <= windowMs / 1000;
}

export function topupPublicClient(): PublicClient {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(RPC_URL, { timeout: 8_000 }),
  }) as PublicClient;
}

let poolPriceCache: { price: number; at: number } | null = null;
const POOL_PRICE_TTL_MS = 60_000;

/**
 * POLYDASH/USD from the on-chain V4 pool via StateView. 0 when the price
 * cannot be read. 60 s cache.
 */
export async function getPolydashUsdFromPool(client?: PublicClient): Promise<number> {
  try {
    if (poolPriceCache && Date.now() - poolPriceCache.at < POOL_PRICE_TTL_MS) return poolPriceCache.price;
    const c = client ?? topupPublicClient();
    const [slot0, ethUsd] = await Promise.all([
      c.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [POLYDASH_WETH_POOL_ID] }),
      getEthUsd(),
    ]);
    const sqrtPriceX96 = (slot0 as unknown as { sqrtPriceX96: bigint }).sqrtPriceX96 ?? (slot0 as unknown as bigint[])[0];
    if (!sqrtPriceX96 || sqrtPriceX96 === 0n || ethUsd <= 0) throw new Error("bad pool price");
    const onePolydashWeth = Number(formatUnits(polydashWethFromSqrtPrice(sqrtPriceX96, 10n ** 18n), 18));
    const price = onePolydashWeth * ethUsd;
    if (!Number.isFinite(price) || price <= 0) throw new Error("bad pool price");
    poolPriceCache = { price, at: Date.now() };
    return price;
  } catch (e) {
    console.error("credits pricing: StateView pool price failed", e instanceof Error ? e.message : e);
    return poolPriceCache?.price ?? 0;
  }
}

/**
 * POLYDASH/USD from Dexscreener (same pool, on-chain-derived) — the
 * fallback when the StateView read fails. Same endpoint the x402
 * facilitator uses. 0 when unavailable.
 */
export async function getPolydashUsdFromDexscreener(): Promise<number> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${POLYDASH_ADDRESS}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    const price = Number((await res.json())?.pairs?.[0]?.priceUsd);
    if (!Number.isFinite(price) || price <= 0) throw new Error("bad price");
    return price;
  } catch {
    return 0;
  }
}

/** POLYDASH/USD: StateView pool price first, Dexscreener fallback. 0 when both fail. */
export async function getPolydashUsdForTopup(client?: PublicClient): Promise<number> {
  const pool = await getPolydashUsdFromPool(client);
  if (pool > 0) return pool;
  return getPolydashUsdFromDexscreener();
}

export type TopupAsset = "ETH" | "POLYDASH";

/**
 * Quote a top-up: cents for a human amount of an asset at current prices.
 * An estimate only — the confirm credits at confirmation-time prices.
 */
export async function quoteTopup(
  asset: TopupAsset,
  amountWei: bigint,
  client?: PublicClient,
): Promise<{ ok: true; cents: number; priceUsd: number; usdValue: number } | { ok: false; reason: "price_unavailable" }> {
  const priceUsd = asset === "ETH" ? await getEthUsd() : await getPolydashUsdForTopup(client);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return { ok: false, reason: "price_unavailable" };
  const usd6 = usd6FromWei(amountWei, priceUsd);
  return { ok: true, cents: centsFromUsd6(usd6), priceUsd, usdValue: Number(usd6) / 1e6 };
}
