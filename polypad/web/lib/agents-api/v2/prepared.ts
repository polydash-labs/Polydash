/**
 * Builds the standard "prepared action" response: unsigned transactions, a simulation result, a human
 * summary, and a one-tap signing link. Nothing here signs. A reverting simulation returns an error and
 * no signing link, so a user is never handed a transaction that is known to fail.
 */
import { concatHex, decodeErrorResult, keccak256, stringToHex, toHex, parseAbi, type Hex } from 'viem';
import { ADDR, ATTRIBUTION_CODES, CHAIN_ID, LIMITS, siteOrigin, WORDING } from './config';
import { ApiError, scrub, type Addr, type Ctx, type Meta } from './core';

// ---------------------------------------------------------------- attribution (ERC-8021 schema 0)

const ERC8021_MARKER = '0x80218021802180218021802180218021' as const;

/** `codes` is a comma-separated ASCII list, then its length (1 byte), schema id 0x00, then the 16-byte marker. */
export function attributionSuffix(ref: string): Hex {
  const codes = `${ATTRIBUTION_CODES[0]},${ref}`;
  const body = stringToHex(codes);
  const len = (codes.length & 0xff).toString(16).padStart(2, '0');
  return concatHex([body, `0x${len}`, '0x00', ERC8021_MARKER]);
}

export function withAttribution(data: Hex, ref: string): Hex {
  return concatHex([data, attributionSuffix(ref)]);
}

/** Reads the suffix back from calldata. Returns null when the calldata does not end with the marker. */
export function readAttribution(data: Hex): { codes: string[] } | null {
  const hex = data.toLowerCase();
  const marker = ERC8021_MARKER.slice(2);
  if (!hex.endsWith(marker)) return null;
  const end = hex.length - marker.length;
  const schema = hex.slice(end - 2, end);
  const len = parseInt(hex.slice(end - 4, end - 2), 16);
  if (schema !== '00' || !Number.isFinite(len) || len <= 0) return null;
  const start = end - 4 - len * 2;
  if (start < 2) return null;
  const text = Buffer.from(hex.slice(start, end - 4), 'hex').toString('utf8');
  if (!/^[\x20-\x7e]+$/.test(text)) return null;
  return { codes: text.split(',') };
}

// ---------------------------------------------------------------- signing link

export type SignAction = 'buy' | 'sell' | 'swap' | 'nft-buy' | 'nft-mint' | 'nft-create' | 'fund-create' | 'fund-mint' | 'fund-redeem' | 'token-launch';

export type SignParams = Record<string, string | number | bigint | boolean | undefined>;

/**
 * A return link is only ever an https:// URL the agent supplies (its own callback or confirmation
 * page, up to 2048 characters). The /sign page shows it as a button the user taps after the
 * transaction confirms — it never redirects on its own. Anything else is dropped, never echoed.
 */
export function validReturnUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0 || s.length > 2048) return null;
  if (/\s/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !u.hostname) return null;
  return s;
}

/**
 * The link carries the intent (action and parameters), never calldata. The /sign page rebuilds the
 * transaction from those parameters through this same API with the connected wallet as `from`, shows
 * the summary, and asks the wallet to sign. The checksum `h` lets a person compare what the chat showed
 * with what the page built. The optional `r` param is the agent's return link: after the transaction
 * confirms, the page shows a button back to it, with `?tx=<hash>&status=confirmed` added.
 */
export function signingUrl(action: SignAction, params: SignParams, meta: Pick<Meta, 'ref' | 'client'>, checksum: string, returnUrl?: string | null): string {
  const url = new URL('/sign', siteOrigin());
  url.searchParams.set('v', '1');
  url.searchParams.set('a', action);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set('ref', meta.ref);
  if (meta.client) url.searchParams.set('c', meta.client);
  const ret = validReturnUrl(returnUrl);
  if (ret) url.searchParams.set('r', ret);
  url.searchParams.set('h', checksum);
  return url.toString();
}

/**
 * A short fingerprint of what the transaction does: target contract, function selector, ETH value, chain id.
 * It deliberately leaves out the minimum-out amount and the deadline, which change with the market, so the chat
 * and the signing page show the same code unless the action itself differs.
 */
export function checksumOf(tx: { to: Addr; data: Hex; value: bigint }): string {
  return keccak256(concatHex([tx.to, tx.data.slice(0, 10) as Hex, toHex(tx.value, { size: 32 }), toHex(CHAIN_ID, { size: 4 })])).slice(2, 14);
}

