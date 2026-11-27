/**
 * The wallet-token format, shared by the server (which verifies tokens) and the /sign page
 * (which builds them). Client-safe: no server imports. The format is the contract — both sides
 * must build and read exactly this, or verification fails.
 *
 * Token = base64url(JSON { v: 1, address, exp, sig }) where sig is the wallet's personal_sign
 * signature over bindingMessage(address, exp).
 */
export const WALLET_TOKEN_VERSION = 1;
/** A binding lasts 90 days from signing. After that, connect again on /sign. */
export const WALLET_TOKEN_TTL_SECONDS = 90 * 24 * 3600;

export function bindingMessage(address: string, exp: number): string {
  return [
    'Polypad agent API wallet binding',
    `Wallet: ${address}`,
    `Expires: ${exp}`,
    'This signature only proves you own this wallet. It cannot move funds and is not a transaction.',
  ].join('\n');
}

export function toBase64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

export function fromBase64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Build the token from a wallet address, an expiry (unix seconds), and the signature over bindingMessage. */
export function buildWalletToken(address: string, exp: number, sig: string): string {
  return toBase64Url(JSON.stringify({ v: WALLET_TOKEN_VERSION, address, exp, sig }));
}
