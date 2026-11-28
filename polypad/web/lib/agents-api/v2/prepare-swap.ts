/**
 * Prepare a swap across aggregators (Velora, KyberSwap, Bitget Wallet, Uniswap).
 *
 * The quote tool compares routes; this tool executes the chosen one. It
 * re-quotes fresh, picks the best route (or the requested venue), calls that
 * venue's build endpoint for the unsigned transaction, prepends the
 * exact-amount approval step when the wallet has not approved the venue yet,
 * simulates the first step on-chain, and returns the unsigned transactions
 * plus a one-tap signing link — the same prepare pattern as prepareBuy /
 * prepareSell. Nothing is signed here. The signing page rebuilds the same
 * action from the link parameters (the venue is pinned in the link, so a
 * price move cannot silently switch venues between chat and signing).
 *
 * Venue build endpoints:
 *   - Velora (ParaSwap v5): GET /prices, then POST /transactions/4663 with
 *     the fresh priceRoute and slippage only (slippage AND destAmount
 *     together is a 400). ?ignoreChecks=true because the approval step, when
 *     needed, is part of this same prepared action and has not happened yet.
 *   - KyberSwap: GET /routes, then POST /route/build with the fresh
 *     routeSummary. Response data.data is the calldata, data.routerAddress
 *     is the target (and the approval spender).
 *   - Bitget Wallet: POST /quote for the market channel, then POST /swap
 *     with that market. Dormant until BITGET_WALLET_API_KEY +
 *     BITGET_WALLET_API_SECRET are set — never a faked transaction.
 *   - Uniswap: the quoter's pool probe (findUniswapPool) plus the same
 *     Universal Router encoding as the launch-token trades, with the
 *     Permit2 approval steps from prepareSell.
 *
 * The transaction value is derived, never trusted from an API response:
 * native ETH in means value = amountIn, an ERC20 in means value = 0.
 * Attribution is off for these steps: the attribution suffix must never be
 * appended to third-party aggregator calldata.
 */
import { createHmac } from 'node:crypto';
import { encodeAbiParameters, encodeFunctionData, getAddress, isAddress, maxUint160, type Hex } from 'viem';
import { erc20Abi, permit2Abi, poolKeyParam, universalRouterAbi } from './abis';
import { ADDR, CHAIN_ID, LIMITS, NATIVE } from './config';
import {
  ApiError, assertNotFeeWallet, bodyGuard, ethDisplay, guardAmountWei, parseUnits10, reqAddress, slippageOf, unitsDisplay,
  type Addr, type Ctx, type Meta,
} from './core';
import { finishPrepared, validReturnUrl, type StepInput } from './prepared';
import { findUniswapPool, quoteSwap, resolveSwapToken, type AggregatorName, type SwapToken, type UniswapPoolProbe } from './swap-quotes';
import { RISKS } from './trade';

const FETCH_TIMEOUT_MS = 8_000;

const VENUE_LABEL: Record<AggregatorName, string> = {
  velora: 'Velora',
  kyberswap: 'KyberSwap',
  bitget: 'Bitget Wallet',
  uniswap: 'Uniswap',
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

/** A venue that cannot build degrades to a clear error, never a faked transaction. */
function buildFailed(venue: string, err: unknown): ApiError {
  const status = (err as { status?: number }).status;
  if (status === 429) return new ApiError(503, 'aggregator_unavailable', `${venue} rate-limited this server (429). Try again shortly.`);
  if (status === 403) return new ApiError(422, 'swap_build_failed', `${venue} rejected the request (403). Check the server configuration.`);
  if (status !== undefined) return new ApiError(422, 'swap_build_failed', `${venue} could not build this swap (HTTP ${status}). Try again or pick another route.`);
  return new ApiError(503, 'aggregator_unavailable', `${venue} did not answer. Try again shortly.`);
}

function asRouter(v: unknown): Addr {
  if (typeof v !== 'string' || !isAddress(v)) throw new ApiError(422, 'swap_build_failed', 'The aggregator returned an unusable router address. Try again or pick another route.');
  return getAddress(v);
}

function asCalldata(v: unknown): Hex {
  if (typeof v !== 'string' || !v.startsWith('0x') || v.length < 10) throw new ApiError(422, 'swap_build_failed', 'The aggregator returned unusable transaction data. Try again or pick another route.');
  return v as Hex;
}

type BuiltSwap = {
  to: Addr;
  data: Hex;
  value: bigint;
  routeLabel: string;
  /** Fresh expected output, when the venue returns one. Otherwise the quote's figure is used. */
  expectedOut?: bigint;
};

function parseAggregator(v: unknown): AggregatorName | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === 'velora' || s === 'kyberswap' || s === 'bitget' || s === 'uniswap') return s;
  throw new ApiError(400, 'invalid_params', 'aggregator must be one of velora, kyberswap, bitget, uniswap.', { field: 'aggregator' });
}

