// Polypad x402 — Base (eip155:8453) / USDC settlement variant, routed
// through the CDP facilitator so the endpoints can be indexed by
// Coinbase's Bazaar (Agentic.Market) and HIVE402.
//
// Challenge selection: ?network=base on the product URL serves the
// Base-only challenge + Bazaar declaration. Anything else (including
// no param) serves the DEFAULT challenge: every Hood requirement PLUS
// the Base/USDC option (buildDefaultAccepts). Hood stays first — still
// the default for clients that take the first accept — and the Base
// option is genuinely payable (the CDP path already settled USDC on
// Base). Registries that only index supported networks (HIVE402: Base,
// Arc, XRPL, Xahau, Solana, MultiversX) need the Base option in the
// default challenge, not behind ?network=base — HIVE402 rejected the
// Hood-only default challenge on Nov 24 for exactly that reason.
//
// Payment routing is by the network the payer actually signed for
// (payload.accepted.network), not by the query param — same pattern as
// /api/x402/verify and /api/x402/settle — so a Base payment made
// against the default challenge verifies and settles through CDP.
//
// Activation: CDP_API_KEY_ID + CDP_API_KEY_SECRET env vars (from the CDP
// portal, portal.cdp.coinbase.com). Without them the variant is inert:
// the 402 is still served (the Bazaar declaration is static metadata),
// but verify/settle answer 503 'cdp_facilitator_not_configured' and
// nothing is ever charged. No key value is ever written into code or
// files. The first real $0.01 settlement through the CDP facilitator is
// what triggers Bazaar indexing.

import { HTTPFacilitatorClient } from '@x402/core/server';
import type {
  PaymentPayload as CorePaymentPayload,
  PaymentRequirements as CorePaymentRequirements,
} from '@x402/core/types';
import { generateJwt } from '@coinbase/cdp-sdk/auth';
import {
  declareDiscoveryExtension,
  type DeclareQueryDiscoveryExtensionConfig,
} from '@x402/extensions/bazaar';
import { getAddress, isAddress, type Hex, type PublicClient } from 'viem';
import {
  X402_VERSION,
  X402_BASE_NETWORK,
  USDC_BASE_ADDRESS,
  USDC_BASE_EIP712,
  X402_ICON_URL,
  X402_PAY_TO,
  X402_MAX_TIMEOUT_SECONDS,
  CDP_FACILITATOR_URL,
  type X402Product,
} from './constants';
import {
  guardrailCheck,
  recordDailySpend,
  type PaymentPayload,
  type PaymentRequirement,
  type SettleResult,
  type VerifyResult,
} from './facilitator';

/** True only for ?network=base. The Hood variant is the default. */
export function isBaseVariant(params: URLSearchParams): boolean {
  return params.get('network') === 'base';
}

/** Both CDP env vars present (values are never logged or stored). */
export function cdpConfigured(): boolean {
  return !!process.env.CDP_API_KEY_ID && !!process.env.CDP_API_KEY_SECRET;
}

// --- CDP facilitator client ----------------------------------------------

function cdpClient(): HTTPFacilitatorClient | null {
  const keyId = process.env.CDP_API_KEY_ID;
  const keySecret = process.env.CDP_API_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return new HTTPFacilitatorClient({
    url: CDP_FACILITATOR_URL,
    // Keep facilitator calls inside the route's 9s handler budget.
    timeoutMs: 7_000,
    createAuthHeaders: async () => {
      const make = async (path: string, method: string) => ({
        Authorization: `Bearer ${await generateJwt({
          apiKeyId: keyId,
          apiKeySecret: keySecret,
          requestMethod: method,
          requestHost: 'api.cdp.coinbase.com',
          requestPath: path,
          expiresIn: 120,
        })}`,
      });
      return {
        verify: await make('/platform/v2/x402/verify', 'POST'),
        settle: await make('/platform/v2/x402/settle', 'POST'),
        supported: await make('/platform/v2/x402/supported', 'GET'),
      };
    },
  });
}

// --- Base payment requirement --------------------------------------------

/** Single USDC-on-Base requirement for a product (same USD price as Hood). */
export function buildBaseRequirement(
  resourceUrl: string,
  description: string,
  priceUsd: number,
): PaymentRequirement {
  const amount = BigInt(Math.round(priceUsd * 1e6)); // USDC, 6 dp
  return {
    scheme: 'exact',
    network: X402_BASE_NETWORK,
    amount: amount.toString(),
    asset: USDC_BASE_ADDRESS,
    payTo: X402_PAY_TO,
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    resource: { url: resourceUrl, description, mimeType: 'application/json' },
    description,
    mimeType: 'application/json',
    extra: { assetTransferMethod: 'eip3009', name: USDC_BASE_EIP712.name, version: USDC_BASE_EIP712.version },
  };
}

