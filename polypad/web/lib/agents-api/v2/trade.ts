/**
 * Quote, buy, and sell for launch tokens.
 *   phase 3 (trading):  the launch contract is the counterparty (bonding curve).
 *   phase 4 (graduated): Uniswap V4 pool, ETH / token, through the Universal Router and Permit2.
 *   phase 1 (commit window): a buy becomes a commit, which can be withdrawn while the window is open.
 * Every function returns unsigned transactions. No key is read.
 */
import { encodeAbiParameters, encodeFunctionData, maxUint160, type Hex } from 'viem';
import { erc20Abi, launchAbi, permit2Abi, poolKeyParam, universalRouterAbi, v4QuoterAbi } from './abis';
import { ADDR, LIMITS, NATIVE, POOL_LP_FEE, POOL_TICK_SPACING, WORDING } from './config';
import {
  ApiError, assertNotFeeWallet, bodyGuard, ethDisplay, guardAmountWei, optUint, parseUnits10, reqAddress, slippageOf, unitsDisplay, E18,
  type Addr, type Ctx, type Meta,
} from './core';
import { resolveLaunch, type LaunchInfo } from './launches';
import { finishPrepared, validReturnUrl, type StepInput } from './prepared';

const BPS = 10_000n;

export type Side = 'buy' | 'sell';

export type QuoteResult = {
  side: Side;
  venue: 'bonding_curve' | 'uniswap_v4' | 'commit_window';
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  slippageBps: number;
  fees: { platformWei?: string; creatorWei?: string; taxWei?: string; totalWei?: string; note?: string };
  graduatesInThisTrade?: boolean;
  notes: string[];
};

export function poolKeyOf(l: LaunchInfo) {
  return { currency0: NATIVE, currency1: l.token, fee: POOL_LP_FEE, tickSpacing: POOL_TICK_SPACING, hooks: l.hook } as const;
}

export function parseSide(v: unknown): Side {
  if (v === 'buy' || v === 'sell') return v;
  throw new ApiError(400, 'invalid_params', 'side must be "buy" or "sell".', { field: 'side' });
}

async function v4Quote(ctx: Ctx, l: LaunchInfo, zeroForOne: boolean, amount: bigint): Promise<bigint> {
  try {
    const r = await ctx.client.simulateContract({
      address: ADDR.v4Quoter,
      abi: v4QuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ poolKey: poolKeyOf(l), zeroForOne, exactAmount: amount, hookData: '0x' }],
    });
    return r.result[0];
  } catch (err) {
    const msg = (err as { shortMessage?: string }).shortMessage ?? '';
    if (/revert/i.test(msg)) throw new ApiError(422, 'quote_failed', 'The pool could not quote that amount. Try a smaller amount.');
    throw new ApiError(503, 'rpc_unavailable', 'The chain data source did not answer.');
  }
}

export async function quoteLaunch(ctx: Ctx, l: LaunchInfo, side: Side, amount: bigint, slippageBps: number): Promise<QuoteResult> {
  if (l.phase === 3) {
    if (side === 'buy') {
      const [out, fees] = (await ctx.client.readContract({ address: l.launch, abi: launchAbi, functionName: 'quoteBuy', args: [amount] })) as readonly [bigint, { platform: bigint; creator: bigint; tax: bigint; total: bigint }];
      const notes: string[] = [];
      const net = amount - fees.total;
      const grad = l.graduationThresholdWei > 0n && l.realEthRaisedWei + net >= l.graduationThresholdWei;
      if (grad) notes.push('This buy reaches the graduation threshold. Only the ETH needed is used and the rest is returned in the same transaction.');
      if (fees.tax > 0n) notes.push('An early-trading fee is included in the fees.');
      return {
        side, venue: 'bonding_curve', amountIn: amount, amountOut: out, minAmountOut: (out * (BPS - BigInt(slippageBps))) / BPS, slippageBps,
        fees: { platformWei: fees.platform.toString(), creatorWei: fees.creator.toString(), taxWei: fees.tax.toString(), totalWei: fees.total.toString() },
        graduatesInThisTrade: grad, notes,
      };
    }
    if (amount > l.tokensSoldWei) throw new ApiError(409, 'amount_exceeds_curve', 'That is more tokens than the curve can take back right now.', { maxTokens: l.tokensSoldWei.toString() });
    const [out, fees] = (await ctx.client.readContract({ address: l.launch, abi: launchAbi, functionName: 'quoteSell', args: [amount] })) as readonly [bigint, { platform: bigint; creator: bigint; tax: bigint; total: bigint }];
    return {
      side, venue: 'bonding_curve', amountIn: amount, amountOut: out, minAmountOut: (out * (BPS - BigInt(slippageBps))) / BPS, slippageBps,
      fees: { platformWei: fees.platform.toString(), creatorWei: fees.creator.toString(), taxWei: fees.tax.toString(), totalWei: fees.total.toString() },
      notes: [],
    };
  }
  if (l.phase === 4) {
    const out = await v4Quote(ctx, l, side === 'buy', amount);
    return {
      side, venue: 'uniswap_v4', amountIn: amount, amountOut: out, minAmountOut: (out * (BPS - BigInt(slippageBps))) / BPS, slippageBps,
      fees: { note: `The pool hook takes a 0.2% platform fee and a ${(l.creatorFeeBps / 100).toFixed(2)}% creator fee in ETH. The quote already includes them.` },
      notes: ['Graduated token: this trades in a Uniswap V4 pool, not on the bonding curve.'],
    };
  }
  if (l.phase === 1) {
    return {
      side, venue: 'commit_window', amountIn: amount, amountOut: 0n, minAmountOut: 0n, slippageBps, fees: {},
      notes: ['The commitment window is open. A buy is a commit: ETH goes in now and tokens are allocated when the window closes. A commit can be withdrawn in full while the window is open.'],
    };
  }
  throw new ApiError(409, 'not_tradable', `${l.symbol} is in phase "${l.phaseName}" and cannot be traded right now.`, { phase: l.phaseName });
}