// ---------------------------------------------------------------- Velora (ParaSwap v5)

async function buildVelora(tokenIn: SwapToken, tokenOut: SwapToken, amountIn: bigint, from: Addr, slip: number, isNativeIn: boolean): Promise<BuiltSwap> {
  try {
    const url =
      `https://apiv5.paraswap.io/prices?network=${CHAIN_ID}` +
      `&srcToken=${tokenIn.apiAddress}&destToken=${tokenOut.apiAddress}` +
      `&amount=${amountIn.toString()}&srcDecimals=${tokenIn.decimals}&destDecimals=${tokenOut.decimals}&side=SELL`;
    const j = (await fetchJson(url)) as { priceRoute?: { destAmount?: string } };
    const pr = j.priceRoute;
    if (!pr?.destAmount) throw new ApiError(422, 'swap_build_failed', 'Velora returned no price for this pair right now.');
    // slippage only: passing destAmount as well is a 400 ("Cannot specify
    // both slippage and destAmount"). ignoreChecks: the approval step, when
    // needed, is part of this same prepared action and has not happened yet.
    const tx = (await fetchJson(`https://apiv5.paraswap.io/transactions/${CHAIN_ID}?ignoreChecks=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        srcToken: tokenIn.apiAddress,
        destToken: tokenOut.apiAddress,
        srcAmount: amountIn.toString(),
        userAddress: from,
        receiver: from,
        slippage: slip,
        priceRoute: pr,
      }),
    })) as { to?: unknown; data?: unknown };
    return {
      to: asRouter(tx.to),
      data: asCalldata(tx.data),
      value: isNativeIn ? amountIn : 0n,
      routeLabel: 'Velora aggregated route',
      expectedOut: BigInt(pr.destAmount),
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw buildFailed('Velora', err);
  }
}

// ---------------------------------------------------------------- KyberSwap

async function buildKyberSwap(ctx: Ctx, tokenIn: SwapToken, tokenOut: SwapToken, amountIn: bigint, from: Addr, slip: number, isNativeIn: boolean): Promise<BuiltSwap> {
  const headers = { 'X-Client-Id': process.env.KYBERSWAP_CLIENT_ID?.trim() || 'polypad' };
  try {
    const url =
      `https://aggregator-api.kyberswap.com/robinhood/api/v1/routes` +
      `?tokenIn=${tokenIn.apiAddress}&tokenOut=${tokenOut.apiAddress}&amountIn=${amountIn.toString()}&gasInclude=true`;
    const j = (await fetchJson(url, { headers })) as { data?: { routeSummary?: Record<string, unknown> & { amountOut?: string }; routerAddress?: unknown } };
    const summary = j.data?.routeSummary;
    const router = j.data?.routerAddress;
    if (!summary?.amountOut || !router) throw new ApiError(422, 'swap_build_failed', 'KyberSwap returned no route for this pair. Its index drops quiet pools on Robinhood Chain.');
    const deadline = ctx.nowSec() + LIMITS.deadlineSeconds;
    const b = (await fetchJson('https://aggregator-api.kyberswap.com/robinhood/api/v1/route/build', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        routeSummary: summary,
        sender: from,
        recipient: from,
        slippageTolerance: slip,
        deadline,
      }),
    })) as { data?: { data?: unknown; routerAddress?: unknown; amountOut?: string } };
    const d = b.data;
    if (!d?.data || !d?.routerAddress) throw new ApiError(422, 'swap_build_failed', 'KyberSwap could not build this route. Try again or pick another route.');
    return {
      to: asRouter(d.routerAddress),
      data: asCalldata(d.data),
      value: isNativeIn ? amountIn : 0n,
      routeLabel: 'KyberSwap aggregated route',
      expectedOut: d.amountOut ? BigInt(d.amountOut) : BigInt(summary.amountOut),
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw buildFailed('KyberSwap', err);
  }
}

