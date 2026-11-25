/**
 * Persistent wallet binding for the agent API — the "connect once" token.
 *
 * How it works, with no server storage at all:
 *
 * 1. The user opens /sign?connect=1, connects their wallet, and signs one short message (a plain
 *    `personal_sign`, never a transaction). The message names the wallet and an expiry date.
 * 2. The page builds the token: the wallet address, the expiry, and that signature, encoded as
 *    base64url JSON. The SDK stores it (for example in POLYPAD_WALLET_TOKEN).
 * 3. Every prepare call after that passes `walletToken` instead of `from`. The server recovers the
 *    signer from the signature, checks it matches the wallet named in the token and that the token
 *    has not expired, and uses that wallet as `from`.
 *
 * Because the token is self-contained (address + expiry + signature), there is nothing to store,
 * nothing to look up, and nothing to leak server-side. The trade-off is honest: a token cannot be
 * revoked from the server — it stops working when it expires (90 days), or when the holder deletes
 * it. It also cannot move funds: it is a signature over a binding message, not a transaction, and
 * the API still only ever returns unsigned transactions for the user (or the agent's own wallet) to sign.
 *
 * Per-call `from` remains the underlying transport and the fallback: a call with no token still
 * needs `from`, exactly as before. A call with both must agree — a token and a different `from`
 * is refused.
 */
import { getAddress, isAddress, recoverMessageAddress, type Hex } from 'viem';
import { ApiError, type Addr } from './core';
import { WALLET_TOKEN_TTL_SECONDS, WALLET_TOKEN_VERSION, bindingMessage, fromBase64Url, buildWalletToken } from './wallet-token-shared';

export { WALLET_TOKEN_TTL_SECONDS, WALLET_TOKEN_VERSION, bindingMessage, buildWalletToken };

export type WalletToken = { v: number; address: Addr; exp: number; sig: Hex };

function parseWalletToken(token: unknown): WalletToken | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return null;
  const text = fromBase64Url(token.trim());
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (o.v !== WALLET_TOKEN_VERSION) return null;
  if (typeof o.address !== 'string' || !isAddress(o.address, { strict: false })) return null;
  if (typeof o.exp !== 'number' || !Number.isFinite(o.exp) || o.exp <= 0) return null;
  if (typeof o.sig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(o.sig)) return null;
  return { v: 1, address: getAddress(o.address), exp: Math.floor(o.exp), sig: o.sig as Hex };
}

/**
 * Verify a token and return the bound wallet. Returns null when the token is malformed, expired,
 * or signed by a different wallet. Pure and stateless.
 */
export async function verifyWalletToken(token: unknown, nowSec = Math.floor(Date.now() / 1000)): Promise<Addr | null> {
  const parsed = parseWalletToken(token);
  if (!parsed) return null;
  if (parsed.exp <= nowSec) return null;
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message: bindingMessage(parsed.address, parsed.exp), signature: parsed.sig });
  } catch {
    return null;
  }
  if (signer.toLowerCase() !== parsed.address.toLowerCase()) return null;
  return parsed.address;
}

/** Like verifyWalletToken, but throws the API error the caller returns for a bad token. */
export async function resolveWalletToken(token: unknown): Promise<Addr> {
  const address = await verifyWalletToken(token);
  if (!address) {
    throw new ApiError(400, 'invalid_params', 'walletToken is not valid: it must be a token from /sign?connect=1, signed by the wallet it names, and not expired (90 days). Connect again to get a new one.', { field: 'walletToken' });
  }
  return address;
}

/**
 * Apply a walletToken to a prepare call's input, in place. When a token is present it resolves the
 * wallet; when `from` is also present the two must agree. When no token is present, nothing changes
 * and the call keeps needing `from` as before.
 */
export async function applyWalletBinding(input: Record<string, unknown>): Promise<void> {
  const token = input.walletToken;
  if (token === undefined || token === null || token === '') return;
  const bound = await resolveWalletToken(token);
  const from = input.from;
  if (typeof from === 'string' && from !== '') {
    if (!isAddress(from, { strict: false }) || getAddress(from) !== bound) {
      throw new ApiError(400, 'invalid_params', 'walletToken and from name different wallets. Pass one or the other, or make them agree.', { field: 'from' });
    }
    return;
  }
  input.from = bound;
}