// ---------------------------------------------------------------- revert decoding

const errorAbi = parseAbi([
  'error Slippage()',
  'error ZeroAmount()',
  'error InvalidParams()',
  'error HookNotSet()',
  'error UnexpectedEth()',
  'error NotLaunch()',
  'error EthTransferFailed()',
  'error BadValue()',
  'error BadQuantity()',
  'error SoldOut()',
  'error SkinRequired()',
  'error RaiseEnded()',
  'error NotRaising()',
  'error NotHolder()',
  'error SkinLocked()',
  'error WindowClosed()',
  'error WindowOpen()',
  'error NothingCommitted()',
  'error ReentrancyGuardReentrantCall()',
  'error Error(string)',
  'error Panic(uint256)',
]);

const FRIENDLY: Record<string, string> = {
  Slippage: 'The price moved beyond the slippage limit.',
  ZeroAmount: 'The amount is zero.',
  InvalidParams: 'The contract rejected the parameters.',
  BadValue: 'The ETH sent does not match the required price.',
  BadQuantity: 'The quantity is not allowed.',
  SoldOut: 'Not enough supply is left.',
  SkinRequired: 'Only the fund manager can mint until the required manager shares are minted.',
  RaiseEnded: 'The raise has ended.',
  NotRaising: 'This fund is not in the right state for that action.',
  NotHolder: 'The wallet does not hold that share.',
  SkinLocked: 'That share is locked by the manager skin lock.',
  WindowClosed: 'The commitment window is closed.',
  WindowOpen: 'The commitment window is still open.',
  NothingCommitted: 'Nothing is committed from this wallet.',
};

export function revertReason(data: Hex | undefined): string {
  if (!data || data === '0x') return 'The transaction would revert.';
  try {
    const d = decodeErrorResult({ abi: errorAbi, data });
    if (d.errorName === 'Error') return scrub(String(d.args?.[0] ?? 'The transaction would revert.'));
    if (d.errorName === 'Panic') return `Panic(${String(d.args?.[0])})`;
    return FRIENDLY[d.errorName] ?? d.errorName;
  } catch {
    return `The transaction would revert (${data.slice(0, 10)}).`;
  }
}

function revertDataOf(err: unknown): Hex | undefined {
  const e = err as { walk?: (fn: (x: unknown) => boolean) => unknown };
  const found = typeof e?.walk === 'function' ? (e.walk((x) => typeof (x as { data?: unknown }).data === 'string' && String((x as { data?: string }).data).startsWith('0x')) as { data?: string } | null) : null;
  return found?.data as Hex | undefined;
}

// ---------------------------------------------------------------- transactions

export type UnsignedStep = {
  step: number;
  kind: string;
  description: string;
  chainId: number;
  from: Addr;
  to: Addr;
  data: Hex;
  value: string;
  valueHex: Hex;
  gas: string | null;
  simulated: boolean;
};

export type StepInput = { kind: string; description: string; to: Addr; data: Hex; value: bigint; simulate: boolean };

/** Targets the API is allowed to return. Anything else is refused before it leaves the server. */
export function isAllowedTarget(to: Addr, extra: readonly Addr[] = []): boolean {
  const fixed: Addr[] = [
    ADDR.weth,
    ADDR.permit2,
    ADDR.universalRouter,
    ADDR.nftMarket,
    ADDR.nftFactory,
    ADDR.nftCurveFactory,
    ...ADDR.launchFactories.map((f) => f.factory),
    ...ADDR.fundFactories.map((f) => f.factory),
  ];
  return [...fixed, ...extra].some((x) => x.toLowerCase() === to.toLowerCase());
}

export type SimOutcome = { ok: true; gas: bigint | null } | { ok: false; reason: string; rpc: boolean };

export async function simulateStep(ctx: Ctx, from: Addr, step: Pick<StepInput, 'to' | 'data' | 'value'>): Promise<SimOutcome> {
  try {
    await ctx.client.call({ account: from, to: step.to, data: step.data, value: step.value, gas: 8_000_000n });
  } catch (err) {
    const data = revertDataOf(err);
    if (data !== undefined) return { ok: false, reason: revertReason(data), rpc: false };
    const msg = (err as { shortMessage?: string })?.shortMessage ?? '';
    if (/revert/i.test(msg)) return { ok: false, reason: scrub(msg), rpc: false };
    return { ok: false, reason: 'The chain data source did not answer.', rpc: true };
  }
  let gas: bigint | null = null;
  try {
    const est = await ctx.client.estimateGas({ account: from, to: step.to, data: step.data, value: step.value });
    gas = (est * 12n) / 10n;
  } catch {
    gas = null;
  }
  return { ok: true, gas };
}

