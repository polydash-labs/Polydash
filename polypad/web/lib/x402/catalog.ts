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
    protocol: 'x402',
    x402Version: X402_VERSION,
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
        // the Bazaar-echo test payments settled. Agentic.market's own
        // search was still total 0 right after indexing — its catalog
        // refreshes on its own schedule.
        coinbaseBazaar:
          'indexed — 3 resources in the CDP Bazaar as of 2026-11-24 (token-report, fund-nav, cto-report; CDP discovery for this payTo returns total 3)',
        hive402: 'not listed yet — submission prepared, see the /apply seller flow',
      },
    },
    generatedAt: new Date().toISOString(),
  };
}

export type X402Catalog = ReturnType<typeof buildX402Catalog>;
