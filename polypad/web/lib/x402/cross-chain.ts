// Polypad-native cross-chain x402 — pay any x402 endpoint from either chain.
// Base USDC <-> Robinhood Chain USDG via Relay's public bridge API, settled
// by Polypad's own x402 facilitators on both chains (Hood USDG EIP-3009,
// Base USDC via the CDP facilitator). No escrow, no third-party settlement
// layer: plain x402 `exact` (EIP-3009) after bridging ONLY the shortfall.
//
// How it works: fetch the 402, take the stablecoin requirement for the
// settlement chain, read the payer's balances on both chains, and bridge
// just enough to cover what the payer lacks on the settlement chain. If
// the payer already holds enough there, no bridge happens at all.
//
// Relay: POST https://api.relay.link/quote/v2 returns executable steps
// (approve + deposit) and GET /intents/status/v3 tracks the fill. Relay's
// docs say quote/v2 requires an API key since Oct 2, 2026 — in practice
// (verified Nov 22, 2026) quotes still return without one for these
// routes, but RELAY_API_KEY is honoured when set so enforcement later
// does not break the flow. Relay's relayer fee is roughly $0.02 flat at
// small sizes, so bridging a $0.01 payment costs ~$0.02 in fees —
// cross-chain pay-per-call only makes sense above ~$0.10, and the plan
// says so honestly instead of hiding the fee.

import {
  createPublicClient,
  http,
  isAddress,
  getAddress,
  parseAbi,
  type Hex,
  type PublicClient,
} from 'viem';
import { base } from 'viem/chains';
import { robinhoodChain } from '@/lib/chain';
import {
  X402_BASE_CHAIN_ID,
  X402_BASE_NETWORK,
  X402_CHAIN_ID,
  X402_MAX_TIMEOUT_SECONDS,
  X402_NETWORK,
  USDC_BASE_ADDRESS,
  USDC_BASE_EIP712,
  USDG_ADDRESS,
  USDG_EIP712,
} from './constants';
import { ApiError } from '@/lib/agents-api/v2/core';

const RELAY_API = 'https://api.relay.link';
const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org';
const HOOD_RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';

export const CROSS_CHAIN_IDS = [X402_CHAIN_ID, X402_BASE_CHAIN_ID] as const;
export type CrossChainId = (typeof CROSS_CHAIN_IDS)[number];

export interface StableLeg {
  chainId: CrossChainId;
  network: string;
  chainName: string;
  asset: string;
  symbol: string;
  decimals: 6;
  eip712: { name: string; version: string };
  rpcUrl: string;
  explorerTx: (hash: string) => string;
}

export const STABLE_LEGS: Record<CrossChainId, StableLeg> = {
  4663: {
    chainId: 4663,
    network: X402_NETWORK,
    chainName: 'Robinhood Chain',
    asset: USDG_ADDRESS,
    symbol: 'USDG',
    decimals: 6,
    eip712: USDG_EIP712,
    rpcUrl: HOOD_RPC,
    explorerTx: (h) => `https://robinhoodchain.blockscout.com/tx/${h}`,
  },
  8453: {
    chainId: 8453,
    network: X402_BASE_NETWORK,
    chainName: 'Base',
    asset: USDC_BASE_ADDRESS,
    symbol: 'USDC',
    decimals: 6,
    eip712: USDC_BASE_EIP712,
    rpcUrl: BASE_RPC,
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
  },
};

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

export function publicClientFor(chainId: CrossChainId): PublicClient {
  return createPublicClient({
    chain: chainId === 4663 ? robinhoodChain : base,
    transport: http(STABLE_LEGS[chainId].rpcUrl, { timeout: 8_000 }),
  }) as PublicClient;
}

/** Parse and validate the two planner inputs. Throws ApiError on bad input. */
export function parseCrossChainInput(input: Record<string, unknown>): { url: string; from: string } {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const from = typeof input.from === 'string' ? input.from.trim() : '';
  if (!url || !/^https?:\/\//i.test(url) || url.length > 2048) {
    throw new ApiError(400, 'invalid_params', 'url must be an https:// URL that returns a 402.', { field: 'url' });
  }
  if (!isAddress(from)) {
    throw new ApiError(400, 'invalid_params', 'from must be the payer wallet address (0x...). Never a private key.', { field: 'from' });
  }
  return { url, from: getAddress(from) };
}