export type PreparedInput = {
  action: SignAction;
  /** ECHO of the parameters the signing page needs. */
  signParams: SignParams;
  from: Addr;
  steps: StepInput[];
  summary: PreparedSummary;
  warnings?: string[];
  /** Optional https:// link back to the agent's flow, carried into the signing link as `r`. */
  returnUrl?: string | null;
  /** Extra contract addresses (a launch, a fund) the steps may target. */
  allowTargets?: readonly Addr[];
  /** Whether the main (last) step carries the attribution suffix. Default true. */
  attribute?: boolean;
  meta: Meta;
  extra?: Record<string, unknown>;
};

export type PreparedSummary = {
  headline: string;
  lines: string[];
  youPay?: string;
  youReceiveAtLeast?: string;
  fees?: Record<string, unknown>;
  slippageBps?: number;
  risks: string[];
};

export async function finishPrepared(ctx: Ctx, input: PreparedInput): Promise<Record<string, unknown>> {
  const { from, steps, meta } = input;
  const out: UnsignedStep[] = [];
  let firstSim: SimOutcome | null = null;
  let simulatedAny = false;

  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    if (!isAllowedTarget(s.to, input.allowTargets)) {
      throw new ApiError(500, 'internal_error', 'Refused: transaction target is not a Polypad contract.');
    }
    const isMain = i === steps.length - 1;
    const data = isMain && input.attribute !== false ? withAttribution(s.data, meta.ref) : s.data;
    let gas: bigint | null = null;
    let simulated = false;
    if (s.simulate) {
      const sim = await simulateStep(ctx, from, { to: s.to, data, value: s.value });
      if (!sim.ok) {
        if (sim.rpc) throw new ApiError(503, 'rpc_unavailable', sim.reason);
        throw new ApiError(422, 'simulation_reverted', sim.reason, {
          simulation: { success: false, reason: sim.reason },
          hint: 'No signing link was created because this transaction would fail. Adjust the inputs and try again.',
        });
      }
      gas = sim.gas;
      simulated = true;
      simulatedAny = true;
      firstSim ??= sim;
    }
    out.push({
      step: i + 1,
      kind: s.kind,
      description: s.description,
      chainId: CHAIN_ID,
      from,
      to: s.to,
      data,
      value: s.value.toString(),
      valueHex: toHex(s.value),
      gas: gas !== null ? gas.toString() : null,
      simulated,
    });
  }

  const main = steps[steps.length - 1];
  const checksum = checksumOf({ to: main.to, data: out[out.length - 1].data, value: main.value });
  const returnUrl = validReturnUrl(input.returnUrl);
  const url = signingUrl(input.action, { ...input.signParams, f: from }, meta, checksum, returnUrl);
  ctx.sink.record({ at: ctx.now(), action: input.action, ref: meta.ref, client: meta.client, from, ok: true, txHash32: checksum });

  return {
    ok: true,
    api: 'v2',
    action: input.action,
    chainId: CHAIN_ID,
    custody: 'non-custodial',
    summary: { ...input.summary, notAudited: WORDING.notAudited },
    transactions: out,
    simulation: simulatedAny ? { success: true, gas: firstSim && firstSim.ok && firstSim.gas !== null ? firstSim.gas.toString() : null, note: steps.length > 1 ? 'Step 1 was simulated. Later steps depend on earlier ones and are re-checked by the signing page.' : undefined } : { success: null, note: 'Not simulated.' },
    signing: {
      url,
      checksum,
      returnUrl,
      instructions:
        'Show the summary, then share the link. The page rebuilds this action, shows the same summary, and the user signs in their own wallet. Nothing is sent until they confirm. After the transaction confirms, the page checks its status (polypad_get_tx_status) and, when a returnUrl was passed, shows a link back to it with ?tx=<hash>&status=confirmed added.',
      expiresInSeconds: LIMITS.deadlineSeconds,
    },
    attribution: input.attribute === false ? null : { ref: meta.ref, codes: [ATTRIBUTION_CODES[0], meta.ref], standard: 'ERC-8021 schema 0 calldata suffix on the main transaction' },
    warnings: input.warnings ?? [],
    ...(input.extra ?? {}),
  };
}
