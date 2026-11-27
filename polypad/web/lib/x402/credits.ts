// Poly credits for the x402 facilitator — server-only.
//
// Lets a Pro API key pay for x402 products out of its Poly credits
// balance (integer cents) instead of an on-chain USDG/POLYDASH payment.
// The on-chain verify/settle path in lib/x402/facilitator.ts is untouched;
// this module only resolves keys, prices products, and talks to the
// credits ledger in lib/credits/ledger.ts.
//
// Ledger interface (lib/credits/ledger.ts, landed Nov 19):
//   keySubject(keyId) -> `key:${keyId}`
//   walletSubject(address) -> `wallet:${lowercase address}`
//   getBalance(subject) -> Promise<{ balanceCents: number; expiresAt: Date | null; expired: boolean }>
//     Never null: a missing account reads as { balanceCents: 0, expiresAt: null, expired: false },
//     so checkCredits reports a missing account as 'insufficient' (fail closed,
//     falls through to the on-chain payment flow); the 'no_account' reason
//     surfaces via spendCredits instead.
//   spendCredits({ subject, amountCents, productId, reason }) ->
//     Promise<{ ok: true; balanceAfterCents: number } | { ok: false; reason: 'insufficient' | 'expired' | 'no_account' }>
//     Race-safe (conditional decrement in a transaction).
// getBalance is normalized defensively below (object or bare number) so a
// minor shape change in the ledger does not break callers.

import { resolveApiKey } from '@/lib/agents-api/v2/keys';
import { getBalance, spendCredits, keySubject } from '@/lib/credits/ledger';
import { X402_PRODUCTS } from './constants';

export type CreditCheck =
  | { ok: true; balanceCents: number }
  | { ok: false; reason: 'unknown_product' | 'insufficient' | 'expired' | 'no_account' };

export type CreditSpend =
  | { ok: true; balanceAfterCents: number }
  | { ok: false; reason: string };

/**
 * Resolve the Pro key on a request to its credits subject.
 * Returns null when there is no key, the key is invalid/revoked, or the
 * tier is not pro. The raw key value is never logged or returned.
 *
 * Degradation is binding: if the key DB is down, resolveApiKey returns
 * free-tier `degraded`, never an error — that resolves to null here, so
 * the caller falls through to the normal on-chain 402. A credits outage
 * never blocks an on-chain payment.
 *
 * Known window (by design, not fixed here): resolveApiKey caches validated
 * key hashes in memory for 60 s, so a revoked key can still spend credits
 * for up to 60 s after revocation — the same window as Pro limits today.
 */
export async function resolveCreditSubject(req: Request): Promise<{ subject: string; keyId: string } | null> {
  const resolved = await resolveApiKey(req);
  if (resolved.tier !== 'pro') return null;
  return { subject: keySubject(resolved.keyId), keyId: resolved.keyId };
}

/** Price of a product in integer cents, from X402_PRODUCTS. Null when unknown. */
export function priceCents(productId: string): number | null {
  const product = X402_PRODUCTS.find((p) => p.id === productId);
  if (!product) return null;
  return Math.round(product.priceUsd * 100);
}

type BalanceRow =
  | { balanceCents: number; expiresAt?: Date | string | null; expired?: boolean }
  | number
  | null
  | undefined;

/**
 * Normalize whatever getBalance returns into a balance + expiry, or null.
 * Prefers the ledger's own `expired` flag when present; otherwise derives
 * expiry from expiresAt.
 */
function normalizeBalance(row: BalanceRow): { balanceCents: number; expired: boolean } | null {
  if (row == null) return null;
  if (typeof row === 'number') return { balanceCents: row, expired: false };
  const expired =
    typeof row.expired === 'boolean'
      ? row.expired
      : row.expiresAt != null &&
        (row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt)).getTime() <= Date.now();
  return { balanceCents: row.balanceCents, expired };
}

/**
 * Check whether a credits subject can afford a product. Read-only — never debits.
 * A ledger/DB failure fails closed as 'insufficient' so callers fall through
 * to the on-chain payment flow instead of granting free access.
 */
export async function checkCredits(subject: string, productId: string): Promise<CreditCheck> {
  const price = priceCents(productId);
  if (price == null) return { ok: false, reason: 'unknown_product' };
  let row: BalanceRow;
  try {
    row = (await getBalance(subject)) as BalanceRow;
  } catch {
    return { ok: false, reason: 'insufficient' };
  }
  const balance = normalizeBalance(row);
  if (!balance) return { ok: false, reason: 'no_account' };
  if (balance.expired) return { ok: false, reason: 'expired' };
  if (balance.balanceCents < price) return { ok: false, reason: 'insufficient' };
  return { ok: true, balanceCents: balance.balanceCents };
}

/**
 * Debit a product's price from a credits subject. Thin wrapper over
 * spendCredits with reason `x402:${productId}`. The ledger performs the
 * spend atomically; a failure (e.g. the balance dropped since the check)
 * returns { ok: false } and debits nothing.
 */
export async function spendForProduct(subject: string, productId: string): Promise<CreditSpend> {
  const price = priceCents(productId);
  if (price == null) return { ok: false, reason: 'unknown_product' };
  try {
    const result = await spendCredits({
      subject,
      amountCents: price,
      productId,
      reason: `x402:${productId}`,
    });
    if (result.ok) return { ok: true, balanceAfterCents: result.balanceAfterCents };
    return { ok: false, reason: result.reason };
  } catch {
    return { ok: false, reason: 'spend_failed' };
  }
}