// --- Relay -----------------------------------------------------------------

export interface RelayStepTx {
  to: string;
  data: Hex;
  value: string;
  chainId: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface RelayQuote {
  requestId: string;
  steps: { id: string; kind: string; description?: string; items: { data: RelayStepTx }[] }[];
  details: {
    currencyIn: { amount: string; amountUsd?: string };
    currencyOut: { amount: string; amountUsd?: string; minimumAmount: string };
    timeEstimate?: number;
  };
  fees: Record<string, { amount: string; amountUsd?: string }>;
}

async function relayFetch(path: string, init?: RequestInit): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) };
  const key = process.env.RELAY_API_KEY;
  if (key) headers['x-api-key'] = key;
  const res = await fetch(`${RELAY_API}${path}`, { ...init, headers, signal: AbortSignal.timeout(8_000) });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = (body as { message?: string })?.message ?? `Relay ${path} failed (${res.status})`;
    const err = new Error(msg) as Error & { relayStatus?: number; relayBody?: unknown };
    err.relayStatus = res.status;
    err.relayBody = body;
    throw err;
  }
  return body;
}

/** A Relay quote for bridging `amount` of the origin stable to the destination stable. */
export async function relayQuote(
  originChainId: CrossChainId,
  destinationChainId: CrossChainId,
  user: string,
  amount: bigint,
): Promise<RelayQuote> {
  const origin = STABLE_LEGS[originChainId];
  const dest = STABLE_LEGS[destinationChainId];
  return (await relayFetch('/quote/v2', {
    method: 'POST',
    body: JSON.stringify({
      user,
      originChainId,
      destinationChainId,
      originCurrency: origin.asset,
      destinationCurrency: dest.asset,
      amount: amount.toString(),
      tradeType: 'EXACT_INPUT',
    }),
  })) as RelayQuote;
}

/** Relay intent status: waiting | depositing | pending | success | refund | failure. */
export async function relayStatus(requestId: string): Promise<{ status: string; raw: unknown }> {
  const body = (await relayFetch(`/intents/status/v3?requestId=${encodeURIComponent(requestId)}`)) as { status?: string };
  return { status: typeof body?.status === 'string' ? body.status : 'unknown', raw: body };
}

// --- 402 fetch ---------------------------------------------------------------

export interface FetchedRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource?: { url: string; description?: string; mimeType?: string };
  description?: string;
  extra?: Record<string, string>;
}

export interface Fetched402 {
  accepts: FetchedRequirement[];
  resource?: { url: string; description?: string; mimeType?: string };
  extensions?: Record<string, unknown>;
}

/** GET a URL and read its 402 answer (body, or the PAYMENT-REQUIRED header). */
export async function fetch402(url: string): Promise<Fetched402> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
  } catch (e) {
    throw new ApiError(502, 'resource_unreachable', `Could not fetch ${url}: ${(e as Error)?.message ?? 'fetch failed'}.`);
  }
  if (res.status !== 402) {
    throw new ApiError(400, 'not_a_402', `The URL did not return a 402 payment challenge (got ${res.status}). Cross-chain pay needs an x402 endpoint.`);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* fall through to the header */ }
  if (!body || typeof body !== 'object') {
    const header = res.headers.get('PAYMENT-REQUIRED');
    if (header) {
      try { body = JSON.parse(Buffer.from(header, 'base64').toString('utf8')); } catch { body = null; }
    }
  }
  const accepts = (body as { accepts?: unknown })?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new ApiError(400, 'not_a_402', 'The 402 answer has no payment requirements (accepts[]).');
  }
  return {
    accepts: accepts as FetchedRequirement[],
    resource: (body as { resource?: Fetched402['resource'] })?.resource,
    extensions: (body as { extensions?: Record<string, unknown> })?.extensions,
  };
}

