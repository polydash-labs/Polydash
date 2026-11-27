// Polypad x402 catalog — the machine-readable list of Polypad's paid
// x402 endpoints, for registries (HIVE402, Coinbase Bazaar) and any agent
// that wants to find and pay for a report without reading the website.
// Thin exposure of existing data: prices come from X402_PRODUCTS in
// ./constants, settlement chains from the facilitator's /supported kinds.
// No new endpoints, no contract changes — distribution for what exists.
//
// Cross-chain pricing, stated honestly: paying USDC on Base for a report
// that settles in USDG on Robinhood Chain goes through Relay, and Relay
// charges roughly a $0.02 flat relayer fee at these sizes — so a $0.01
// report costs about $0.03 all-in cross-chain, never $0.01 all-in.
// (lib/x402/cross-chain.ts; verified against the Nov 22 demo.)

import {
  X402_PRODUCTS,
  X402_VERSION,
  X402_NETWORK,
  X402_BASE_NETWORK,
  X402_CHAIN_ID,
  X402_BASE_CHAIN_ID,
  X402_PAY_TO,
  X402_SUPPORTED_KINDS,
  USDG_ADDRESS,
  POLYDASH_ADDRESS,
  USDC_BASE_ADDRESS,
  CDP_FACILITATOR_URL,
} from './constants';

const SITE = 'https://polypad.family';

/** Canonical example query for each product (params from the live routes). */
const EXAMPLE_QUERY: Record<string, string> = {
  'token-report': 'address=0x319525528f42167eF7fC18b77b889958080568e4',
  'fund-nav': 'fund=0x7c1d31629ac68aebe83f230edbc7eacfc26285ef',
  'cto-report': 'launch=0x2B0b4151cA57546BD968718b1ba256b288e51CA9',
};

export interface X402CatalogEndpoint {
  id: string;
  name: string;
  description: string;
  url: string;
  priceUsd: number;
  accepts: {
    network: string;
    chainId: number;
    asset: string;
    symbol: string;
    amountRaw: string;
  }[];
  tags: string[];
}

