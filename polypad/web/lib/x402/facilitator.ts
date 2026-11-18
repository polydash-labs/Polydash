// Polypad x402 facilitator — server-only. Verifies and settles x402 v2
// `exact` payments on Robinhood Chain (eip155:4663) for USDG (EIP-3009)
// and POLYDASH (Permit2 + canonical x402ExactPermit2Proxy).
// Neon-free: on-chain RPC reads only. The facilitator never holds user
// funds and cannot change the amount or destination — it only broadcasts
// signatures the payer made.

import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  getAddress,
  parseAbi,
  encodeFunctionData,
  recoverTypedDataAddress,
  formatUnits,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { robinhoodChain } from '@/lib/chain';
import { AgentRegistryABI, AgentScoreABI } from '@/lib/contracts/agent-credit-score-abi';
import { getAgentRegistryAddress, getAgentScoreAddress } from '@/lib/contracts/addresses';
import {
  X402_VERSION,
  X402_NETWORK,
  X402_CHAIN_ID,
  X402_ASSETS,
  X402_PAY_TO,
  X402_MAX_TIMEOUT_SECONDS,
  USDG_ADDRESS,
  POLYDASH_ADDRESS,
  PERMIT2_ADDRESS,
  PERMIT2_PROXY_ADDRESS,
  USDG_EIP712,
  bandForScore,
  type X402Asset,
} from './constants';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';

export function x402PublicClient(): PublicClient {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(RPC_URL, { timeout: 8_000 }),
  }) as PublicClient;
}

const EIP3009_ABI = parseAbi([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) returns (bool)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function nonces(address owner) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

const PROXY_ABI = parseAbi([
  // x402ExactPermit2Proxy.settle(PermitTransferFrom permit, address owner,
  // Witness witness, bytes signature) — PermitTransferFrom is
  // { TokenPermissions permitted, uint256 nonce, uint256 deadline }.
  'function settle(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, address owner, (address to, uint256 validAfter) witness, bytes signature) external',
]);

// --- Types (x402 v2) -------------------------------------------------------

export interface PaymentRequirement {
  scheme: 'exact';
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource: { url: string; description: string; mimeType: string };
  description: string;
  mimeType: string;
  extra: Record<string, string>;
}

export interface PaymentPayload {
  x402Version: number;
  accepted: PaymentRequirement;
  payload:
    | {
        signature: Hex;
        authorization: {
          from: string;
          to: string;
          value: string;
          validAfter: string;
          validBefore: string;
          nonce: Hex;
        };
      }
    | {
        signature: Hex;
        permit2Authorization: {
          permitted: { token: string; amount: string };
          from: string;
          spender: string;
          nonce: string;
          deadline: string;
          witness: { to: string; validAfter: string };
        };
      };
}

export interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

// --- Prices ----------------------------------------------------------------

// POLYDASH/USD from Dexscreener (on-chain price from the POLYDASH/WETH
// pool), 60 s cache. Returns 0 when the price cannot be read — callers
// then offer USDG only.
//
// Do NOT use CoinGecko's simple-price API for this token: it returned
// $0.00054081 on 2026-11-17 while the on-chain price was $0.000000194
// (Dexscreener + CoinGecko's own page FDV $19,324 / 100B supply agree) —
// ~2,790x too high, which would let POLYDASH payers underpay ~2,790x.
// A wrong price is worse than no price, so there is no CoinGecko fallback.
let polyPrice: { price: number; at: number } | null = null;
export async function getPolydashUsd(): Promise<number> {
  try {
    if (polyPrice && Date.now() - polyPrice.at < 60_000) return polyPrice.price;
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/0x319525528f42167eF7fC18b77b889958080568e4',
      { cache: 'no-store', signal: AbortSignal.timeout(3_000) },
    );
    const price = Number((await res.json())?.pairs?.[0]?.priceUsd);
    if (!Number.isFinite(price) || price <= 0) throw new Error('bad price');
    polyPrice = { price, at: Date.now() };
    return price;
  } catch {
    return polyPrice?.price ?? 0;
  }
}