/** The stablecoin (EIP-3009) requirement, if the 402 offers one. */
export function pickStableRequirement(fetched: Fetched402): FetchedRequirement | null {
  for (const req of fetched.accepts) {
    if (req.scheme !== 'exact') continue;
    const asset = typeof req.asset === 'string' ? req.asset.toLowerCase() : '';
    if (asset === USDG_ADDRESS.toLowerCase() || asset === USDC_BASE_ADDRESS.toLowerCase()) return req;
  }
  return null;
}

// --- Balances ----------------------------------------------------------------

export interface ChainBalances {
  chainId: CrossChainId;
  eth: bigint;
  stable: bigint;
}

export async function readBalances(address: string): Promise<Record<CrossChainId, ChainBalances>> {
  const out = {} as Record<CrossChainId, ChainBalances>;
  await Promise.all(
    CROSS_CHAIN_IDS.map(async (chainId) => {
      const leg = STABLE_LEGS[chainId];
      const client = publicClientFor(chainId);
      const [eth, stable] = await Promise.all([
        client.getBalance({ address: address as `0x${string}` }),
        client.readContract({
          address: leg.asset as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        }) as Promise<bigint>,
      ]);
      out[chainId] = { chainId, eth, stable };
    }),
  );
  return out;
}

async function stableAllowance(owner: string, spender: string, chainId: CrossChainId): Promise<bigint> {
  const leg = STABLE_LEGS[chainId];
  try {
    return (await publicClientFor(chainId).readContract({
      address: leg.asset as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner as `0x${string}`, spender as `0x${string}`],
    })) as bigint;
  } catch {
    return 0n;
  }
}

// --- EIP-3009 typed data -----------------------------------------------------

export function newNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

export interface Eip3009TypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: 'TransferWithAuthorization';
  message: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: Hex };
}

export function buildEip3009TypedData(
  leg: StableLeg,
  from: string,
  to: string,
  value: bigint,
  validBefore: number,
  nonce: Hex,
): Eip3009TypedData {
  return {
    domain: { name: leg.eip712.name, version: leg.eip712.version, chainId: leg.chainId, verifyingContract: leg.asset },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: { from, to, value: value.toString(), validAfter: '0', validBefore: String(validBefore), nonce },
  };
}

// --- The plan ----------------------------------------------------------------

export interface CrossChainPlan {
  ok: true;
  feasible: boolean;
  url: string;
  from: string;
  requirement: { scheme: string; network: string; amount: string; amountUsd: string; asset: string; symbol: string; payTo: string; maxTimeoutSeconds: number };
  settlementChain: { chainId: CrossChainId; network: string; name: string; symbol: string };
  payerChain: { chainId: CrossChainId; network: string; name: string; symbol: string };
  balances: Record<string, { eth: string; ethUsdApprox?: never; stable: string; stableUsd: string }>;
  bridgeNeeded: boolean;
  bridge: null | {
    input: { amount: string; symbol: string; usd: string };
    expectedOutput: { amount: string; symbol: string; usd: string };
    minimumOutput: { amount: string; symbol: string; usd: string };
    feesUsd: string;
    requestId: string;
    statusUrl: string;
    estimatedSeconds: number | null;
    transactions: (RelayStepTx & { step: string; description: string })[];
  };
  payment: {
    typedData: Eip3009TypedData;
    submitTo: string;
    header: 'X-PAYMENT';
    validBefore: number;
    nonce: Hex;
  };
  steps: string[];
  warnings: string[];
  infeasibleReason?: string;
  shortfall?: { amount: string; symbol: string; usd: string; chainId: CrossChainId };
}

const fmt6 = (v: bigint) => `$${(Number(v) / 1e6).toFixed(6).replace(/\.?0+$/, '')}`;

/** The executable package for a feasible plan: unsigned bridge txs, the
 * EIP-3009 typed data, and the X-PAYMENT submission template. Shared by
 * the /api/x402/cross-chain/pay route and the MCP pay tool. */
