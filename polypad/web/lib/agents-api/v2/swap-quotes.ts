/**
 * Multi-route swap quotes on Robinhood Chain (4663).
 *
 * Compares one swap across four venues and returns the best route:
 *   - Velora (ParaSwap v5 prices API) — keyless, live on 4663.
 *   - KyberSwap Aggregator API — keyless at low volume; set KYBERSWAP_CLIENT_ID
 *     for a higher limit. May 429 on a shared egress IP; that degrades to
 *     "unavailable", it never fails the whole call.
 *   - Bitget Wallet Trading API (Instruction Mode) — needs BITGET_WALLET_API_KEY
 *     + BITGET_WALLET_API_SECRET (apply at portal-web3.bitget.com). Until they
 *     are set the route reports "not_configured" instead of quoting.
 *   - Uniswap — quoted on-chain through the V4 quoter already used by
 *     polypad_quote_trade, probing the standard fee tiers plus the two launch
 *     hooks, so graduated launch tokens quote too. No API key.
 *
 * Read-only. No tool here signs, prepares, or moves anything: execution still
 * goes through the agent wallet's own limits via the prepare tools. A quote is
 * one reading at one moment, never a promise. Every provider is best-effort
 * with its own timeout; a provider that cannot quote reports why instead of
 * failing the whole call.
 */
import { createHmac } from 'node:crypto';
import { getAddress, isAddress, zeroAddress } from 'viem';
import { erc20Abi, v4QuoterAbi } from './abis';
import { ADDR, CHAIN_ID, NATIVE } from './config';
import { ApiError, cached, parseUnits10, slippageOf, unitsDisplay, type Ctx } from './core';

const EEEE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;
const FETCH_TIMEOUT_MS = 8_000;

export type AggregatorName = 'velora' | 'kyberswap' | 'bitget' | 'uniswap';

export type SwapToken = {
  /** Address used on-chain (zero address for native ETH, WETH for WETH). */
  address: string;
  /** Address used in aggregator HTTP APIs (0xEeee… for native ETH). */
  apiAddress: string;
  symbol: string;
  decimals: number;
};

const KNOWN: Record<string, SwapToken> = {
  eth: { address: NATIVE, apiAddress: EEEE, symbol: 'ETH', decimals: 18 },
  weth: { address: ADDR.weth, apiAddress: ADDR.weth, symbol: 'WETH', decimals: 18 },
  usdg: { address: USDG, apiAddress: USDG, symbol: 'USDG', decimals: 6 },
  polydash: { address: ADDR.polydashToken, apiAddress: ADDR.polydashToken, symbol: 'POLYDASH', decimals: 18 },
};

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export async function resolveSwapToken(ctx: Ctx, ref: unknown): Promise<SwapToken> {
  const raw = String(ref ?? '').trim();
  if (!raw) throw new ApiError(400, 'invalid_params', 'tokenIn and tokenOut are required: a token address or a symbol (ETH, WETH, USDG, POLYDASH).', { field: 'tokenIn' });
  const known = KNOWN[raw.toLowerCase()];
  if (known) return known;
  if (!isAddress(raw)) throw new ApiError(400, 'invalid_params', `Unknown token "${raw}". Pass a token address on Robinhood Chain, or a symbol (ETH, WETH, USDG, POLYDASH).`, { field: 'tokenIn' });
  const address = getAddress(raw);
  if (address === zeroAddress) return KNOWN.eth;
  const meta = await cached(ctx, `swap-token:${address.toLowerCase()}`, 3_600_000, async () => {
    const [decimals, symbol] = await Promise.all([
      ctx.client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
      ctx.client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }).catch(() => shortAddr(address)),
    ]);
    return { decimals: Number(decimals), symbol: String(symbol) };
  });
  return { address, apiAddress: address, symbol: meta.symbol, decimals: meta.decimals };
}

type RouteQuote = {
  aggregator: AggregatorName;
  status: 'ok' | 'unavailable' | 'not_configured';
  amountOut?: bigint;
  route?: string;
  gasUsd?: string | null;
  reason?: string;
};

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<unknown>;
}

function unavailable(aggregator: RouteQuote['aggregator'], reason: string): RouteQuote {
  return { aggregator, status: 'unavailable', reason };
}