// ---------------------------------------------------------------- Bitget Wallet

function bitgetKeys(): { key: string; secret: string } {
  const key = process.env.BITGET_WALLET_API_KEY?.trim();
  const secret = process.env.BITGET_WALLET_API_SECRET?.trim();
  if (!key || !secret) {
    throw new ApiError(409, 'aggregator_not_configured', 'Bitget Wallet API key is not set on the server. Apply at portal-web3.bitget.com and set BITGET_WALLET_API_KEY + BITGET_WALLET_API_SECRET to enable this route.');
  }
  return { key, secret };
}

/** Same HMAC-SHA256 signing as the Bitget quote call in swap-quotes.ts. */
async function bitgetSignedPost(path: string, bodyObj: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { key, secret } = bitgetKeys();
  const body = JSON.stringify(bodyObj);
  const timestamp = String(Date.now());
  // Signature: HMAC-SHA256 over the JSON of {apiPath, body, x-api-key,
  // x-api-timestamp} with keys sorted alphabetically, base64-encoded.
  const content = JSON.stringify({ apiPath: path, body, 'x-api-key': key, 'x-api-timestamp': timestamp });
  const signature = createHmac('sha256', secret).update(content).digest('base64');
  return (await fetchJson(`https://bopenapi.bgwapi.io${path}`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'x-api-timestamp': timestamp, 'x-api-signature': signature, 'content-type': 'application/json' },
    body,
  })) as Record<string, unknown>;
}

