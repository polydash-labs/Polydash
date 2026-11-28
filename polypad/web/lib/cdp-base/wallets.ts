// Base-side agent wallets — server logic (server-only).
//
// A Base agent wallet is a CDP Server Wallet on Base (chain 8453) with an
// account-level Policy Engine policy, created for a human owner who proves
// ownership with a wallet signature. The agent spends with a bearer key
// (pp_base_…, SHA-256 stored, shown once) inside the caps below.
//
// Money is integer US cents everywhere. Two ceilings apply, and the UI
// states both:
// - Polypad's caps (chosen by the owner at creation): daily cap and
//   per-payment cap, enforced here in Neon before anything is signed.
// - Coinbase's payment checker (the x402 guardrails in
//   lib/x402/facilitator.ts): an unregistered wallet may spend at most
//   $0.05 per payment and $0.50 per day, so the presets stop there. A
//   higher cap would never bind — the facilitator would reject the
//   payment first.
//
// The wallet can ONLY pay Polypad's own x402 products, only in USDC on
// Base, only to the single fee wallet. There is no generic send in v1.
import { createHash, randomBytes } from 'node:crypto';
import { createPublicClient, http, getAddress, isAddress, parseAbi, type Hex, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import { recoverMessageAddress } from 'viem';
import { prisma, withTimeout } from '@/lib/db';
import { CdpClient } from '@coinbase/cdp-sdk';
import { getCdpClient, cdpApiConfigured, cdpWalletSecretConfigured } from './client';
import { createBaseWalletPolicy, pauseBaseWalletPolicy, resumeBaseWalletPolicy } from './policies';
import { creationMessage, freezeMessage } from './message';
import {
  USDC_BASE_ADDRESS,
  USDC_BASE_EIP712,
  X402_PAY_TO,
  X402_BASE_NETWORK,
  X402_PRODUCTS,
  type X402Product,
} from '@/lib/x402/constants';
import { buildBaseRequirement, verifyBasePayment, settleBasePayment } from '@/lib/x402/base';
import { x402PublicClient, type PaymentPayload } from '@/lib/x402/facilitator';
import { buildProduct } from '@/lib/x402/products';

const BASE_RPC_URL = 'https://mainnet.base.org';

/** Facilitator ceilings for an unregistered wallet (GUARDRAIL_BANDS[0]). */
export const FACILITATOR_PER_PAYMENT_CAP_CENTS = 5;
export const FACILITATOR_DAILY_CAP_CENTS = 50;

/** Owner-chosen presets (US cents). */
export const DAILY_CAP_OPTIONS_CENTS = [10, 25, 50];
export const PER_PAYMENT_CAP_OPTIONS_CENTS = [1, 5];
export const EXPIRY_OPTIONS_DAYS = [30, 90, 180];
export const DEFAULT_DAILY_CAP_CENTS = 50;
export const DEFAULT_PER_PAYMENT_CAP_CENTS = 5;
export const DEFAULT_EXPIRY_DAYS = 90;

/** Vercel Hobby kills the function at 10s. */
const HANDLER_TIMEOUT_MS = 9_000;

export function usdCentsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// --- Base chain reads -------------------------------------------------------

export function basePublicClient(): PublicClient {
  return createPublicClient({ chain: base, transport: http(BASE_RPC_URL, { timeout: 8_000 }) }) as PublicClient;
}

const ERC20_BALANCE_ABI = parseAbi(['function balanceOf(address account) view returns (uint256)']);

export async function baseWalletBalances(address: string): Promise<{ usdcCents: number; ethWei: bigint }> {
  const client = basePublicClient();
  const [usdc, eth] = await Promise.all([
    client.readContract({
      address: USDC_BASE_ADDRESS as `0x${string}`,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    }),
    client.getBalance({ address: address as `0x${string}` }),
  ]);
  // USDC is 6 decimals: cents = amount / 10_000 (rounded down).
  return { usdcCents: Number((usdc as bigint) / 10_000n), ethWei: eth as bigint };
}

// --- Creation (owner proves ownership with a wallet signature) ----------

export type CreateBaseWalletInput = {
  name: string;
  ownerAddress: string;
  dailyCapUsdCents: number;
  perPaymentCapUsdCents: number;
  expiryDays: number;
  validUntil: number;
  nonce: string;
  signature: Hex;
};

export type CreateBaseWalletResult =
  | { ok: true; wallet: BaseWalletView; agentKey: string }
  | { ok: false; error: string; detail?: string };

export type BaseWalletView = {
  address: string;
  name: string;
  ownerAddress: string;
  dailyCapUsdCents: number;
  perPaymentCapUsdCents: number;
  expiresAt: string;
  policyId: string | null;
  frozen: boolean;
  createdAt: string;
  usdcCents: number;
  spentTodayUsdCents: number;
};

export type BaseWalletPaymentView = {
  id: number;
  product: string;
  amountUsdCents: number;
  txHash: string | null;
  status: string;
  createdAt: string;
};

function rowToView(
  row: {
    address: string;
    name: string;
    ownerAddress: string;
    dailyCapUsdCents: number;
    perPaymentCapUsdCents: number;
    expiresAt: Date;
    policyId: string | null;
    frozen: boolean;
    createdAt: Date;
  },
  usdcCents: number,
  spentTodayUsdCents: number,
): BaseWalletView {
  return {
    address: row.address,
    name: row.name,
    ownerAddress: row.ownerAddress,
    dailyCapUsdCents: row.dailyCapUsdCents,
    perPaymentCapUsdCents: row.perPaymentCapUsdCents,
    expiresAt: row.expiresAt.toISOString(),
    policyId: row.policyId,
    frozen: row.frozen,
    createdAt: row.createdAt.toISOString(),
    usdcCents,
    spentTodayUsdCents,
  };
}

export async function spentTodayUsdCents(walletId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await withTimeout(
    prisma.baseAgentWalletPayment.findMany({
      where: { walletId, status: 'settled', createdAt: { gte: start } },
      select: { amountUsdCents: true },
    }),
  );
  if (!rows) return 0;
  return rows.reduce((sum, r) => sum + r.amountUsdCents, 0);
}

async function hydrateRow(row: {
  address: string;
  name: string;
  ownerAddress: string;
  dailyCapUsdCents: number;
  perPaymentCapUsdCents: number;
  expiresAt: Date;
  policyId: string | null;
  frozen: boolean;
  createdAt: Date;
  id: string;
}): Promise<BaseWalletView> {
  const [balances, spent] = await Promise.all([
    baseWalletBalances(row.address).catch(() => ({ usdcCents: 0, ethWei: 0n })),
    spentTodayUsdCents(row.id).catch(() => 0),
  ]);
  return rowToView(row, balances.usdcCents, spent);
}

/**
 * Create a Base agent wallet. The owner proves ownership by signing the
 * creation message with their wallet. No CDP call is made until the
 * wallet secret is present — when it is missing the error says so
 * exactly, with no side effects and no wallet created.
 */
export async function createBaseWallet(input: CreateBaseWalletInput): Promise<CreateBaseWalletResult> {
  const name = input.name.trim().slice(0, 40);
  if (!name) return { ok: false, error: 'invalid_name' };
  if (!isAddress(input.ownerAddress)) return { ok: false, error: 'invalid_owner' };
  const owner = getAddress(input.ownerAddress);
  if (!DAILY_CAP_OPTIONS_CENTS.includes(input.dailyCapUsdCents)) return { ok: false, error: 'invalid_daily_cap' };
  if (!PER_PAYMENT_CAP_OPTIONS_CENTS.includes(input.perPaymentCapUsdCents)) return { ok: false, error: 'invalid_per_payment_cap' };
  if (!EXPIRY_OPTIONS_DAYS.includes(input.expiryDays)) return { ok: false, error: 'invalid_expiry' };
  if (!/^[-A-Za-z0-9]{8,64}$/.test(input.nonce)) return { ok: false, error: 'invalid_nonce' };
  if (Math.floor(Date.now() / 1000) > input.validUntil) return { ok: false, error: 'signature_expired' };

  const expiresAt = new Date(Date.now() + input.expiryDays * 86_400_000);
  const message = creationMessage({
    ownerAddress: owner,
    name,
    dailyCapUsdCents: input.dailyCapUsdCents,
    perPaymentCapUsdCents: input.perPaymentCapUsdCents,
    expiresAtIso: expiresAt.toISOString(),
    validUntil: input.validUntil,
    nonce: input.nonce,
  });
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message, signature: input.signature });
  } catch {
    return { ok: false, error: 'invalid_signature' };
  }
  if (getAddress(signer) !== owner) return { ok: false, error: 'signature_owner_mismatch' };

  // Idempotent replay: the same signed creation returns the wallet it made.
  const existing = await withTimeout(
    prisma.baseAgentWallet.findUnique({ where: { createNonce: input.nonce } }),
  );
  if (existing) {
    const view = await hydrateRow(existing).catch(() => null);
    if (view) return { ok: true, wallet: view, agentKey: '' };
    return { ok: false, error: 'db_unavailable' };
  }

  if (!cdpApiConfigured()) {
    return {
      ok: false,
      error: 'cdp_not_configured',
      detail: 'The Coinbase API key (CDP_API_KEY_ID + CDP_API_KEY_SECRET) is not set in this environment.',
    };
  }
  if (!cdpWalletSecretConfigured()) {
    return {
      ok: false,
      error: 'cdp_wallet_secret_not_configured',
      detail:
        'The CDP wallet secret (CDP_WALLET_SECRET) is not set in this environment. It is generated in the CDP Portal → Non-custodial Wallet → Security → Generate Wallet Secret, and must be added to Vercel env (Preview + Production) as CDP_WALLET_SECRET. Creating a CDP server wallet requires it — the API key alone cannot create accounts or sign.',
    };
  }

  const cdp = getCdpClient();
  if (!cdp) return { ok: false, error: 'cdp_not_configured' };

  // 1. CDP policy (the per-payment backstop), then 2. the account itself.
  let policyId: string;
  try {
    policyId = await createBaseWalletPolicy(cdp, name);
  } catch (e: unknown) {
    return { ok: false, error: 'cdp_policy_failed', detail: e instanceof Error ? e.message : 'policy creation failed' };
  }
  let address: string;
  try {
    // CDP account names: 2–36 chars, alphanumeric + hyphens, must start
    // and end alphanumeric, unique per project.
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 22);
    const account = await cdp.evm.createAccount({ name: `polypad-base-${slug || 'wallet'}`, accountPolicy: policyId });
    address = getAddress(account.address);
  } catch (e: unknown) {
    return {
      ok: false,
      error: 'cdp_account_failed',
      detail: `${e instanceof Error ? e.message : 'account creation failed'} (policy ${policyId} was created and can be deleted from the CDP Portal)`,
    };
  }

  // 3. Agent bearer key (shown once, hash stored).
  const agentKey = `pp_base_${randomBytes(24).toString('hex')}`;
  const keyHash = sha256Hex(agentKey);
  const keyPrefix = agentKey.slice(0, 12);

  try {
    const row = await prisma.baseAgentWallet.create({
      data: {
        address,
        name,
        ownerAddress: owner,
        createNonce: input.nonce,
        keyHash,
        keyPrefix,
        dailyCapUsdCents: input.dailyCapUsdCents,
        perPaymentCapUsdCents: input.perPaymentCapUsdCents,
        expiresAt,
        policyId,
      },
    });
    const view = await hydrateRow(row);
    return { ok: true, wallet: view, agentKey };
  } catch (e: unknown) {
    // The CDP account exists but the row did not save — report it plainly
    // instead of pretending the wallet does not exist.
    return {
      ok: false,
      error: 'db_save_failed',
      detail: `The CDP wallet ${address} was created (policy ${policyId}) but its record could not be saved: ${e instanceof Error ? e.message : 'database error'}. Tell the team — do not retry with the same nonce.`,
    };
  }
}