/**
 * The default 402 challenge's accepts list: every Hood requirement the
 * facilitator offers, in order, plus the USDC-on-Base option last. Hood
 * stays first (still the default for clients that take the first
 * accept); the Base option is what registries that only index supported
 * networks need to see. Prices are unchanged — the Base option is the
 * same USD price in USDC, not the cross-chain Relay quote (that is a
 * separate flow, advertised in the catalog's crossChain block).
 */
export function buildDefaultAccepts(
  hoodAccepts: PaymentRequirement[],
  resourceUrl: string,
  description: string,
  priceUsd: number,
): PaymentRequirement[] {
  return [...hoodAccepts, buildBaseRequirement(resourceUrl, description, priceUsd)];
}

// --- Bazaar discovery declaration ------------------------------------------

/**
 * Example query values + JSON schema per product, for the Bazaar
 * declaration. Examples are real, public, callable values: the POLYDASH
 * token, a real launch, and the live Polyfund — so the catalog probe and
 * agents calling the listed URL get a useful public result.
 */
const BAZAAR_INPUTS: Record<
  string,
  { input: Record<string, string>; inputSchema: Record<string, unknown>; outputExample: Record<string, unknown> }
> = {
  'token-report': {
    input: { network: 'base', address: '0x319525528f42167eF7fC18b77b889958080568e4' },
    inputSchema: {
      type: 'object',
      properties: {
        network: { type: 'string', description: 'Set to "base" for USDC on Base settlement.', enum: ['base'] },
        address: { type: 'string', description: 'Token or launch contract address on Robinhood Chain.', examples: ['0x319525528f42167eF7fC18b77b889958080568e4'] },
      },
      required: ['address'],
    },
    outputExample: { product: 'token-report', symbol: 'POLYDASH', chainId: 4663 },
  },
  'cto-report': {
    input: { network: 'base', launch: '0x2B0b4151cA57546BD968718b1ba256b288e51CA9' },
    inputSchema: {
      type: 'object',
      properties: {
        network: { type: 'string', description: 'Set to "base" for USDC on Base settlement.', enum: ['base'] },
        launch: { type: 'string', description: 'Launch contract address on Robinhood Chain.', examples: ['0x2B0b4151cA57546BD968718b1ba256b288e51CA9'] },
      },
      required: ['launch'],
    },
    outputExample: { product: 'cto-report', launchAddress: '0x2B0b4151cA57546BD968718b1ba256b288e51CA9' },
  },
  'fund-nav': {
    input: { network: 'base', fund: '0x7c1d31629ac68aebe83f230edbc7eacfc26285ef' },
    inputSchema: {
      type: 'object',
      properties: {
        network: { type: 'string', description: 'Set to "base" for USDC on Base settlement.', enum: ['base'] },
        fund: { type: 'string', description: 'Tokenized Fund NFT contract address on Robinhood Chain.', examples: ['0x7c1d31629ac68aebe83f230edbc7eacfc26285ef'] },
      },
      required: ['fund'],
    },
    outputExample: { product: 'fund-nav', fundAddress: '0x7c1d31629ac68aebe83f230edbc7eacfc26285ef' },
  },
};

/**
 * The Bazaar discovery extension for a product, shared by the Base and
 * the default challenges so both declare the same entry: one entry per
 * product (name, description, tags, input schema + real example values).
 * Built by the official @x402/extensions package — schema-valid by
 * construction (see base.test.ts for the local validation check).
 */
export function bazaarExtensionFor(product: X402Product) {
  const declared = BAZAAR_INPUTS[product.id];
  const config: DeclareQueryDiscoveryExtensionConfig = {
    method: 'GET',
    input: declared.input,
    inputSchema: declared.inputSchema,
    output: { example: declared.outputExample },
  };
  return declareDiscoveryExtension(config);
}

/** Top-level resource metadata for a product's 402, shared by both challenges. */
function resourceMetaFor(product: X402Product, resourceUrl: string) {
  return {
    url: resourceUrl,
    description: product.blurb,
    mimeType: 'application/json',
    serviceName: 'Polypad',
    tags: product.tags,
    iconUrl: X402_ICON_URL,
  };
}

/**
 * Full 402 body for the Base variant: the USDC requirement plus the
 * top-level resource metadata and the Bazaar discovery extension.
 */
export function buildBasePaymentRequired(product: X402Product, resourceUrl: string) {
  return {
    x402Version: X402_VERSION,
    resource: resourceMetaFor(product, resourceUrl),
    accepts: [buildBaseRequirement(resourceUrl, product.blurb, product.priceUsd)],
    extensions: bazaarExtensionFor(product),
  };
}

/**
 * Full 402 body for the DEFAULT challenge: every Hood requirement plus
 * the USDC-on-Base option (buildDefaultAccepts), AND the same Bazaar
 * discovery extension + resource metadata the Base variant carries.
 *
 * Why the default challenge needs it too: the default URL is the one
 * agents and registries hit first, and a Bazaar-aware client can only
 * echo an extension the 402 actually declared. The Nov 22 Base
 * settlements apparently never echoed one — the default challenge
 * carried no extension at all — so nothing was indexed even though the
 * payments settled through CDP. Hood accepts are untouched: same order,
 * same prices, same requirements; only the top-level metadata is new.
 */
