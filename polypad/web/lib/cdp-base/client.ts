// CDP client for the Base-side agent wallets — server-only.
//
// Credentials come from Vercel env (never from code or files):
// - CDP_API_KEY_ID + CDP_API_KEY_SECRET: authenticate every CDP call.
// - CDP_WALLET_SECRET: additionally required for sensitive wallet writes
//   (creating accounts, signing, sending). It is generated in the CDP
//   Portal (Non-custodial Wallet → Security → Generate) and is shown once.
//   WITHOUT it, account creation and signing fail with a wallet-auth
//   error — the routes surface that as `cdp_wallet_secret_not_configured`
//   instead of pretending the wallet exists.
//
// Values are never logged or returned. Only presence is ever reported.
import { CdpClient } from '@coinbase/cdp-sdk';

export function cdpApiConfigured(): boolean {
  return !!process.env.CDP_API_KEY_ID && !!process.env.CDP_API_KEY_SECRET;
}

export function cdpWalletSecretConfigured(): boolean {
  return !!process.env.CDP_WALLET_SECRET;
}

/** Full client (all three credentials) or null when any is missing. */
export function getCdpClient(): CdpClient | null {
  if (!cdpApiConfigured() || !cdpWalletSecretConfigured()) return null;
  return new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
  });
}

/**
 * Read-only client (API key only). Enough for policy reads/creation and
 * account reads — not for creating accounts or signing. Used so the
 * create flow can report exactly how far CDP lets it get.
 */
export function getCdpReadClient(): CdpClient | null {
  if (!cdpApiConfigured()) return null;
  return new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
  });
}