function viewQuote(l: LaunchInfo, q: QuoteResult) {
  const inIsEth = q.side === 'buy';
  return {
    ok: true,
    token: { name: l.name, symbol: l.symbol, token: l.token, launch: l.launch, phase: l.phaseName },
    side: q.side,
    venue: q.venue,
    amountIn: q.amountIn.toString(),
    amountInDisplay: inIsEth ? `${ethDisplay(q.amountIn)} ETH` : `${unitsDisplay(q.amountIn)} ${l.symbol}`,
    expectedOut: q.amountOut.toString(),
    expectedOutDisplay: inIsEth ? `${unitsDisplay(q.amountOut)} ${l.symbol}` : `${ethDisplay(q.amountOut)} ETH`,
    minAmountOut: q.minAmountOut.toString(),
    minAmountOutDisplay: inIsEth ? `${unitsDisplay(q.minAmountOut)} ${l.symbol}` : `${ethDisplay(q.minAmountOut)} ETH`,
    slippageBps: q.slippageBps,
    fees: q.fees,
    graduatesInThisTrade: q.graduatesInThisTrade ?? false,
    notes: q.notes,
    reading: 'A quote is one reading at one moment. It is not a promise of what a later trade will receive.',
  };
}

export async function quoteTrade(ctx: Ctx, input: Record<string, unknown>) {
  const l = await resolveLaunch(ctx, String(input.token ?? input.symbol ?? ''), { fresh: true });
  const side = parseSide(input.side);
  const amount = parseUnits10(input.amount, 'amount');
  if (amount <= 0n) throw new ApiError(400, 'invalid_params', 'amount must be above zero.', { field: 'amount' });
  const q = await quoteLaunch(ctx, l, side, amount, slippageOf(input));
  return viewQuote(l, q);
}

// ---------------------------------------------------------------- transaction encoders

const ACTIONS = '0x060c0f' as const; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL

export function encodeV4Swap(l: LaunchInfo, zeroForOne: boolean, amountIn: bigint, minOut: bigint, deadline: bigint): Hex {
  const key = poolKeyOf(l);
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
    [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: '0x' }],
  );
  const inCurrency = zeroForOne ? NATIVE : l.token;
  const outCurrency = zeroForOne ? l.token : NATIVE;
  const settle = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [inCurrency, amountIn]);
  const take = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [outCurrency, minOut]);
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [ACTIONS, [swap, settle, take]]);
  return encodeFunctionData({ abi: universalRouterAbi, functionName: 'execute', args: ['0x10', [input], deadline] });
}

const RISKS = [
  'Token prices can fall to zero. You can lose everything you put in.',
  'Slippage limits one trade. It does not limit loss.',
  WORDING.notAudited,
];

// ---------------------------------------------------------------- prepare_buy