export function toExecutionPackage(plan: CrossChainPlan): Record<string, unknown> {
  const { typedData } = plan.payment;
  const m = typedData.message;
  return {
    bridgeTransactions: plan.bridge?.transactions ?? [],
    paymentTypedData: typedData,
    submit: {
      url: plan.payment.submitTo,
      method: 'POST',
      header: 'X-PAYMENT',
      payloadTemplate: {
        x402Version: 2,
        resource: plan.url,
        accepted: {
          scheme: plan.requirement.scheme,
          network: plan.requirement.network,
          amount: plan.requirement.amount,
          asset: plan.requirement.asset,
          payTo: plan.requirement.payTo,
          maxTimeoutSeconds: plan.requirement.maxTimeoutSeconds,
        },
        payload: {
          signature: '<the EIP-712 signature of paymentTypedData>',
          authorization: {
            from: m.from,
            to: m.to,
            value: m.value,
            validAfter: m.validAfter,
            validBefore: m.validBefore,
            nonce: m.nonce,
          },
        },
      },
      note: 'Base64-encode the payload JSON and send it as the X-PAYMENT header on a GET to the product URL. The resource field above is the product URL; if the 402 answer carried its own resource object or Bazaar extensions, use those instead.',
    },
  };
}


/**
 * The full dry-run plan: fetch the 402, size the bridge (shortfall only),
 * quote Relay, and build the EIP-3009 typed data. Read-only — no key,
 * no signature, no transaction is sent.
 */
