// Polypad x402 layer — shared constants (server + client safe).
// On-chain facts verified Nov 17, 2026 on Robinhood Chain (4663):
// - USDG supports EIP-3009 transferWithAuthorization (domain: "Global
//   Dollar", version "1"). POLYDASH supports EIP-2612 permit only —
//   no EIP-3009 — so it settles via the canonical Permit2 + proxy.
// - Canonical Permit2 and the canonical x402ExactPermit2Proxy both have
//   code on 4663.

export const X402_VERSION = 2;
export const X402_NETWORK = 'eip155:4663';
export const X402_CHAIN_ID = 4663;

export const USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;
export const POLYDASH_ADDRESS = '0x319525528f42167eF7fC18b77b889958080568e4' as const;
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;
export const PERMIT2_PROXY_ADDRESS = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001' as const;

/** Where v1 product revenue settles — the Polypad fee wallet. */
export const X402_PAY_TO = '0x9a21c75aC263cC43125E70200636f6397f8776d0' as const;

/** How long a payment authorization stays valid (seconds). */
export const X402_MAX_TIMEOUT_SECONDS = 120;

export const USDG_EIP712 = { name: 'Global Dollar', version: '1' } as const;
export const POLYDASH_EIP712 = { name: 'Polydash', version: '1' } as const;

export type X402Asset = 'USDG' | 'POLYDASH';

export const X402_ASSETS: Record<
  X402Asset,
  {
    address: string;
    decimals: number;
    symbol: string;
    assetTransferMethod: 'eip3009' | 'permit2';
    eip712: { name: string; version: string };
  }
> = {
  USDG: {
    address: USDG_ADDRESS,
    decimals: 6,
    symbol: 'USDG',
    assetTransferMethod: 'eip3009',
    eip712: USDG_EIP712,
  },
  POLYDASH: {
    address: POLYDASH_ADDRESS,
    decimals: 18,
    symbol: 'POLYDASH',
    assetTransferMethod: 'permit2',
    eip712: POLYDASH_EIP712,
  },
};

/** Spending guardrails by Agent Credit Score band (USD per call / per day). */
export type GuardrailBand = {
  key: string;
  label: string;
  minScore: number | null; // null = unregistered
  perPaymentUsd: number;
  dailyUsd: number;
  allowlist: 'polypad-only' | 'approved' | 'any';
  maxKeyDays: number;
};

export const GUARDRAIL_BANDS: GuardrailBand[] = [
  { key: 'unregistered', label: 'Unregistered', minScore: null, perPaymentUsd: 0.05, dailyUsd: 0.5, allowlist: 'polypad-only', maxKeyDays: 1 },
  { key: 'new', label: 'New', minScore: 300, perPaymentUsd: 0.1, dailyUsd: 1, allowlist: 'polypad-only', maxKeyDays: 1 },
  { key: 'building', label: 'Building', minScore: 500, perPaymentUsd: 0.5, dailyUsd: 5, allowlist: 'approved', maxKeyDays: 7 },
  { key: 'standard', label: 'Standard', minScore: 600, perPaymentUsd: 2, dailyUsd: 25, allowlist: 'approved', maxKeyDays: 30 },
  { key: 'prime', label: 'Prime', minScore: 700, perPaymentUsd: 10, dailyUsd: 100, allowlist: 'any', maxKeyDays: 90 },
  { key: 'elite', label: 'Elite', minScore: 800, perPaymentUsd: 50, dailyUsd: 500, allowlist: 'any', maxKeyDays: 90 },
];

/** Band for a score (null = unregistered agent). */
export function bandForScore(score: number | null): GuardrailBand {
  if (score == null) return GUARDRAIL_BANDS[0];
  if (score >= 800) return GUARDRAIL_BANDS[5];
  if (score >= 700) return GUARDRAIL_BANDS[4];
  if (score >= 600) return GUARDRAIL_BANDS[3];
  if (score >= 500) return GUARDRAIL_BANDS[2];
  return GUARDRAIL_BANDS[1];
}

export interface X402Product {
  id: string;
  name: string;
  blurb: string;
  priceUsd: number;
  /** What the agent gets back, in plain language. */
  delivers: string;
  example: string;
}

export const X402_PRODUCTS: X402Product[] = [
  {
    id: 'token-report',
    name: 'Token report',
    blurb: 'Live on-chain facts for any token launched on Polypad.',
    priceUsd: 0.01,
    delivers: 'Price, market cap, volume, supply, curve progress, graduation state, creator, and launch details — read straight from Robinhood Chain.',
    example: 'GET /api/x402/products/token-report?address=0x3Da9…B4B',
  },
  {
    id: 'cto-report',
    name: 'CTO report',
    blurb: 'The full analyst report for a token — risk, momentum, holders, narrative.',
    priceUsd: 0.05,
    delivers: 'Summary, risk, utility, momentum, holder distribution, narrative, sentiment, and conclusion — the same report the token page shows.',
    example: 'GET /api/x402/products/cto-report?launch=0x2B0b…CA9',
  },
  {
    id: 'fund-nav',
    name: 'Tokenized Fund NAV snapshot',
    blurb: 'A fund\'s net asset value per share, right now.',
    priceUsd: 0.01,
    delivers: 'NAV per share and total NAV, shares sold, amount raised, strategy, and the manager with their Agent Credit Score — read straight from the chain.',
    example: 'GET /api/x402/products/fund-nav?fund=0x7c1d…85ef',
  },
];