export async function prepareBuy(ctx: Ctx, rawInput: unknown, meta: Meta) {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const l = await resolveLaunch(ctx, String(input.token ?? ''), { fresh: true });
  const amount = parseUnits10(input.amount, 'amount');
  guardAmountWei(amount, input, 'amount');
  const slip = slippageOf(input);
  const q = await quoteLaunch(ctx, l, 'buy', amount, slip);
  const warnings: string[] = [];

  const bal = await ctx.client.getBalance({ address: from });
  if (bal < amount) throw new ApiError(409, 'insufficient_balance', `The wallet holds ${ethDisplay(bal)} ETH, less than the ${ethDisplay(amount)} ETH requested.`, { balanceWei: bal.toString() });

  const signParams = { t: l.launch, amt: amount.toString(), sl: slip };
  let step: StepInput;
  let headline: string;
  const lines: string[] = [];

  if (q.venue === 'commit_window') {
    if (amount < LIMITS.minCommitWei) throw new ApiError(400, 'invalid_params', `A commit must be at least ${ethDisplay(LIMITS.minCommitWei)} ETH.`);
    step = { kind: 'commit', description: 'Commit ETH to the commitment window. It can be withdrawn in full while the window is open.', to: l.launch, data: encodeFunctionData({ abi: launchAbi, functionName: 'commit' }), value: amount, simulate: true };
    headline = `Commit ${ethDisplay(amount)} ETH to ${l.symbol}`;
    lines.push('Venue: commitment window (tokens are allocated when the window closes)', 'You can withdraw the full commit while the window is open.');
  } else if (q.venue === 'bonding_curve') {
    step = { kind: 'buy', description: 'Buy on the bonding curve. ETH is sent with the transaction.', to: l.launch, data: encodeFunctionData({ abi: launchAbi, functionName: 'buy', args: [q.minAmountOut] }), value: amount, simulate: true };
    headline = `Buy ${l.symbol} with ${ethDisplay(amount)} ETH`;
    lines.push(
      'Venue: bonding curve',
      `Expected: about ${unitsDisplay(q.amountOut)} ${l.symbol}`,
      `Minimum you receive: ${unitsDisplay(q.minAmountOut)} ${l.symbol} (slippage limit ${(slip / 100).toFixed(2)}%)`,
      `Fees included: ${ethDisplay(BigInt(q.fees.totalWei ?? '0'))} ETH`,
    );
    warnings.push(...q.notes);
  } else {
    const deadline = BigInt(ctx.nowSec() + LIMITS.deadlineSeconds);
    step = { kind: 'swap', description: 'Swap ETH for the token in the Uniswap V4 pool through the Universal Router.', to: ADDR.universalRouter, data: encodeV4Swap(l, true, amount, q.minAmountOut, deadline), value: amount, simulate: true };
    headline = `Buy ${l.symbol} with ${ethDisplay(amount)} ETH (Uniswap V4)`;
    lines.push(
      'Venue: Uniswap V4 pool (graduated token)',
      `Expected: about ${unitsDisplay(q.amountOut)} ${l.symbol}`,
      `Minimum you receive: ${unitsDisplay(q.minAmountOut)} ${l.symbol} (slippage limit ${(slip / 100).toFixed(2)}%)`,
      'Fees: 0.2% platform and the creator fee, already in the quote',
    );
  }

  return finishPrepared(ctx, {
    action: 'buy', signParams, from, steps: [step], meta, allowTargets: [l.launch],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: { headline, lines, youPay: `${ethDisplay(amount)} ETH`, youReceiveAtLeast: q.venue === 'commit_window' ? undefined : `${unitsDisplay(q.minAmountOut)} ${l.symbol}`, fees: q.fees, slippageBps: slip, risks: RISKS },
    warnings,
    extra: { token: { name: l.name, symbol: l.symbol, token: l.token, launch: l.launch, phase: l.phaseName }, quote: viewQuote(l, q) },
  });
}

// ---------------------------------------------------------------- prepare_sell

