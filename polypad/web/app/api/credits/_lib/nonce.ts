import crypto from 'crypto';
import { getAddress, isAddress, isHex } from 'viem';
import { prisma } from '@/lib/db';
import { agentClient } from '@/lib/agents-api/core';

export const CREDITS_NONCE_TTL_MS = 10 * 60_000;
export const CREDITS_NONCE_MAX_LIVE = 10;

export type CreditsNoncePurpose = 'claim' | 'link-key' | 'topup';

/** The exact message the wallet signs. Keep in sync with the nonce route. */
export function creditsNonceMessage(purpose: CreditsNoncePurpose, nonce: string): string {
  if (purpose === 'claim') return `Poly credits: claim $25 starter. Nonce: ${nonce}`;
  if (purpose === 'topup') return `Poly credits: top up my balance. Nonce: ${nonce}`;
  return `Poly credits: link my Pro key. Nonce: ${nonce}`;
}

export function isCreditsNoncePurpose(value: unknown): value is CreditsNoncePurpose {
  return value === 'claim' || value === 'link-key' || value === 'topup';
}

/**
 * Verify a wallet signature over a single-use AuthNonce, mirroring the
 * admin verify route: the nonce row is deleted on use (even when the check
 * fails), the stored address must match, and the signature is checked with
 * agentClient.verifyMessage. Without this, anyone could burn another
 * wallet's one-per-wallet starter slot or drain its balance onto their own
 * key.
 */
export async function verifyCreditsSignature(args: {
  wallet: string;
  nonce: string;
  signature: string;
  purpose: CreditsNoncePurpose;
}): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  const { wallet, nonce, signature, purpose } = args;
  const address = wallet.toLowerCase();
  if (!isAddress(address, { strict: false }) || !/^[0-9a-f]{32}$/.test(nonce) || !isHex(signature)) {
    return { ok: false, status: 400, reason: 'Send the wallet address, nonce, and signature.' };
  }
  try {
    const stored = await prisma.authNonce.findUnique({ where: { nonce } });
    if (stored) await prisma.authNonce.delete({ where: { nonce } }).catch(() => null);
    if (!stored || stored.address !== address || stored.expiresAt < new Date()) {
      return { ok: false, status: 401, reason: 'That sign-in request expired. Ask for a new one and sign again.' };
    }
    const ok = await agentClient
      .verifyMessage({
        address: getAddress(address),
        message: creditsNonceMessage(purpose, nonce),
        signature: signature as `0x${string}`,
      })
      .catch(() => false);
    if (!ok) {
      return { ok: false, status: 401, reason: 'The signature does not match this wallet.' };
    }
    return { ok: true };
  } catch (e: unknown) {
    console.error('credits signature verify failed', e instanceof Error ? e.message : e);
    return { ok: false, status: 500, reason: 'Could not verify the signature right now.' };
  }
}

/** Issue a fresh single-use nonce for a wallet + purpose (10-minute expiry). */
export async function issueCreditsNonce(
  wallet: string,
  purpose: CreditsNoncePurpose,
): Promise<{ nonce: string; message: string }> {
  const address = wallet.toLowerCase();
  await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const nonce = crypto.randomBytes(16).toString('hex');
  await prisma.authNonce.create({
    data: { address, nonce, expiresAt: new Date(Date.now() + CREDITS_NONCE_TTL_MS) },
  });
  return { nonce, message: creditsNonceMessage(purpose, nonce) };
}