export async function planCrossChainPayment(input: Record<string, unknown>): Promise<CrossChainPlan> {
  const { url, from } = parseCrossChainInput(input);
  const fetched = await fetch402(url);
  const req = pickStableRequirement(fetched);
  if (!req) {
    throw new ApiError(400, 'no_stable_requirement', 'This endpoint only accepts POLYDASH (or another non-stable asset). Cross-chain pay works for the USD stablecoins — USDG on Robinhood Chain, USDC on Base.');
  }
  const settlementChainId = (req.network === X402_BASE_NETWORK ? X402_BASE_CHAIN_ID : X402_CHAIN_ID) as CrossChainId;
  const payerChainId = (settlementChainId === 4663 ? 8453 : 4663) as CrossChainId;
  const settleLeg = STABLE_LEGS[settlementChainId];
  const payerLeg = STABLE_LEGS[payerChainId];
  const amount = BigInt(req.amount);
  if (amount <= 0n) throw new ApiError(400, 'invalid_amount', 'The 402 requirement has a zero amount.');

  const balances = await readBalances(from);
  const haveOnSettlement = balances[settlementChainId].stable;
  const shortfall = amount > haveOnSettlement ? amount - haveOnSettlement : 0n;
  const bridgeNeeded = shortfall > 0n;

  const now = Math.floor(Date.now() / 1_000);
  const validBefore = now + X402_MAX_TIMEOUT_SECONDS;
  const nonce = newNonce();
  const typedData = buildEip3009TypedData(settleLeg, from, req.payTo, amount, validBefore, nonce);

  const basePlan: Omit<CrossChainPlan, 'bridge' | 'steps' | 'warnings'> = {
    ok: true,
    feasible: true,
    url,
    from,
    requirement: {
      scheme: 'exact',
      network: req.network,
      amount: req.amount,
      amountUsd: fmt6(amount),
      asset: req.asset,
      symbol: settleLeg.symbol,
      payTo: req.payTo,
      maxTimeoutSeconds: req.maxTimeoutSeconds ?? X402_MAX_TIMEOUT_SECONDS,
    },
    settlementChain: { chainId: settlementChainId, network: settleLeg.network, name: settleLeg.chainName, symbol: settleLeg.symbol },
    payerChain: { chainId: payerChainId, network: payerLeg.network, name: payerLeg.chainName, symbol: payerLeg.symbol },
    balances: {
      [String(settlementChainId)]: { eth: balances[settlementChainId].eth.toString(), stable: balances[settlementChainId].stable.toString(), stableUsd: fmt6(balances[settlementChainId].stable) },
      [String(payerChainId)]: { eth: balances[payerChainId].eth.toString(), stable: balances[payerChainId].stable.toString(), stableUsd: fmt6(balances[payerChainId].stable) },
    },
    bridgeNeeded,
    payment: { typedData, submitTo: url, header: 'X-PAYMENT', validBefore, nonce },
  };

  const warnings: string[] = [];
  if (getAddress(from) === getAddress(req.payTo)) {
    warnings.push('This wallet IS the payment recipient. The Base facilitator rejects self-payments (self_send_not_allowed), so a Base payment from this wallet will fail verification — use a different payer wallet. On Robinhood Chain a self-payment would move nothing.');
  }
  if (amount > 50_000n) {
    warnings.push('Polypad verifies x402 payments against the payer\'s Agent Credit Score band (unregistered agents: $0.05 per payment). A payment above your band fails verification — register the agent first if this is over the cap.');
  }

  if (!bridgeNeeded) {
    return {
      ...basePlan,
      bridge: null,
      steps: [
        `You already hold ${fmt6(haveOnSettlement)} ${settleLeg.symbol} on ${settleLeg.chainName} — no bridge needed.`,
        `Sign the EIP-3009 authorization for ${fmt6(amount)} ${settleLeg.symbol} to ${req.payTo} (typed data below).`,
        `POST it to ${url} as an X-PAYMENT header and the endpoint settles it on ${settleLeg.chainName}.`,
      ],
      warnings,
    };
  }

  // Size the bridge: shortfall plus a buffer for Relay's ~$0.02 relayer
  // fee and destination slippage, then re-quote if the guaranteed
  // minimum output still falls short (max 3 tries).
  let bridgeInput = shortfall + (shortfall / 10n > 30_000n ? shortfall / 10n : 30_000n);
  let quote: RelayQuote | null = null;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      quote = await relayQuote(payerChainId, settlementChainId, from, bridgeInput);
    } catch (e) {
      lastError = e as Error;
      break;
    }
    const minOut = BigInt(quote.details.currencyOut.minimumAmount);
    if (minOut >= shortfall) break;
    bridgeInput += (shortfall - minOut) + shortfall / 10n + 1n;
    quote = null;
  }
  if (!quote) {
    const msg = lastError?.message ?? 'Relay returned no usable quote.';
    return {
      ...basePlan,
      feasible: false,
      bridge: null,
      steps: [],
      warnings,
      infeasibleReason: `Could not get a Relay bridge quote for the shortfall (${fmt6(shortfall)} ${settleLeg.symbol}): ${msg}`,
      shortfall: { amount: shortfall.toString(), symbol: settleLeg.symbol, usd: fmt6(shortfall), chainId: settlementChainId },
    };
  }

  const expectedOut = BigInt(quote.details.currencyOut.amount);
  const minimumOut = BigInt(quote.details.currencyOut.minimumAmount);
  const feesUsd = Object.values(quote.fees).reduce((sum, f) => sum + Number(f.amountUsd ?? 0), 0);

  // The payer must hold the bridge input on the origin chain, plus gas
  // for the Relay steps (approve + deposit) on that chain. Relay quotes
  // very generous fee caps (6.7 gwei on Base vs ~0.006 gwei live, Nov 22)
  // — the feasibility check uses effective caps of 0.2 gwei max fee /
  // 0.01 gwei priority fee, 10-30x the live price on both chains, so a
  // small wallet is not wrongly called infeasible. The script that
  // executes the bridge sends with the same effective caps.
  const MAX_FEE_CAP = 200_000_000n;
  const haveOnOrigin = balances[payerChainId].stable;
  const gasNeeded = quote.steps
    .flatMap((s) => s.items)
    .reduce(
      (sum, item) => {
        const fee = BigInt(item.data.maxFeePerGas ?? '0');
        return sum + BigInt(item.data.gas ?? '0') * (fee > MAX_FEE_CAP ? MAX_FEE_CAP : fee);
      },
      0n,
    );
  const gasWithMargin = (gasNeeded * 5n) / 4n;
  if (haveOnOrigin < bridgeInput) {
    return {
      ...basePlan,
      feasible: false,
      bridge: null,
      steps: [],
      warnings,
      infeasibleReason: `Short ${fmt6(bridgeInput - haveOnOrigin)} ${payerLeg.symbol} on ${payerLeg.chainName}: the bridge needs ${fmt6(bridgeInput)} ${payerLeg.symbol} in (shortfall ${fmt6(shortfall)} ${settleLeg.symbol} plus Relay fees) and the wallet holds ${fmt6(haveOnOrigin)}.`,
      shortfall: { amount: (bridgeInput - haveOnOrigin).toString(), symbol: payerLeg.symbol, usd: fmt6(bridgeInput - haveOnOrigin), chainId: payerChainId },
    };
  }
  if (balances[payerChainId].eth < gasWithMargin) {
    return {
      ...basePlan,
      feasible: false,
      bridge: null,
      steps: [],
      warnings,
      infeasibleReason: `Short on ${payerLeg.chainName} gas: the bridge steps need about ${gasWithMargin.toString()} wei of ETH and the wallet holds ${balances[payerChainId].eth.toString()} wei.`,
    };
  }

  // Build the unsigned bridge transactions, skipping the approve step
  // when the Relay depository already has enough allowance.
  const transactions: (RelayStepTx & { step: string; description: string })[] = [];
  for (const step of quote.steps) {
    for (const item of step.items) {
      if (step.id === 'approve') {
        const spender = item.data.to;
        const allowance = await stableAllowance(from, spender, payerChainId);
        if (allowance >= bridgeInput) continue;
      }
      transactions.push({
        to: item.data.to,
        data: item.data.data,
        value: item.data.value ?? '0',
        chainId: item.data.chainId,
        gas: item.data.gas,
        maxFeePerGas: item.data.maxFeePerGas,
        maxPriorityFeePerGas: item.data.maxPriorityFeePerGas,
        step: step.id,
        description: step.description ?? step.id,
      });
    }
  }

  if (feesUsd > Number(amount) / 1e6) {
    warnings.push(`Relay's fee for this bridge is about $${feesUsd.toFixed(4)} — more than the ${fmt6(amount)} payment itself. Cross-chain pay-per-call only makes sense above ~$0.10; at that size the fee is a few percent.`);
  }

  return {
    ...basePlan,
    bridge: {
      input: { amount: bridgeInput.toString(), symbol: payerLeg.symbol, usd: fmt6(bridgeInput) },
      expectedOutput: { amount: expectedOut.toString(), symbol: settleLeg.symbol, usd: fmt6(expectedOut) },
      minimumOutput: { amount: minimumOut.toString(), symbol: settleLeg.symbol, usd: fmt6(minimumOut) },
      feesUsd: `$${feesUsd.toFixed(4)}`,
      requestId: quote.requestId,
      statusUrl: `${RELAY_API}/intents/status/v3?requestId=${quote.requestId}`,
      estimatedSeconds: quote.details.timeEstimate ?? null,
      transactions,
    },
    steps: [
      `Pay ${fmt6(amount)} ${settleLeg.symbol} on ${settleLeg.chainName}, but the wallet holds ${fmt6(haveOnSettlement)} there — bridge ${fmt6(bridgeInput)} ${payerLeg.symbol} from ${payerLeg.chainName} (shortfall ${fmt6(shortfall)} plus Relay fees).`,
      `Send the ${transactions.length} bridge transaction(s) below on ${payerLeg.chainName}, in order, then poll the status URL until it reads success (usually a few seconds).`,
      `Sign the EIP-3009 authorization for ${fmt6(amount)} ${settleLeg.symbol} to ${req.payTo} (typed data below) — it expires ${new Date(validBefore * 1_000).toISOString()}, so sign it after the bridge lands.`,
      `POST it to ${url} as an X-PAYMENT header and the endpoint settles it on ${settleLeg.chainName}.`,
    ],
    warnings,
  };
}