async function buildBitget(tokenIn: SwapToken, tokenOut: SwapToken, amountIn: bigint, from: Addr, slip: number, isNativeIn: boolean): Promise<BuiltSwap> {
  bitgetKeys();
  try {
    // The swap call needs the market (channel) the quote returns, so quote
    // fresh first, addressed to this wallet.
    const q = (await bitgetSignedPost('/bgw-pro/swapx/pro/quote', {
      fromChain: 'robinhood',
      toChain: 'robinhood',
      fromContract: tokenIn.apiAddress,
      toContract: tokenOut.apiAddress,
      fromAmount: amountIn.toString(),
      amountUnit: 'wei',
      fromAddress: from,
      toAddress: from,
    })) as { status?: number; msg?: string; data?: { toAmount?: string; market?: string } };
    if (q.status !== 0 || !q.data?.toAmount || !q.data?.market) {
      throw new ApiError(422, 'swap_build_failed', `Bitget Wallet returned no quote for this pair (${q.msg ?? `status ${q.status ?? 'unknown'}`}).`);
    }
    const s = (await bitgetSignedPost('/bgw-pro/swapx/pro/swap', {
      fromChain: 'robinhood',
      toChain: 'robinhood',
      fromContract: tokenIn.apiAddress,
      toContract: tokenOut.apiAddress,
      fromAmount: amountIn.toString(),
      amountUnit: 'wei',
      fromAddress: from,
      toAddress: from,
      market: q.data.market,
      slippage: slip / 100,
      deadline: 600,
    })) as { status?: number; msg?: string; data?: { contract?: unknown; calldata?: unknown } };
    if (s.status !== 0 || !s.data?.calldata || !s.data?.contract) {
      throw new ApiError(422, 'swap_build_failed', `Bitget Wallet could not build this swap (${s.msg ?? `status ${s.status ?? 'unknown'}`}).`);
    }
    return {
      to: asRouter(s.data.contract),
      data: asCalldata(s.data.calldata),
      value: isNativeIn ? amountIn : 0n,
      routeLabel: `Bitget Wallet via ${q.data.market}`,
      expectedOut: BigInt(q.data.toAmount),
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw buildFailed('Bitget Wallet', err);
  }
}

// ---------------------------------------------------------------- Uniswap V4

const ACTIONS = '0x060c0f' as const; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL

/** Same Universal Router encoding as encodeV4Swap in trade.ts, for any pool. */
function encodeGenericV4Swap(pool: UniswapPoolProbe, amountIn: bigint, minOut: bigint, deadline: bigint): Hex {
  const poolKey = {
    currency0: pool.currency0,
    currency1: pool.currency1,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: pool.hook as `0x${string}`,
  };
  const swap = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', ...poolKeyParam },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'minHopPriceX36', type: 'uint256' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [{ poolKey, zeroForOne: pool.zeroForOne, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: '0x' }],
  );
  const inCurrency = pool.zeroForOne ? pool.currency0 : pool.currency1;
  const outCurrency = pool.zeroForOne ? pool.currency1 : pool.currency0;
  const settle = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [inCurrency, amountIn]);
  const take = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [outCurrency, minOut]);
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [ACTIONS, [swap, settle, take]]);
  return encodeFunctionData({ abi: universalRouterAbi, functionName: 'execute', args: ['0x10', [input], deadline] });
}

async function buildUniswap(ctx: Ctx, tokenIn: SwapToken, tokenOut: SwapToken, amountIn: bigint, slip: number, isNativeIn: boolean): Promise<BuiltSwap> {
  const pool = await findUniswapPool(ctx, tokenIn, tokenOut, amountIn);
  if (!pool) throw new ApiError(409, 'aggregator_no_quote', 'No Uniswap V4 pool on Robinhood Chain quoted this pair at any probed fee tier.');
  const minOut = (pool.out * BigInt(10_000 - slip)) / 10_000n;
  const deadline = BigInt(ctx.nowSec() + LIMITS.deadlineSeconds);
  // V4 fees are in hundredths of a basis point: 500 = 0.05%, 3000 = 0.3%, 10000 = 1%.
  const feePct = pool.fee === 0 ? '0' : String(pool.fee / 10000);
  return {
    to: ADDR.universalRouter,
    data: encodeGenericV4Swap(pool, amountIn, minOut, deadline),
    value: isNativeIn ? amountIn : 0n,
    routeLabel: `Uniswap V4 pool, ${feePct}% fee${pool.hook !== '0x0000000000000000000000000000000000000000' ? ' (launch pool)' : ''}`,
    expectedOut: pool.out,
  };
}

// ---------------------------------------------------------------- prepare_swap