export function buildDefaultPaymentRequired(
  product: X402Product,
  resourceUrl: string,
  accepts: PaymentRequirement[],
) {
  return {
    x402Version: X402_VERSION,
    resource: resourceMetaFor(product, resourceUrl),
    accepts,
    extensions: bazaarExtensionFor(product),
  };
}

// --- CDP verify / settle ---------------------------------------------------

export interface BaseVerifyResult extends VerifyResult {
  /** Facilitator extension responses (e.g. bazaar: { status }). */
  extensionResponses?: Record<string, unknown>;
}

function checkBaseRequirement(req: PaymentRequirement): string | null {
  if (req.scheme !== 'exact' || req.network !== X402_BASE_NETWORK) return 'unsupported_scheme_or_network';
  if (!isAddress(req.payTo) || getAddress(req.payTo) !== getAddress(X402_PAY_TO)) return 'recipient_mismatch';
  if (!isAddress(req.asset) || getAddress(req.asset) !== getAddress(USDC_BASE_ADDRESS)) return 'asset_mismatch';
  try {
    if (BigInt(req.amount) <= 0n) return 'amount_mismatch';
  } catch {
    return 'amount_mismatch';
  }
  return null;
}

/** Strip Polypad's per-accept metadata down to the core facilitator shape. */
function toCoreRequirement(req: PaymentRequirement): CorePaymentRequirements {
  return {
    scheme: req.scheme,
    // Core types the CAIP-2 network as `${string}:${string}`; our
    // requirements are always a valid CAIP-2 id (checked in
    // checkBaseRequirement before this is called).
    network: req.network as CorePaymentRequirements['network'],
    asset: req.asset,
    amount: req.amount,
    payTo: req.payTo,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
    extra: req.extra,
  };
}

/**
 * Verify a Base payment through the CDP facilitator, then apply
 * Polypad's own spend guardrails (same caps as Hood; USDC is 6 dp at
 * $1, so the amount is already the USD value). The payment payload is
 * forwarded verbatim — including any `extensions` the buyer's client
 * echoed from the 402 — which is what lets the facilitator index the
 * Bazaar declaration.
 */
export async function verifyBasePayment(
  client: PublicClient,
  payload: PaymentPayload,
  requirement: PaymentRequirement,
): Promise<BaseVerifyResult> {
  const bad = checkBaseRequirement(requirement);
  if (bad) return { isValid: false, invalidReason: bad };
  if (payload.accepted.network !== X402_BASE_NETWORK) {
    return { isValid: false, invalidReason: 'unsupported_scheme_or_network' };
  }
  const cdp = cdpClient();
  if (!cdp) return { isValid: false, invalidReason: 'cdp_facilitator_not_configured' };
  try {
    const res = await cdp.verify(
      payload as unknown as CorePaymentPayload,
      toCoreRequirement(requirement),
    );
    if (!res.isValid) {
      return { isValid: false, invalidReason: res.invalidReason ?? 'invalid_payment', extensionResponses: res.extensionResponses };
    }
    if (!res.payer) {
      return { isValid: false, invalidReason: 'invalid_payment', extensionResponses: res.extensionResponses };
    }
    const guard = await guardrailCheck(client, res.payer, BigInt(requirement.amount));
    if (!guard.ok) {
      return { isValid: false, invalidReason: guard.reason, payer: res.payer, extensionResponses: res.extensionResponses };
    }
    return { isValid: true, payer: getAddress(res.payer), extensionResponses: res.extensionResponses };
  } catch (e: any) {
    return { isValid: false, invalidReason: `verification_failed:${e?.shortMessage ?? e?.message ?? 'unknown'}` };
  }
}

/** Settle a verified Base payment through the CDP facilitator. */
export async function settleBasePayment(
  payload: PaymentPayload,
  requirement: PaymentRequirement,
  verify: VerifyResult,
): Promise<SettleResult> {
  if (!verify.isValid || !verify.payer) {
    return { success: false, errorReason: verify.invalidReason ?? 'invalid_payment' };
  }
  const bad = checkBaseRequirement(requirement);
  if (bad) return { success: false, errorReason: bad };
  const cdp = cdpClient();
  if (!cdp) return { success: false, errorReason: 'cdp_facilitator_not_configured' };
  try {
    const res = await cdp.settle(
      payload as unknown as CorePaymentPayload,
      toCoreRequirement(requirement),
    );
    if (!res.success) {
      return { success: false, errorReason: res.errorReason ?? 'settlement_failed', payer: verify.payer };
    }
    recordDailySpend(verify.payer, BigInt(requirement.amount));
    return {
      success: true,
      transaction: res.transaction ? (res.transaction as Hex) : undefined,
      network: X402_BASE_NETWORK,
      payer: verify.payer,
    };
  } catch (e: any) {
    return { success: false, errorReason: `settlement_failed:${e?.shortMessage ?? e?.message ?? 'unknown'}` };
  }
}