/** USD value (6 dp) of an amount of an asset at current prices. */
export async function usdValue6(asset: X402Asset, amount: bigint): Promise<bigint> {
  if (asset === 'USDG') return amount; // 6 dp, $1
  const price = await getPolydashUsd();
  if (!price) return 0n;
  // POLYDASH is 18 dp: value6 = amount * price / 1e18 * 1e6.
  // The price needs 12 dp of precision (at ~$0.000000194, 6 dp rounds
  // to 0): value6 = amount * price12 / 1e24.
  return (amount * BigInt(Math.round(price * 1e12))) / 10n ** 24n;
}

// --- Guardrails ------------------------------------------------------------

/** On-chain credit score for a payer wallet (null = unregistered). */
export async function scoreForWallet(client: PublicClient, wallet: string): Promise<number | null> {
  try {
    const registry = getAgentRegistryAddress();
    const scoreAddr = getAgentScoreAddress();
    if (!registry || !scoreAddr || !isAddress(wallet)) return null;
    const agentId = (await client.readContract({
      address: registry,
      abi: AgentRegistryABI,
      functionName: 'agentIdByWallet',
      args: [wallet as `0x${string}`],
    })) as bigint;
    if (!agentId) return null;
    const score = (await client.readContract({
      address: scoreAddr,
      abi: AgentScoreABI,
      functionName: 'scoreOf',
      args: [agentId],
    })) as number;
    return score || null;
  } catch {
    return null;
  }
}

// Best-effort daily spend tracking (per server instance; the SpendVault is
// the on-chain enforcement for tab users).
const dailySpend = new Map<string, { day: number; totalUsd6: bigint }>();
function checkDailyCap(payer: string, valueUsd6: bigint, dailyUsd: number): boolean {
  const day = Math.floor(Date.now() / 86_400_000);
  const entry = dailySpend.get(payer.toLowerCase());
  const spent = entry && entry.day === day ? entry.totalUsd6 : 0n;
  return spent + valueUsd6 <= BigInt(Math.round(dailyUsd * 1e6));
}
function recordDailySpend(payer: string, valueUsd6: bigint) {
  const day = Math.floor(Date.now() / 86_400_000);
  const entry = dailySpend.get(payer.toLowerCase());
  const spent = entry && entry.day === day ? entry.totalUsd6 : 0n;
  dailySpend.set(payer.toLowerCase(), { day, totalUsd6: spent + valueUsd6 });
}

// --- Payment requirements --------------------------------------------------

export function buildRequirements(
  resourceUrl: string,
  description: string,
  priceUsd: number,
  polyUsd?: number,
): PaymentRequirement[] {
  const out: PaymentRequirement[] = [];
  const usdgAmount = BigInt(Math.round(priceUsd * 1e6));
  out.push({
    scheme: 'exact',
    network: X402_NETWORK,
    amount: usdgAmount.toString(),
    asset: USDG_ADDRESS,
    payTo: X402_PAY_TO,
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    resource: { url: resourceUrl, description, mimeType: 'application/json' },
    description,
    mimeType: 'application/json',
    extra: { assetTransferMethod: 'eip3009', name: USDG_EIP712.name, version: USDG_EIP712.version },
  });
  if (polyUsd && polyUsd > 0) {
    // POLYDASH amount at the quoted price, 18 dp. The price needs 12 dp
    // of precision: at ~$0.000000194, 6 dp rounds to 0 and BigInt
    // division by 0 throws. amount = priceUsd6 * 1e24 / polyUsd12.
    const polyUsd12 = BigInt(Math.round(polyUsd * 1e12));
    if (polyUsd12 > 0n) {
      const polyAmount = (BigInt(Math.round(priceUsd * 1e6)) * 10n ** 24n) / polyUsd12;
      out.push({
        scheme: 'exact',
        network: X402_NETWORK,
        amount: polyAmount.toString(),
        asset: POLYDASH_ADDRESS,
        payTo: X402_PAY_TO,
        maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
        resource: { url: resourceUrl, description, mimeType: 'application/json' },
        description,
        mimeType: 'application/json',
        extra: { assetTransferMethod: 'permit2', name: 'Polydash', version: '1' },
      });
    }
  }
  return out;
}

export function paymentRequiredBody(accepts: PaymentRequirement[]) {
  return { x402Version: X402_VERSION, accepts };
}