export async function prepareSwap(ctx: Ctx, rawInput: unknown, meta: Meta): Promise<Record<string, unknown>> {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const tokenIn = await resolveSwapToken(ctx, input.tokenIn ?? input.from);
  const tokenOut = await resolveSwapToken(ctx, input.tokenOut ?? input.to);
  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
    throw new ApiError(400, 'invalid_params', 'tokenIn and tokenOut are the same token.', { field: 'tokenOut' });
  }
  const amountIn = parseUnits10(input.amountIn ?? input.amount, 'amountIn');
  if (amountIn <= 0n) throw new ApiError(400, 'invalid_params', 'amountIn must be above zero.', { field: 'amountIn' });
  const isNativeIn = tokenIn.address.toLowerCase() === NATIVE.toLowerCase();
  // The 25 ETH per-action cap and the large-amount confirmation apply to
  // native ETH, whose amount is in wei. ERC20 amounts follow prepareSell:
  // the balance check bounds them.
  if (isNativeIn) guardAmountWei(amountIn, input, 'amountIn');

  if (isNativeIn) {
    const bal = await ctx.client.getBalance({ address: from });
    if (bal < amountIn) throw new ApiError(409, 'insufficient_balance', `The wallet holds ${ethDisplay(bal)} ETH, less than the ${ethDisplay(amountIn)} ETH requested.`, { balanceWei: bal.toString() });
  } else {
    const bal = (await ctx.client.readContract({ address: tokenIn.address as Addr, abi: erc20Abi, functionName: 'balanceOf', args: [from] })) as bigint;
    if (bal < amountIn) throw new ApiError(409, 'insufficient_balance', `The wallet holds ${unitsDisplay(bal, tokenIn.decimals)} ${tokenIn.symbol}, less than the ${unitsDisplay(amountIn, tokenIn.decimals)} ${tokenIn.symbol} requested.`, { balance: bal.toString() });
  }

  const slip = slippageOf(input);
  const requested = parseAggregator(input.aggregator);

  // Fresh quote: picks the venue and the expected amounts for the summary.
  // The builders below re-fetch their own fresh route, so the transaction is
  // built from a route seconds old, never from a stale quote.
  const q = await quoteSwap(ctx, input);
  const routes = q.routes as { aggregator: string; status: string; amountOut?: string; reason?: string }[];
  const best = q.best as string | null;
  if (!best) {
    throw new ApiError(409, 'no_swap_route', 'No aggregator could quote this pair right now. The pair may have no liquid route on Robinhood Chain, or the quote services are briefly down.', { notes: q.notes });
  }
  let venue: AggregatorName;
  if (requested) {
    const route = routes.find((r) => r.aggregator === requested);
    if (!route || route.status !== 'ok') {
      throw new ApiError(409, 'aggregator_no_quote', `${VENUE_LABEL[requested]} could not quote this pair${route?.reason ? ` — ${route.reason}` : '.'} Pick another route, or leave aggregator out to take the best.`, { aggregator: requested });
    }
    venue = requested;
  } else {
    venue = best as AggregatorName;
  }

  let built: BuiltSwap;
  if (venue === 'velora') built = await buildVelora(tokenIn, tokenOut, amountIn, from, slip, isNativeIn);
  else if (venue === 'kyberswap') built = await buildKyberSwap(ctx, tokenIn, tokenOut, amountIn, from, slip, isNativeIn);
  else if (venue === 'bitget') built = await buildBitget(tokenIn, tokenOut, amountIn, from, slip, isNativeIn);
  else built = await buildUniswap(ctx, tokenIn, tokenOut, amountIn, slip, isNativeIn);

  // Approval step(s), exactly like prepareSell: the exact amount, no more.
  // The main swap step is simulated only when nothing precedes it — the
  // signing page re-checks the later steps after the approvals confirm.
  const steps: StepInput[] = [];
  if (!isNativeIn) {
    if (venue === 'uniswap') {
      const spender: Addr = ADDR.permit2;
      const allowance = (await ctx.client.readContract({ address: tokenIn.address as Addr, abi: erc20Abi, functionName: 'allowance', args: [from, spender] })) as bigint;
      if (allowance < amountIn) {
        steps.push({
          kind: 'approve',
          description: 'Approve Permit2 to take exactly this many tokens.',
          to: tokenIn.address as Addr,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amountIn] }),
          value: 0n,
          simulate: true,
        });
      }
      const nowS = ctx.nowSec();
      const p2 = (await ctx.client.readContract({ address: ADDR.permit2, abi: permit2Abi, functionName: 'allowance', args: [from, tokenIn.address as Addr, ADDR.universalRouter] })) as readonly [bigint, number, number];
      const p2ok = p2[0] >= amountIn && (p2[1] === 0 ? false : p2[1] > nowS + 600);
      if (!p2ok) {
        steps.push({
          kind: 'permit2_approve',
          description: 'Let the Universal Router pull exactly this many tokens through Permit2, for the next 30 minutes.',
          to: ADDR.permit2,
          data: encodeFunctionData({ abi: permit2Abi, functionName: 'approve', args: [tokenIn.address as Addr, ADDR.universalRouter, amountIn > maxUint160 ? maxUint160 : amountIn, nowS + 1800] }),
          value: 0n,
          simulate: steps.length === 0,
        });
      }
    } else {
      const spender = built.to;
      const allowance = (await ctx.client.readContract({ address: tokenIn.address as Addr, abi: erc20Abi, functionName: 'allowance', args: [from, spender] })) as bigint;
      if (allowance < amountIn) {
        steps.push({
          kind: 'approve',
          description: `Approve ${VENUE_LABEL[venue]} to take exactly this many tokens.`,
          to: tokenIn.address as Addr,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amountIn] }),
          value: 0n,
          simulate: true,
        });
      }
    }
  }

  const routeOut = routes.find((r) => r.aggregator === venue)?.amountOut;
  const expectedOut = built.expectedOut ?? (routeOut ? BigInt(routeOut) : 0n);
  const minOut = (expectedOut * BigInt(10_000 - slip)) / 10_000n;
  steps.push({
    kind: 'swap',
    description: `Swap on ${VENUE_LABEL[venue]}. Send after the approval, if any, is confirmed.`,
    to: built.to,
    data: built.data,
    value: built.value,
    simulate: steps.length === 0,
  });

  const warnings: string[] = [...(q.notes as string[])];
  if (requested && requested !== best) {
    warnings.push(`You asked for ${VENUE_LABEL[requested]}; the best quote this moment was ${VENUE_LABEL[best as AggregatorName]}. The transaction still uses ${VENUE_LABEL[requested]}.`);
  }

  const headline = `Swap ${unitsDisplay(amountIn, tokenIn.decimals)} ${tokenIn.symbol} for ${tokenOut.symbol} via ${VENUE_LABEL[venue]}`;
  const lines = [
    `Venue: ${built.routeLabel}`,
    `Expected: about ${unitsDisplay(expectedOut, tokenOut.decimals)} ${tokenOut.symbol}`,
    `Minimum you receive: ${unitsDisplay(minOut, tokenOut.decimals)} ${tokenOut.symbol} (slippage limit ${(slip / 100).toFixed(2)}%)`,
    steps.length > 1 ? `This takes ${steps.length} wallet confirmations: ${steps.map((s) => s.kind).join(', then ')}.` : 'This takes 1 wallet confirmation.',
    'The route was quoted seconds ago; the minimum protects you if the price moves before you sign.',
  ];

  return finishPrepared(ctx, {
    action: 'swap',
    // The venue is pinned in the link so the signing page rebuilds this same
    // route instead of re-picking the best at sign time.
    signParams: { ti: tokenIn.address, to: tokenOut.address, amt: amountIn.toString(), sl: slip, ag: venue },
    from,
    steps,
    meta,
    allowTargets: [built.to, tokenIn.address as Addr],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: {
      headline,
      lines,
      youPay: isNativeIn ? `${ethDisplay(amountIn)} ETH` : `${unitsDisplay(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`,
      youReceiveAtLeast: `${unitsDisplay(minOut, tokenOut.decimals)} ${tokenOut.symbol}`,
      slippageBps: slip,
      risks: RISKS,
    },
    warnings,
    attribute: false,
    extra: {
      tokenIn: { address: tokenIn.address, symbol: tokenIn.symbol, decimals: tokenIn.decimals },
      tokenOut: { address: tokenOut.address, symbol: tokenOut.symbol, decimals: tokenOut.decimals },
      aggregator: venue,
      route: built.routeLabel,
      quote: q,
    },
  });
}
