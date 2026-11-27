// Platform tokens that are not Polypad launches — POLYDASH itself.
// Server-only: on-chain ERC-20 reads + Dexscreener. Shared by the x402
// token-report product and the MCP polypad_get_token tool, so both agree
// on what POLYDASH is. No launch contract exists for it, so neither path
// can go through the launch lookups — that is why it 404'd before.
//
// On-chain facts (Nov 21, 2026, verified with cast):
// - POLYDASH 0x319525528f42167eF7fC18b77b889958080568e4, 18 decimals,
//   totalSupply 100,000,000,000 (1e29 base units), name "Polydash",
//   symbol "polydash" (lowercase on-chain; the site shows POLYDASH).
// - It trades on the POLYDASH/WETH pool 0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5
//   (Dexscreener: ~$2,520 liquidity, ~$64/day volume, 467 holders).
// - Creator/deployer is the Polydash fee wallet 0x9a21…776d0.

import { parseAbi, type PublicClient } from 'viem';
import { POLYDASH_ADDRESS, X402_PAY_TO } from './x402/constants';

export const POLYDASH_DEPLOYER = X402_PAY_TO;
export const PLATFORM_TOKEN_DESCRIPTION =
  'The Polydash platform token. Powers Poly credits, fund fees, and agent payments on Polypad.';

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
]);

/** True for the POLYDASH address (any casing). */
export function isPlatformToken(address: string): boolean {
  return address.toLowerCase() === POLYDASH_ADDRESS.toLowerCase();
}

/** True for a user/agent reference to POLYDASH: the address, or the symbol/name. */
export function isPlatformTokenRef(ref: string): boolean {
  const q = ref.trim().replace(/^\$/, '').toLowerCase();
  return q === POLYDASH_ADDRESS.toLowerCase() || q === 'polydash';
}

export interface DexPair {
  priceUsd: number | null;
  /** WETH per token, as a decimal string (Dexscreener priceNative). */
  priceNative: string | null;
  marketCapUsd: number | null;
  volumeUsd24h: number | null;
  liquidityUsd: number | null;
  pairAddress: string | null;
  dexId: string | null;
  url: string | null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse one Dexscreener token response into the first pair, or null. */
export function parseDexPair(json: unknown): DexPair | null {
  const pair = (json as { pairs?: unknown[] } | null)?.pairs?.[0] as
    | Record<string, unknown>
    | undefined;
  if (!pair || typeof pair !== 'object') return null;
  const volume = pair.volume as Record<string, unknown> | undefined;
  const liquidity = pair.liquidity as Record<string, unknown> | undefined;
  return {
    priceUsd: num(pair.priceUsd),
    priceNative: typeof pair.priceNative === 'string' ? pair.priceNative : null,
    marketCapUsd: num(pair.marketCap) ?? num(pair.fdv),
    volumeUsd24h: volume ? num(volume.h24) : null,
    liquidityUsd: liquidity ? num(liquidity.usd) : null,
    pairAddress: typeof pair.pairAddress === 'string' ? pair.pairAddress : null,
    dexId: typeof pair.dexId === 'string' ? pair.dexId : null,
    url: typeof pair.url === 'string' ? pair.url : null,
  };
}

/** Best-effort Dexscreener lookup (3s timeout). Null when unavailable. */
export async function fetchDexPair(address: string): Promise<DexPair | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    return parseDexPair(await res.json());
  } catch {
    return null;
  }
}

export interface PlatformTokenFacts {
  address: string;
  name: string;
  /** Canonical display symbol. The on-chain symbol is lowercase "polydash". */
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  priceUsd: number | null;
  priceNative: string | null;
  marketCapUsd: number | null;
  volumeUsd24h: number | null;
  liquidityUsd: number | null;
  pairAddress: string | null;
  dexId: string | null;
  dexUrl: string | null;
}

/**
 * On-chain facts for a platform token, plus Dexscreener market data when
 * it answers. Returns null only when the on-chain reads fail (unknown
 * token, or the RPC is down) — a Dexscreener outage leaves the price
 * fields null and the report still builds from on-chain facts.
 */
export async function getPlatformTokenFacts(
  client: Pick<PublicClient, 'multicall'>,
  address: string,
): Promise<PlatformTokenFacts | null> {
  const a = address as `0x${string}`;
  const [pair, res] = await Promise.all([
    fetchDexPair(address),
    client
      .multicall({
        contracts: [
          { address: a, abi: ERC20_ABI, functionName: 'name' },
          { address: a, abi: ERC20_ABI, functionName: 'symbol' },
          { address: a, abi: ERC20_ABI, functionName: 'decimals' },
          { address: a, abi: ERC20_ABI, functionName: 'totalSupply' },
        ],
        allowFailure: true,
      })
      .catch(() => null),
  ]);
  if (!res) return null;
  const [name, , decimals, totalSupply] = res;
  if (
    name.status !== 'success' ||
    decimals.status !== 'success' ||
    totalSupply.status !== 'success' ||
    typeof name.result !== 'string' ||
    typeof totalSupply.result !== 'bigint'
  ) {
    return null;
  }
  return {
    address,
    name: name.result,
    symbol: 'POLYDASH',
    decimals: Number(decimals.result),
    totalSupply: totalSupply.result,
    priceUsd: pair?.priceUsd ?? null,
    priceNative: pair?.priceNative ?? null,
    marketCapUsd: pair?.marketCapUsd ?? null,
    volumeUsd24h: pair?.volumeUsd24h ?? null,
    liquidityUsd: pair?.liquidityUsd ?? null,
    pairAddress: pair?.pairAddress ?? null,
    dexId: pair?.dexId ?? null,
    dexUrl: pair?.url ?? null,
  };
}

/**
 * The x402 token-report body for a platform token — same keys as the
 * launch report, with the fields that only make sense for launches
 * (launch contract, bonding curve, raise) set to null. Pure mapping,
 * so it is unit-testable without the network.
 */
export function platformTokenReport(facts: PlatformTokenFacts): Record<string, unknown> {
  return {
    product: 'token-report',
    tokenAddress: facts.address,
    launchAddress: null,
    platformToken: true,
    name: facts.name,
    symbol: facts.symbol,
    creator: POLYDASH_DEPLOYER,
    description: PLATFORM_TOKEN_DESCRIPTION,
    imageUri: '',
    phase: 4,
    graduated: true,
    curveProgress: null,
    priceEth: facts.priceNative != null ? Number(facts.priceNative) : null,
    marketCapUsd: facts.marketCapUsd,
    volumeUsd: facts.volumeUsd24h,
    ethRaised: null,
    totalSupply: facts.totalSupply.toString(),
    createdAt: null,
    pool:
      facts.pairAddress != null
        ? {
            pairAddress: facts.pairAddress,
            dexId: facts.dexId,
            liquidityUsd: facts.liquidityUsd,
            url: facts.dexUrl,
          }
        : null,
    chain: 'Robinhood Chain',
    chainId: 4663,
  };
}