// --- Reads ------------------------------------------------------------------

export async function listBaseWallets(ownerAddress: string): Promise<BaseWalletView[]> {
  if (!isAddress(ownerAddress)) return [];
  const rows = await withTimeout(
    prisma.baseAgentWallet.findMany({
      where: { ownerAddress: getAddress(ownerAddress), revoked: false },
      orderBy: { createdAt: 'desc' },
    }),
  );
  if (!rows) return [];
  return Promise.all(rows.map((r) => hydrateRow(r)));
}

export async function getBaseWallet(address: string): Promise<{
  wallet: BaseWalletView;
  payments: BaseWalletPaymentView[];
} | null> {
  if (!isAddress(address)) return null;
  const row = await withTimeout(
    prisma.baseAgentWallet.findUnique({ where: { address: getAddress(address) } }),
  );
  if (!row || row.revoked) return null;
  const [view, payments] = await Promise.all([
    hydrateRow(row),
    withTimeout(
      prisma.baseAgentWalletPayment.findMany({
        where: { walletId: row.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ),
  ]);
  return {
    wallet: view,
    payments: (payments ?? []).map((p) => ({
      id: p.id,
      product: p.product,
      amountUsdCents: p.amountUsdCents,
      txHash: p.txHash,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

// --- Agent-key auth -----------------------------------------------------------

/** Verify a `pp_base_…` bearer key for one wallet address. Returns the row or null. */
export async function resolveBaseWalletKey(
  req: Request,
  walletAddress: string,
): Promise<{ id: string; address: string } | null> {
  const h = req.headers.get('authorization') ?? '';
  const raw = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
  if (!raw.startsWith('pp_base_') || raw.length > 80) return null;
  if (!isAddress(walletAddress)) return null;
  const row = await withTimeout(
    prisma.baseAgentWallet.findUnique({
      where: { keyHash: sha256Hex(raw) },
      select: { id: true, address: true, revoked: true },
    }),
  );
  if (!row || row.revoked) return null;
  if (getAddress(row.address) !== getAddress(walletAddress)) return null;
  return { id: row.id, address: row.address };
}

// --- Pay ----------------------------------------------------------------------

export type PayFromBaseWalletResult =
  | { ok: true; transaction: string | null; data: unknown; spentTodayUsdCents: number }
  | { ok: false; error: string; detail?: string };

const PRODUCT_PARAMS: Record<string, { param: string; label: string }> = {
  'token-report': { param: 'address', label: 'token address' },
  'fund-nav': { param: 'fund', label: 'fund address' },
  'cto-report': { param: 'launch', label: 'launch address' },
};

/**
 * Pay for one of Polypad's x402 products from a Base agent wallet.
 * Enforces the wallet's caps + expiry + frozen state, then signs an
 * EIP-3009 authorization with the CDP wallet key and settles through the
 * CDP facilitator — the same settlement path an external agent's payment
 * takes. Funds move only after the product is built.
 */
export async function payFromBaseWallet(input: {
  walletAddress: string;
  walletId: string;
  productId: string;
  params: Record<string, string>;
  origin: string;
}): Promise<PayFromBaseWalletResult> {
  const run = async (): Promise<PayFromBaseWalletResult> => {
    const product: X402Product | undefined = X402_PRODUCTS.find((p) => p.id === input.productId);
    if (!product) return { ok: false, error: 'unknown_product' };
    const spec = PRODUCT_PARAMS[input.productId];
    const subject = input.params[spec.param];
    if (!subject || !isAddress(subject)) return { ok: false, error: 'invalid_product_param', detail: `A valid ${spec.label} is required.` };

    const priceCents = Math.round(product.priceUsd * 100);
    const row = await prisma.baseAgentWallet.findUnique({ where: { id: input.walletId } });
    if (!row || row.revoked) return { ok: false, error: 'wallet_not_found' };
    if (row.frozen) return { ok: false, error: 'wallet_frozen', detail: 'This wallet is frozen. Unfreeze it to pay again.' };
    if (row.expiresAt.getTime() < Date.now()) return { ok: false, error: 'wallet_expired', detail: 'This wallet has expired. Create a new one.' };
    if (priceCents > row.perPaymentCapUsdCents) {
      return { ok: false, error: 'over_per_payment_cap', detail: `This product costs ${usdCentsToUsd(priceCents)} but the wallet's per-payment cap is ${usdCentsToUsd(row.perPaymentCapUsdCents)}.` };
    }
    if (priceCents > FACILITATOR_PER_PAYMENT_CAP_CENTS) {
      return { ok: false, error: 'over_facilitator_cap', detail: 'Coinbase’s payment checker caps wallets it does not know yet at $0.05 per payment.' };
    }
    const spent = await spentTodayUsdCents(row.id);
    if (spent + priceCents > row.dailyCapUsdCents) {
      return { ok: false, error: 'over_daily_cap', detail: `Already spent ${usdCentsToUsd(spent)} today; the daily cap is ${usdCentsToUsd(row.dailyCapUsdCents)}.` };
    }
    const balances = await baseWalletBalances(row.address).catch(() => null);
    if (!balances) return { ok: false, error: 'balance_unavailable', detail: 'The USDC balance on Base could not be read right now.' };
    if (balances.usdcCents < priceCents) {
      return { ok: false, error: 'insufficient_funds', detail: `The wallet holds ${usdCentsToUsd(balances.usdcCents)} in USDC on Base; this product costs ${usdCentsToUsd(priceCents)}. Send USDC to ${row.address} on Base to top it up.` };
    }

    const cdp = getCdpClient();
    if (!cdp) {
      return {
        ok: false,
        error: 'cdp_wallet_secret_not_configured',
        detail: 'The CDP wallet secret (CDP_WALLET_SECRET) is not set in this environment, so the wallet cannot sign.',
      };
    }

    // Reserve the payment (unique nonce) so a replayed request is rejected.
    const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
    let paymentId: number;
    try {
      const payment = await prisma.baseAgentWalletPayment.create({
        data: { walletId: row.id, nonce, product: product.id, amountUsdCents: priceCents, status: 'pending' },
      });
      paymentId = payment.id;
    } catch {
      return { ok: false, error: 'replay_rejected', detail: 'This payment was already submitted.' };
    }
    const fail = async (error: string, detail?: string): Promise<PayFromBaseWalletResult> => {
      await prisma.baseAgentWalletPayment.update({ where: { id: paymentId }, data: { status: 'failed', error: detail ?? error } }).catch(() => undefined);
      return { ok: false, error, detail };
    };

    // EIP-3009 authorization, signed by the CDP wallet key.
    const resourceUrl = `${input.origin}/api/x402/products/${product.id}`;
    const requirement = buildBaseRequirement(resourceUrl, product.blurb, product.priceUsd);
    const now = Math.floor(Date.now() / 1000);
    const validBefore = now + 120;
    let signature: Hex;
    try {
      const signed = await (cdp as CdpClient).evm.signTypedData({
        address: row.address as `0x${string}`,
        domain: { name: USDC_BASE_EIP712.name, version: USDC_BASE_EIP712.version, chainId: 8453, verifyingContract: USDC_BASE_ADDRESS as `0x${string}` },
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
          from: row.address as `0x${string}`,
          to: X402_PAY_TO as `0x${string}`,
          value: BigInt(requirement.amount),
          validAfter: 0n,
          validBefore: BigInt(validBefore),
          nonce,
        },
      });
      signature = signed.signature as Hex;
    } catch (e: unknown) {
      return fail('signing_failed', e instanceof Error ? e.message : 'CDP signing failed');
    }

    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: requirement,
      payload: {
        signature,
        authorization: {
          from: row.address,
          to: X402_PAY_TO,
          value: requirement.amount,
          validAfter: '0',
          validBefore: String(validBefore),
          nonce,
        },
      },
    };

    // Verify through the CDP facilitator (same guardrails as any Base payer).
    const client = x402PublicClient();
    const verified = await verifyBasePayment(client, payload, requirement);
    if (!verified.isValid) {
      return fail('verification_failed', verified.invalidReason ?? 'invalid_payment');
    }

    // Build the product first — funds move only after the resource exists.
    const search = new URLSearchParams({ network: 'base', [spec.param]: subject });
    const built = await buildProduct(product.id, search);
    if ('error' in built) {
      return fail('build_failed', built.error);
    }

    const settled = await settleBasePayment(payload, requirement, verified);
    if (!settled.success) {
      return fail('settlement_failed', settled.errorReason ?? 'settlement_failed');
    }
    await prisma.baseAgentWalletPayment
      .update({ where: { id: paymentId }, data: { status: 'settled', txHash: settled.transaction ?? null } })
      .catch(() => undefined);
    return {
      ok: true,
      transaction: settled.transaction ?? null,
      data: built.data,
      spentTodayUsdCents: spent + priceCents,
    };
  };

  try {
    return await Promise.race([
      run(),
      new Promise<PayFromBaseWalletResult>((resolve) =>
        setTimeout(() => resolve({ ok: false, error: 'timeout', detail: 'The request timed out. Check the wallet’s activity before paying again — the payment may have gone through.' }), HANDLER_TIMEOUT_MS),
      ),
    ]);
  } catch (e: unknown) {
    return { ok: false, error: 'pay_failed', detail: e instanceof Error ? e.message : 'unknown error' };
  }
}

// --- Freeze / unfreeze ---------------------------------------------------------

export async function setBaseWalletFrozen(
  address: string,
  frozen: boolean,
): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  if (!isAddress(address)) return { ok: false, error: 'invalid_address' };
  const row = await prisma.baseAgentWallet.findUnique({ where: { address: getAddress(address) } });
  if (!row || row.revoked) return { ok: false, error: 'wallet_not_found' };
  if (row.frozen === frozen) return { ok: true };
  if (!row.policyId) {
    // No CDP policy attached — freeze locally only (caps are enforced
    // server-side, so this still stops payments).
    await prisma.baseAgentWallet.update({ where: { id: row.id }, data: { frozen } });
    return { ok: true };
  }
  const cdp = getCdpClient();
  if (!cdp) {
    return { ok: false, error: 'cdp_wallet_secret_not_configured', detail: 'Freezing needs the CDP wallet secret.' };
  }
  try {
    if (frozen) await pauseBaseWalletPolicy(cdp, row.policyId);
    else await resumeBaseWalletPolicy(cdp, row.policyId);
  } catch (e: unknown) {
    return { ok: false, error: 'cdp_policy_failed', detail: e instanceof Error ? e.message : 'policy update failed' };
  }
  await prisma.baseAgentWallet.update({ where: { id: row.id }, data: { frozen } });
  return { ok: true };
}