export function toBase64Json(v: unknown): string {
  return Buffer.from(JSON.stringify(v), 'utf8').toString('base64');
}

export function parsePaymentSignature(header: string | null): PaymentPayload | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as PaymentPayload;
    if (decoded?.x402Version !== 2 || !decoded?.accepted || !decoded?.payload) return null;
    return decoded;
  } catch {
    return null;
  }
}

// --- Verify ----------------------------------------------------------------

function splitSig(sig: Hex): { v: number; r: Hex; s: Hex } {
  const b = Buffer.from(sig.slice(2), 'hex');
  return { r: `0x${b.subarray(0, 32).toString('hex')}` as Hex, s: `0x${b.subarray(32, 64).toString('hex')}` as Hex, v: b[64] };
}

export async function verifyPayment(
  client: PublicClient,
  payload: PaymentPayload,
): Promise<VerifyResult> {
  const req = payload.accepted;
  const now = Math.floor(Date.now() / 1_000);
  try {
    if (req.scheme !== 'exact' || req.network !== X402_NETWORK) {
      return { isValid: false, invalidReason: 'unsupported_scheme_or_network' };
    }
    if (!isAddress(req.payTo) || getAddress(req.payTo) !== getAddress(X402_PAY_TO)) {
      return { isValid: false, invalidReason: 'recipient_mismatch' };
    }
    const amount = BigInt(req.amount);

    if ('authorization' in payload.payload) {
      // --- EIP-3009 (USDG) ---
      if (getAddress(req.asset) !== getAddress(USDG_ADDRESS)) {
        return { isValid: false, invalidReason: 'asset_mismatch' };
      }
      const a = payload.payload.authorization;
      if (getAddress(a.to) !== getAddress(X402_PAY_TO)) return { isValid: false, invalidReason: 'recipient_mismatch' };
      if (BigInt(a.value) !== amount) return { isValid: false, invalidReason: 'amount_mismatch' };
      if (Number(a.validAfter) > now) return { isValid: false, invalidReason: 'not_yet_valid' };
      if (Number(a.validBefore) <= now) return { isValid: false, invalidReason: 'authorization_expired' };
      const signer = await recoverTypedDataAddress({
        domain: { name: USDG_EIP712.name, version: USDG_EIP712.version, chainId: X402_CHAIN_ID, verifyingContract: USDG_ADDRESS as `0x${string}` },
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
        message: {
          from: a.from as `0x${string}`,
          to: a.to as `0x${string}`,
          value: BigInt(a.value),
          validAfter: BigInt(a.validAfter),
          validBefore: BigInt(a.validBefore),
          nonce: a.nonce,
        },
        signature: payload.payload.signature,
      });
      if (getAddress(signer) !== getAddress(a.from)) return { isValid: false, invalidReason: 'invalid_signature' };
      const [balance, used] = await Promise.all([
        client.readContract({ address: USDG_ADDRESS as `0x${string}`, abi: EIP3009_ABI, functionName: 'balanceOf', args: [a.from as `0x${string}`] }),
        client.readContract({ address: USDG_ADDRESS as `0x${string}`, abi: EIP3009_ABI, functionName: 'authorizationState', args: [a.from as `0x${string}`, a.nonce] }),
      ]);
      if ((balance as bigint) < amount) return { isValid: false, invalidReason: 'insufficient_funds' };
      if (used as boolean) return { isValid: false, invalidReason: 'nonce_already_used' };
      // Simulate the settlement so a revert is caught before we promise content.
      const { v, r, s } = splitSig(payload.payload.signature);
      await client.call({
        account: a.from as `0x${string}`,
        to: USDG_ADDRESS as `0x${string}`,
        data: encodeFunctionData({
          abi: EIP3009_ABI,
          functionName: 'transferWithAuthorization',
          args: [a.from as `0x${string}`, a.to as `0x${string}`, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, v, r, s],
        }),
      });
      const guard = await guardrailCheck(client, a.from, 'USDG', amount);
      if (!guard.ok) return { isValid: false, invalidReason: guard.reason };
      return { isValid: true, payer: getAddress(a.from) };
    }

    if ('permit2Authorization' in payload.payload) {
      // --- Permit2 (POLYDASH) ---
      if (getAddress(req.asset) !== getAddress(POLYDASH_ADDRESS)) {
        return { isValid: false, invalidReason: 'asset_mismatch' };
      }
      const p = payload.payload.permit2Authorization;
      if (getAddress(p.spender) !== getAddress(PERMIT2_PROXY_ADDRESS)) {
        return { isValid: false, invalidReason: 'spender_mismatch' };
      }
      if (getAddress(p.permitted.token) !== getAddress(POLYDASH_ADDRESS)) {
        return { isValid: false, invalidReason: 'asset_mismatch' };
      }
      if (BigInt(p.permitted.amount) !== amount) return { isValid: false, invalidReason: 'amount_mismatch' };
      if (getAddress(p.witness.to) !== getAddress(X402_PAY_TO)) return { isValid: false, invalidReason: 'recipient_mismatch' };
      if (Number(p.deadline) <= now) return { isValid: false, invalidReason: 'authorization_expired' };
      if (Number(p.witness.validAfter) > now) return { isValid: false, invalidReason: 'not_yet_valid' };
      const signer = await recoverTypedDataAddress({
        domain: { name: 'Permit2', chainId: X402_CHAIN_ID, verifyingContract: PERMIT2_ADDRESS as `0x${string}` },
        types: {
          PermitWitnessTransferFrom: [
            { name: 'permitted', type: 'TokenPermissions' },
            { name: 'spender', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
            { name: 'witness', type: 'Witness' },
          ],
          TokenPermissions: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          Witness: [
            { name: 'to', type: 'address' },
            { name: 'validAfter', type: 'uint256' },
          ],
        },
        primaryType: 'PermitWitnessTransferFrom',
        message: {
          permitted: { token: p.permitted.token as `0x${string}`, amount: BigInt(p.permitted.amount) },
          spender: p.spender as `0x${string}`,
          nonce: BigInt(p.nonce),
          deadline: BigInt(p.deadline),
          witness: { to: p.witness.to as `0x${string}`, validAfter: BigInt(p.witness.validAfter) },
        },
        signature: payload.payload.signature,
      });
      if (getAddress(signer) !== getAddress(p.from)) return { isValid: false, invalidReason: 'invalid_signature' };
      const [balance, allowance] = await Promise.all([
        client.readContract({ address: POLYDASH_ADDRESS as `0x${string}`, abi: EIP3009_ABI, functionName: 'balanceOf', args: [p.from as `0x${string}`] }),
        client.readContract({ address: POLYDASH_ADDRESS as `0x${string}`, abi: EIP3009_ABI, functionName: 'allowance', args: [p.from as `0x${string}`, PERMIT2_ADDRESS as `0x${string}`] }),
      ]);
      if ((balance as bigint) < amount) return { isValid: false, invalidReason: 'insufficient_funds' };
      if ((allowance as bigint) < amount) return { isValid: false, invalidReason: 'permit2_allowance_required' };
      // Simulate proxy.settle.
      await client.call({
        account: p.from as `0x${string}`,
        to: PERMIT2_PROXY_ADDRESS as `0x${string}`,
        data: encodeFunctionData({
          abi: PROXY_ABI,
          functionName: 'settle',
          args: [
            { permitted: { token: p.permitted.token as `0x${string}`, amount: BigInt(p.permitted.amount) }, nonce: BigInt(p.nonce), deadline: BigInt(p.deadline) },
            p.from as `0x${string}`,
            { to: p.witness.to as `0x${string}`, validAfter: BigInt(p.witness.validAfter) },
            payload.payload.signature,
          ],
        }),
      });
      const guard = await guardrailCheck(client, p.from, 'POLYDASH', amount);
      if (!guard.ok) return { isValid: false, invalidReason: guard.reason };
      return { isValid: true, payer: getAddress(p.from) };
    }

    return { isValid: false, invalidReason: 'unsupported_payload' };
  } catch (e: any) {
    return { isValid: false, invalidReason: `verification_failed:${e?.shortMessage ?? e?.message ?? 'unknown'}` };
  }
}

async function guardrailCheck(
  client: PublicClient,
  payer: string,
  asset: X402Asset,
  amount: bigint,
): Promise<{ ok: boolean; reason?: string }> {
  const score = await scoreForWallet(client, payer);
  const band = bandForScore(score);
  const valueUsd6 = await usdValue6(asset, amount);
  if (valueUsd6 <= 0n) return { ok: false, reason: 'price_unavailable' };
  if (valueUsd6 > BigInt(Math.round(band.perPaymentUsd * 1e6))) {
    return { ok: false, reason: 'over_per_payment_cap' };
  }
  if (!checkDailyCap(payer, valueUsd6, band.dailyUsd)) {
    return { ok: false, reason: 'over_daily_cap' };
  }
  return { ok: true };
}

// --- Settle ----------------------------------------------------------------

export interface SettleResult {
  success: boolean;
  transaction?: Hex;
  network?: string;
  payer?: string;
  errorReason?: string;
  pending?: boolean;
}

function facilitatorClient(): { wallet: ReturnType<typeof createWalletClient>; address: `0x${string}` } | null {
  const key = process.env.X402_FACILITATOR_PRIVATE_KEY;
  if (!key || !key.startsWith('0x')) return null;
  const account = privateKeyToAccount(key as Hex);
  const wallet = createWalletClient({ chain: robinhoodChain, transport: http(RPC_URL), account });
  return { wallet, address: account.address };
}

export function facilitatorConfigured(): boolean {
  return !!process.env.X402_FACILITATOR_PRIVATE_KEY?.startsWith('0x');
}

export async function settlePayment(
  client: PublicClient,
  payload: PaymentPayload,
  verify: VerifyResult,
): Promise<SettleResult> {
  if (!verify.isValid || !verify.payer) {
    return { success: false, errorReason: verify.invalidReason ?? 'invalid_payment' };
  }
  const fac = facilitatorClient();
  if (!fac) return { success: false, errorReason: 'facilitator_not_configured' };
  const req = payload.accepted;
  const amount = BigInt(req.amount);
  try {
    let hash: Hex;
    if ('authorization' in payload.payload) {
      const a = payload.payload.authorization;
      const { v, r, s } = splitSig(payload.payload.signature);
      hash = await fac.wallet.writeContract({
        address: USDG_ADDRESS as `0x${string}`,
        abi: EIP3009_ABI,
        functionName: 'transferWithAuthorization',
        args: [a.from as `0x${string}`, a.to as `0x${string}`, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, v, r, s],
      });
    } else if ('permit2Authorization' in payload.payload) {
      const p = payload.payload.permit2Authorization;
      hash = await fac.wallet.writeContract({
        address: PERMIT2_PROXY_ADDRESS as `0x${string}`,
        abi: PROXY_ABI,
        functionName: 'settle',
        args: [
          { permitted: { token: p.permitted.token as `0x${string}`, amount: BigInt(p.permitted.amount) }, nonce: BigInt(p.nonce), deadline: BigInt(p.deadline) },
          p.from as `0x${string}`,
          { to: p.witness.to as `0x${string}`, validAfter: BigInt(p.witness.validAfter) },
          payload.payload.signature,
        ],
      });
    } else {
      return { success: false, errorReason: 'unsupported_payload' };
    }
    // Wait briefly for the receipt (Robinhood Chain blocks are fast). If it
    // does not land in time, the tx was still broadcast — report pending so
    // the caller can reconcile on-chain instead of paying twice.
    try {
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 6_000 });
      if (receipt.status !== 'success') return { success: false, errorReason: 'settlement_reverted', transaction: hash, network: X402_NETWORK };
    } catch {
      return { success: true, pending: true, transaction: hash, network: X402_NETWORK, payer: verify.payer };
    }
    // Record the daily spend only once settlement is confirmed.
    const asset: X402Asset = getAddress(req.asset) === getAddress(USDG_ADDRESS) ? 'USDG' : 'POLYDASH';
    recordDailySpend(verify.payer, await usdValue6(asset, amount));
    return { success: true, transaction: hash, network: X402_NETWORK, payer: verify.payer };
  } catch (e: any) {
    return { success: false, errorReason: `settlement_failed:${e?.shortMessage ?? e?.message ?? 'unknown'}` };
  }
}

/** Human-readable USDG amount for logs/responses. */
export function formatUsdg6(amount: bigint): string {
  return `$${formatUnits(amount, 6)}`;
}