/** Velora (ParaSwap v5). Keyless. Verified live on 4663. */
async function quoteVelora(tokenIn: SwapToken, tokenOut: SwapToken, amountIn: bigint): Promise<RouteQuote> {
  try {
    const url =
      `https://apiv5.paraswap.io/prices?network=${CHAIN_ID}` +
      `&srcToken=${tokenIn.apiAddress}&destToken=${tokenOut.apiAddress}` +
      `&amount=${amountIn.toString()}&srcDecimals=${tokenIn.decimals}&destDecimals=${tokenOut.decimals}&side=SELL`;
    const j = (await fetchJson(url)) as { priceRoute?: { destAmount?: string; gasCostUSD?: string; bestRoute?: { swaps?: { swapExchanges?: { exchange: string; percent: number }[] }[] }[] } };
    const pr = j.priceRoute;
    if (!pr?.destAmount) return unavailable('velora', 'Velora returned no price for this pair.');
    const out = BigInt(pr.destAmount);
    if (out <= 0n) return unavailable('velora', 'Velora quoted zero output for this pair.');
    const first = pr.bestRoute?.[0]?.swaps ?? [];
    const venues = first.flatMap((s) => (s.swapExchanges ?? []).map((e) => `${e.exchange} ${e.percent}%`));
    return {
      aggregator: 'velora',
      status: 'ok',
      amountOut: out,
      route: venues.length ? `Velora via ${venues.join(' + ')}` : 'Velora aggregated route',
      gasUsd: pr.gasCostUSD ?? null,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 429) return unavailable('velora', 'Velora rate-limited this server (429). Try again shortly.');
    return unavailable('velora', 'Velora did not answer.');
  }
}

/** KyberSwap Aggregator API. Keyless at low volume; 429s degrade, never fail the call. */
async function quoteKyberSwap(tokenIn: SwapToken, tokenOut: SwapToken, amountIn: bigint): Promise<RouteQuote> {
  try {
    const url =
      `https://aggregator-api.kyberswap.com/robinhood/api/v1/routes` +
      `?tokenIn=${tokenIn.apiAddress}&tokenOut=${tokenOut.apiAddress}&amountIn=${amountIn.toString()}&gasInclude=true`;
    const j = (await fetchJson(url, {
      headers: { 'X-Client-Id': process.env.KYBERSWAP_CLIENT_ID?.trim() || 'polypad' },
    })) as { data?: { routeSummary?: { amountOut?: string; gasUsd?: string } } };
    const summary = j.data?.routeSummary;
    if (!summary?.amountOut) return unavailable('kyberswap', 'KyberSwap returned no route for this pair. Its index drops quiet pools on Robinhood Chain.');
    const out = BigInt(summary.amountOut);
    if (out <= 0n) return unavailable('kyberswap', 'KyberSwap quoted zero output for this pair.');
    return {
      aggregator: 'kyberswap',
      status: 'ok',
      amountOut: out,
      route: 'KyberSwap aggregated route',
      gasUsd: summary.gasUsd ?? null,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 429) return unavailable('kyberswap', 'KyberSwap rate-limited this server (429). Set KYBERSWAP_CLIENT_ID for a higher limit, or try again shortly.');
    return unavailable('kyberswap', 'KyberSwap did not answer.');
  }
}