export async function prepareSell(ctx: Ctx, rawInput: unknown, meta: Meta) {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const l = await resolveLaunch(ctx, String(input.token ?? ''), { fresh: true });
  if (l.phase !== 3 && l.phase !== 4) throw new ApiError(409, 'not_tradable', `${l.symbol} is in phase "${l.phaseName}". Selling is only available on the curve or after graduation.`, { phase: l.phaseName });
  const balance = (await ctx.client.readContract({ address: l.token, abi: erc20Abi, functionName: 'balanceOf', args: [from] })) as bigint;

  let amount: bigint;
  const pct = input.percentOfBalance;
  if (pct !== undefined && pct !== null && pct !== '') {
    const p = optUint(pct, 'percentOfBalance', 100, 1, 100);
    amount = (balance * BigInt(p)) / 100n;
  } else {
    amount = parseUnits10(input.amount, 'amount');
  }
  if (amount <= 0n) throw new ApiError(409, 'insufficient_balance', `The wallet holds no ${l.symbol} to sell.`, { balance: balance.toString() });
  if (balance < amount) throw new ApiError(409, 'insufficient_balance', `The wallet holds ${unitsDisplay(balance)} ${l.symbol}, less than the amount to sell.`, { balance: balance.toString() });

  const slip = slippageOf(input);
  const q = await quoteLaunch(ctx, l, 'sell', amount, slip);
  const steps: StepInput[] = [];
  const spender: Addr = l.phase === 3 ? l.launch : ADDR.permit2;
  const allowance = (await ctx.client.readContract({ address: l.token, abi: erc20Abi, functionName: 'allowance', args: [from, spender] })) as bigint;
  if (allowance < amount) {
    steps.push({
      kind: 'approve',
      description: l.phase === 3 ? 'Approve the launch contract to take exactly this many tokens.' : 'Approve Permit2 to take exactly this many tokens.',
      to: l.token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
      value: 0n,
      simulate: true,
    });
  }

  let headline: string;
  const lines: string[] = [];
  if (q.venue === 'bonding_curve') {
    steps.push({ kind: 'sell', description: 'Sell on the bonding curve. Send after the approval, if any, is confirmed.', to: l.launch, data: encodeFunctionData({ abi: launchAbi, functionName: 'sell', args: [amount, q.minAmountOut] }), value: 0n, simulate: steps.length === 0 });
    headline = `Sell ${unitsDisplay(amount)} ${l.symbol}`;
    lines.push('Venue: bonding curve');
  } else {
    const nowS = ctx.nowSec();
    const p2 = (await ctx.client.readContract({ address: ADDR.permit2, abi: permit2Abi, functionName: 'allowance', args: [from, l.token, ADDR.universalRouter] })) as readonly [bigint, number, number];
    const p2ok = p2[0] >= amount && (p2[1] === 0 ? false : p2[1] > nowS + 600);
    if (!p2ok) {
      steps.push({
        kind: 'permit2_approve',
        description: 'Let the Universal Router pull exactly this many tokens through Permit2, for the next 30 minutes.',
        to: ADDR.permit2,
        data: encodeFunctionData({ abi: permit2Abi, functionName: 'approve', args: [l.token, ADDR.universalRouter, amount > maxUint160 ? maxUint160 : amount, nowS + 1800] }),
        value: 0n,
        simulate: steps.length === 0,
      });
    }
    const deadline = BigInt(nowS + LIMITS.deadlineSeconds);
    steps.push({ kind: 'swap', description: 'Swap the token for ETH in the Uniswap V4 pool through the Universal Router. Send after the approvals are confirmed.', to: ADDR.universalRouter, data: encodeV4Swap(l, false, amount, q.minAmountOut, deadline), value: 0n, simulate: steps.length === 0 });
    headline = `Sell ${unitsDisplay(amount)} ${l.symbol} (Uniswap V4)`;
    lines.push('Venue: Uniswap V4 pool (graduated token)');
  }
  lines.push(
    `Expected: about ${ethDisplay(q.amountOut)} ETH`,
    `Minimum you receive: ${ethDisplay(q.minAmountOut)} ETH (slippage limit ${(slip / 100).toFixed(2)}%)`,
    steps.length > 1 ? `This takes ${steps.length} wallet confirmations: ${steps.map((s) => s.kind).join(', then ')}.` : 'This takes 1 wallet confirmation.',
  );

  return finishPrepared(ctx, {
    action: 'sell',
    signParams: input.percentOfBalance ? { t: l.launch, pct: String(input.percentOfBalance), sl: slip } : { t: l.launch, amt: amount.toString(), sl: slip },
    from, steps, meta, allowTargets: [l.launch, l.token],
    returnUrl: validReturnUrl(input.returnUrl),
    summary: { headline, lines, youPay: `${unitsDisplay(amount)} ${l.symbol}`, youReceiveAtLeast: `${ethDisplay(q.minAmountOut)} ETH`, fees: q.fees, slippageBps: slip, risks: RISKS },
    extra: { token: { name: l.name, symbol: l.symbol, token: l.token, launch: l.launch, phase: l.phaseName }, quote: viewQuote(l, q) },
  });
}

export { E18 };