export function buildX402Catalog() {
  const endpoints: X402CatalogEndpoint[] = X402_PRODUCTS.map((p) => {
    const raw = String(Math.round(p.priceUsd * 1e6)); // 6-decimal stables
    return {
      id: p.id,
      name: p.name,
      description: p.blurb,
      url: `${SITE}/api/x402/products/${p.id}?${EXAMPLE_QUERY[p.id] ?? ''}`,
      priceUsd: p.priceUsd,
      accepts: [
        {
          network: X402_NETWORK,
          chainId: X402_CHAIN_ID,
          asset: USDG_ADDRESS,
          symbol: 'USDG',
          amountRaw: raw,
        },
        {
          network: X402_NETWORK,
          chainId: X402_CHAIN_ID,
          asset: POLYDASH_ADDRESS,
          symbol: 'POLYDASH',
          amountRaw: 'live-rate',
        },
        {
          network: X402_BASE_NETWORK,
          chainId: X402_BASE_CHAIN_ID,
          asset: USDC_BASE_ADDRESS,
          symbol: 'USDC',
          amountRaw: raw,
        },
      ],
      tags: p.tags,
    };
  });

  return {
    // --- IETF draft-hawkins-x402-dns-discovery-03 (Aug 2026) manifest ---
    // Served at /.well-known/x402 (and /api/x402/catalog). Polypad is
    // BOTH a facilitator (its own /supported + /verify + /settle for
    // Hood USDG / POLYDASH) and a resource server (the 3 paid products),
    // so kind is "both". The facilitator.kinds mirror the live
    // /supported endpoint exactly — same constant, so they cannot drift.
    x402Version: X402_VERSION,
    kind: 'both',
    name: 'Polypad',
    description:
      'The premiere agentic marketplace — paid reports on Robinhood Chain and Base, settled over x402. No account, no subscription.',
    facilitator: {
      baseUrl: `${SITE}/api/x402`,
      endpoints: { supported: '/supported', verify: '/verify', settle: '/settle' },
      kinds: X402_SUPPORTED_KINDS,
      assets: [
        { network: X402_NETWORK, address: USDG_ADDRESS, symbol: 'USDG', decimals: 6, standard: 'EIP-3009' },
        { network: X402_NETWORK, address: POLYDASH_ADDRESS, symbol: 'POLYDASH', decimals: 18, standard: 'EIP-2612' },
        { network: X402_BASE_NETWORK, address: USDC_BASE_ADDRESS, symbol: 'USDC', decimals: 6, standard: 'EIP-3009' },
      ],
    },
    resources: endpoints.map((e) => ({
      url: e.url,
      method: 'GET',
      description: e.description,
      priceUsd: e.priceUsd,
      accepts: e.accepts,
    })),
    attestation: { type: 'none' },
    docs: `${SITE}/x402`,
    contact: 'jon@dasheco.xyz',
    updated: new Date().toISOString(),
    // --- Polypad's own catalog detail (extra fields; the draft says
    // unknown fields MUST be ignored, so spec consumers are unaffected) ---
    protocol: 'x402',
    seller: {
      name: 'Polypad',
      operator: 'Polydash',
      site: SITE,
      payTo: X402_PAY_TO,
    },
    endpoints,
    settlement: {
      chains: [
        { network: X402_NETWORK, chainId: X402_CHAIN_ID, assets: ['USDG', 'POLYDASH'] },
        { network: X402_BASE_NETWORK, chainId: X402_BASE_CHAIN_ID, assets: ['USDC'] },
      ],
      facilitator: {
        hood: `${SITE}/api/x402/supported`,
        base: CDP_FACILITATOR_URL,
      },
    },
    crossChain: {
      description:
        'Pay USDC on Base for a report that settles in USDG on Robinhood Chain, bridged by Relay. No need to hold USDG or bridge first.',
      payAsset: { network: X402_BASE_NETWORK, chainId: X402_BASE_CHAIN_ID, asset: USDC_BASE_ADDRESS, symbol: 'USDC' },
      settleAsset: { network: X402_NETWORK, chainId: X402_CHAIN_ID, asset: USDG_ADDRESS, symbol: 'USDG' },
      bridge: 'Relay (api.relay.link)',
      // Relay's relayer fee is ~$0.02 flat at these sizes (lib/x402/cross-chain.ts).
      relayFeeUsdApprox: 0.02,
      allInUsdApprox: {
        'token-report': 0.03,
        'fund-nav': 0.03,
        'cto-report': 0.07,
      },
      note: 'All-in is the report price plus about $0.02 in Relay bridge fees — a $0.01 report costs about $0.03 all-in cross-chain, never $0.01. Get the exact quote before paying: POST /api/x402/cross-chain/quote.',
      quoteEndpoint: `${SITE}/api/x402/cross-chain/quote`,
    },
    discovery: {
      catalog: `${SITE}/api/x402/catalog`,
      wellKnown: `${SITE}/.well-known/x402`,
      supported: `${SITE}/api/x402/supported`,
      humanPage: `${SITE}/x402`,
      listings: {
        // Indexed live Nov 24, 2026 ~10:38 PST: CDP discovery returns
        // total 3 for our payTo (token-report, fund-nav, cto-report) after
        // the Bazaar-echo test payments settled. Re-verified Nov 25:
        // CDP discovery still total 3, and agentic.market search for
        // "polypad" returns service polypad-family with all 3 endpoints
        // (30-day calls: token-report 3, fund-nav 2, cto-report 2;
        // 1 unique payer each). Re-verified Nov 26: the CDP discovery
        // API no longer accepts a payTo/resource/q filter (it returns
        // 88,971 resources unfiltered), so the direct count check cannot
        // run — but the live 402 responses still carry the Bazaar
        // extension (the indexing mechanism), and HIVE402, which
        // aggregates the CDP Bazaar, lists all 3 as verified payable.
        coinbaseBazaar:
          'indexed — 3 resources in the CDP Bazaar as of 2026-11-25 (token-report, fund-nav, cto-report; CDP discovery for this payTo returns total 3; agentic.market search returns service polypad-family). Re-verified Nov 26: the CDP discovery API ignores payTo filters (88,971 resources, unfiltered), so the count check cannot run directly; the live 402 responses still carry the Bazaar extension and HIVE402 (which aggregates the CDP Bazaar) lists all 3 as verified payable.',
        // Listed + verified payable Nov 24, 2026: HIVE402 accepted the
        // resubmission (deploy polypad-osq0stf7g added the Base USDC
        // option to the default challenge). Re-verified Nov 25 via
        // https://hive402.scriptmasterlabs.com/api/public/catalog?q=polypad:
        // 3 self-listed entries (token-report, fund-nav, cto-report),
        // all verified: true via live-probe, payable: true, Base USDC.
        // Re-verified Nov 26 via the same API: 6 entries — 3 direct
        // (Hood USDG, facilitator cdp, no fee) + 3 OMNIGATE (Base USDC,
        // 0.005 USDC facilitator fee to 0x5BBd…6328b2, default) — all
        // verified: true, payable: true, payTo correct.
        // NOTE: HIVE402's catalog shows those 3 entries with
        // settlementRoute "omnigate" and a 0.005 USDC facilitator fee
        // attached by default (to 0x5BBd…6328b2) — that is HIVE402's
        // catalog representation, not our 402 challenge, which settles
        // direct to our payTo at 0% take. Whether to keep or opt out of
        // the OMNIGATE route is Jon's call.
        hive402:
          'listed — 3 endpoints verified payable on HIVE402 as of 2026-11-24 (token-report, fund-nav, cto-report; live-probe verified, Base USDC). Re-verified Nov 26: 6 entries — 3 direct (Hood USDG, no fee) + 3 OMNIGATE (Base USDC, 0.005 USDC facilitator fee to 0x5BBd…6328b2, default) — all verified: true, payable: true, payTo correct. HIVE402 shows them on its OMNIGATE route with a 0.005 USDC facilitator fee attached by default; our own 402 challenge still settles direct to our payTo at 0% take.',
      },
    },
  };
}

export type X402Catalog = ReturnType<typeof buildX402Catalog>;