/** Bitget Wallet Trading API, Instruction Mode. Dormant until the API key is set. */
async function quoteBitget(tokenIn: SwapToken, tokenOut: SwapToken, amountIn: bigint): Promise<RouteQuote> {
  const key = process.env.BITGET_WALLET_API_KEY?.trim();
  const secret = process.env.BITGET_WALLET_API_SECRET?.trim();
  if (!key || !secret) {
    return {
      aggregator: 'bitget',
      status: 'not_configured',
      reason: 'Bitget Wallet API key is not set on the server. Apply at portal-web3.bitget.com and set BITGET_WALLET_API_KEY + BITGET_WALLET_API_SECRET to enable this route.',
    };
  }
  try {
    const path = '/bgw-pro/swapx/pro/quote';
    const bodyObj = {
      fromChain: 'robinhood',
      toChain: 'robinhood',
      fromContract: tokenIn.apiAddress,
      toContract: tokenOut.apiAddress,
      fromAmount: amountIn.toString(),
      amountUnit: 'wei',
    };
    const body = JSON.stringify(bodyObj);
    const timestamp = String(Date.now());
    // Signature: HMAC-SHA256 over the JSON of {apiPath, body, x-api-key,
    // x-api-timestamp} with keys sorted alphabetically, base64-encoded.
    const content = JSON.stringify({ apiPath: path, body, 'x-api-key': key, 'x-api-timestamp': timestamp });
    const signature = createHmac('sha256', secret).update(content).digest('base64');
    const j = (await fetchJson(`https://bopenapi.bgwapi.io${path}`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'x-api-timestamp': timestamp, 'x-api-signature': signature, 'content-type': 'application/json' },
      body,
    })) as { status?: number; msg?: string; data?: { toAmount?: string; market?: string; slippage?: string } };
    if (j.status !== 0 || !j.data?.toAmount) {
      return unavailable('bitget', `Bitget Wallet returned no quote (${j.msg ?? `status ${j.status ?? 'unknown'}`}).`);
    }
    const out = BigInt(j.data.toAmount);
    if (out <= 0n) return unavailable('bitget', 'Bitget Wallet quoted zero output for this pair.');
    return {
      aggregator: 'bitget',
      status: 'ok',
      amountOut: out,
      route: j.data.market ? `Bitget Wallet via ${j.data.market}` : 'Bitget Wallet aggregated route',
      gasUsd: null,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 429) return unavailable('bitget', 'Bitget Wallet rate-limited this server (429). Try again shortly.');
    if (status === 403) return unavailable('bitget', 'Bitget Wallet rejected the API key (403). Check BITGET_WALLET_API_KEY + BITGET_WALLET_API_SECRET.');
    return unavailable('bitget', 'Bitget Wallet did not answer.');
  }
}

export type UniswapPoolProbe = {
  out: bigint;
  fee: number;
  tickSpacing: number;
  hook: string;
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  zeroForOne: boolean;
};

/**
 * Probes the V4 quoter for the best pool for this pair: the standard fee
 * tiers with no hook, plus the two launch hooks at the launch fee config.
 * Shared by the quote tool and the prepare tool, so both agree on the pool.
 * Returns null when no probed pool quotes.
 */
export async function findUniswapPool(ctx: Ctx, tokenIn: SwapToken, tokenOut: SwapToken, amountIn: bigint): Promise<UniswapPoolProbe | null> {
  const a = tokenIn.address.toLowerCase();
  const b = tokenOut.address.toLowerCase();
  const currency0 = (a < b ? tokenIn.address : tokenOut.address) as `0x${string}`;
  const currency1 = (a < b ? tokenOut.address : tokenIn.address) as `0x${string}`;
  const zeroForOne = a === currency0.toLowerCase();
  const hooks = [zeroAddress, ...ADDR.launchFactories.map((f) => f.hook)];
  const candidates: { fee: number; tickSpacing: number; hook: string }[] = [
    { fee: 500, tickSpacing: 10, hook: zeroAddress },
    { fee: 3000, tickSpacing: 60, hook: zeroAddress },
    { fee: 3000, tickSpacing: 50, hook: zeroAddress },
    { fee: 100, tickSpacing: 1, hook: zeroAddress },
    { fee: 10000, tickSpacing: 200, hook: zeroAddress },
    { fee: 0, tickSpacing: 200, hook: hooks[1] },
    { fee: 0, tickSpacing: 200, hook: hooks[2] },
  ];
  let best: UniswapPoolProbe | null = null;
  for (const c of candidates) {
    try {
      const r = await ctx.client.simulateContract({
        address: ADDR.v4Quoter,
        abi: v4QuoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [{
          poolKey: { currency0, currency1, fee: c.fee, tickSpacing: c.tickSpacing, hooks: c.hook as `0x${string}` },
          zeroForOne,
          exactAmount: amountIn,
          hookData: '0x',
        }],
      });
      const out = r.result[0] as bigint;
      if (out > 0n && (!best || out > best.out)) best = { out, fee: c.fee, tickSpacing: c.tickSpacing, hook: c.hook, currency0, currency1, zeroForOne };
    } catch {
      // No pool at this fee tier / hook — try the next candidate.
    }
  }
  return best;
}

/**
 * Uniswap, quoted on-chain through the V4 quoter. Probes the standard fee
 * tiers with no hook, plus the two launch hooks at the launch fee config, so
 * graduated launch tokens quote too. Takes the best tier that quotes.
 */
async function quoteUniswap(ctx: Ctx, tokenIn: SwapToken, tokenOut: SwapToken, amountIn: bigint): Promise<RouteQuote> {
  const best = await findUniswapPool(ctx, tokenIn, tokenOut, amountIn);
  if (!best) return unavailable('uniswap', 'No Uniswap V4 pool on Robinhood Chain quoted this pair at any probed fee tier.');
  // V4 fees are in hundredths of a basis point: 500 = 0.05%, 3000 = 0.3%, 10000 = 1%.
  const feePct = best.fee === 0 ? '0' : String(best.fee / 10000);
  return {
    aggregator: 'uniswap',
    status: 'ok',
    amountOut: best.out,
    route: `Uniswap V4 pool, ${feePct}% fee${best.hook !== zeroAddress ? ' (launch pool)' : ''}`,
    gasUsd: null,
  };
}

function viewRoute(r: RouteQuote, tokenOut: SwapToken): Record<string, unknown> {
  if (r.status !== 'ok' || r.amountOut === undefined) {
    return { aggregator: r.aggregator, status: r.status, reason: r.reason ?? 'No quote.' };
  }
  return {
    aggregator: r.aggregator,
    status: 'ok',
    amountOut: r.amountOut.toString(),
    amountOutDisplay: `${unitsDisplay(r.amountOut, tokenOut.decimals)} ${tokenOut.symbol}`,
    route: r.route ?? '',
    gasUsd: r.gasUsd ?? null,
  };
}

export async function quoteSwap(ctx: Ctx, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tokenIn = await resolveSwapToken(ctx, input.tokenIn ?? input.from);
  const tokenOut = await resolveSwapToken(ctx, input.tokenOut ?? input.to);
  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
    throw new ApiError(400, 'invalid_params', 'tokenIn and tokenOut are the same token.', { field: 'tokenOut' });
  }
  const amountIn = parseUnits10(input.amountIn ?? input.amount, 'amountIn');
  if (amountIn <= 0n) throw new ApiError(400, 'invalid_params', 'amountIn must be above zero.', { field: 'amountIn' });
  const slippageBps = slippageOf(input);

  const routes = await Promise.all([
    quoteVelora(tokenIn, tokenOut, amountIn),
    quoteKyberSwap(tokenIn, tokenOut, amountIn),
    quoteBitget(tokenIn, tokenOut, amountIn),
    quoteUniswap(ctx, tokenIn, tokenOut, amountIn),
  ]);
  const ok = routes.filter((r) => r.status === 'ok' && r.amountOut !== undefined) as (RouteQuote & { amountOut: bigint })[];
  const best = ok.length ? ok.reduce((x, y) => (y.amountOut > x.amountOut ? y : x)) : null;
  const bestMin = best ? (best.amountOut * BigInt(10_000 - slippageBps)) / 10_000n : null;

  const notes: string[] = [];
  for (const r of routes) {
    if (r.status === 'unavailable') notes.push(`${r.aggregator}: no quote — ${r.reason ?? 'did not answer'}`);
    if (r.status === 'not_configured') notes.push(`${r.aggregator}: not configured — ${r.reason ?? ''}`);
  }
  if (!best) notes.push('No aggregator could quote this pair right now. The pair may have no liquid route on Robinhood Chain, or the quote services are briefly down.');

  return {
    ok: true,
    chainId: CHAIN_ID,
    tokenIn: { address: tokenIn.address, symbol: tokenIn.symbol, decimals: tokenIn.decimals },
    tokenOut: { address: tokenOut.address, symbol: tokenOut.symbol, decimals: tokenOut.decimals },
    amountIn: amountIn.toString(),
    amountInDisplay: `${unitsDisplay(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`,
    slippageBps,
    routes: routes.map((r) => viewRoute(r, tokenOut)),
    best: best?.aggregator ?? null,
    bestAmountOut: best?.amountOut.toString() ?? null,
    bestAmountOutDisplay: best ? `${unitsDisplay(best.amountOut, tokenOut.decimals)} ${tokenOut.symbol}` : null,
    bestMinAmountOut: bestMin?.toString() ?? null,
    bestMinAmountOutDisplay: bestMin ? `${unitsDisplay(bestMin, tokenOut.decimals)} ${tokenOut.symbol}` : null,
    notes,
    reading: 'A quote is one reading at one moment. It is not a promise of what a later trade will receive. Execution is a separate step, inside the agent wallet limits.',
  };
}
