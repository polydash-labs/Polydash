// Polypad x402 priced products — resource builders (server-only).
// All builders are Neon-free in the data path except the CTO report, which
// reuses the existing CTO builder (Neon-backed): when Neon is unreachable
// the CTO product answers 503 and the facilitator never settles, so the
// agent is not charged for a report that could not be built.

import { getLaunchSnapshot } from '@/lib/launches-server';
import { ensureCto, getCachedReport, snapshotFor } from '@/lib/cto/chain';
import { defaultCtx } from '@/lib/agents-api/v2/core';
import { findFund } from '@/lib/agents-api/v2/funds';
import { getEthUsd } from '@/lib/eth-price';
import { X402_PRODUCTS } from './constants';

export type ProductBuild = { data: unknown } | { error: string; status: number };

function timeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

async function buildTokenReport(address: string): Promise<ProductBuild> {
  const token = await timeout(getLaunchSnapshot(address, 3_000), 5_000, 'token lookup');
  if (!token) return { error: 'Token not found.', status: 404 };
  return {
    data: {
      product: 'token-report',
      tokenAddress: token.tokenAddress,
      launchAddress: token.launchAddress,
      name: token.name,
      symbol: token.symbol,
      creator: token.creator,
      description: token.description,
      imageUri: token.imageUri,
      phase: token.phase,
      graduated: token.graduated,
      curveProgress: token.curveProgress,
      priceEth: token.priceEth,
      marketCapUsd: token.marketCapUsd,
      volumeUsd: token.volumeUsd,
      ethRaised: token.ethRaised,
      totalSupply: token.totalSupply,
      createdAt: token.createdAt,
      chain: 'Robinhood Chain',
      chainId: 4663,
    },
  };
}

async function buildCtoReport(launch: string): Promise<ProductBuild> {
  let row: Awaited<ReturnType<typeof ensureCto>>;
  try {
    row = await timeout(ensureCto(launch), 6_000, 'cto lookup');
  } catch {
    return { error: 'The CTO report is taking too long to build right now. Please try again shortly.', status: 503 };
  }
  if (!row) return { error: 'Launch not found.', status: 404 };
  const { report } = await getCachedReport(row, 0).catch(() => ({ report: null, refreshing: false }));
  if (!report) {
    return { error: 'The CTO report is not available right now. Please try again shortly.', status: 503 };
  }
  const snapshots = await snapshotFor(row, report).catch(() => null);
  return { data: { product: 'cto-report', launchAddress: row.launchAddress, report, snapshots } };
}

async function buildFundNav(fund: string): Promise<ProductBuild> {
  let found: Awaited<ReturnType<typeof findFund>>;
  try {
    found = await timeout(findFund(defaultCtx(), fund), 6_000, 'fund lookup');
  } catch {
    return { error: 'The fund could not be read right now. Please try again shortly.', status: 503 };
  }
  if (!found) return { error: 'Tokenized Fund not found.', status: 404 };
  const ethUsd = await getEthUsd();
  const navWei = found.navPerNftWei;
  return {
    data: {
      product: 'fund-nav',
      fundAddress: found.address,
      name: found.name,
      symbol: found.symbol,
      manager: found.manager,
      strategyId: found.templateId,
      factory: found.factoryLabel,
      mintPriceWei: found.mintPrice?.toString() ?? null,
      maxSupply: found.maxSupply,
      totalMinted: found.totalMinted,
      navPerShareWei: navWei?.toString() ?? null,
      navPerShareEth: navWei != null ? Number(navWei) / 1e18 : null,
      navPerShareUsd: navWei != null && ethUsd > 0 ? (Number(navWei) / 1e18) * ethUsd : null,
      chain: 'Robinhood Chain',
      chainId: 4663,
    },
  };
}

export function productById(id: string) {
  return X402_PRODUCTS.find((p) => p.id === id) ?? null;
}

export async function buildProduct(
  id: string,
  params: URLSearchParams,
): Promise<ProductBuild> {
  if (id === 'token-report') {
    const address = params.get('address') ?? '';
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { error: 'Provide ?address=0x… (token or launch address).', status: 400 };
    return buildTokenReport(address);
  }
  if (id === 'cto-report') {
    const launch = params.get('launch') ?? '';
    if (!/^0x[0-9a-fA-F]{40}$/.test(launch)) return { error: 'Provide ?launch=0x… (launch contract address).', status: 400 };
    return buildCtoReport(launch);
  }
  if (id === 'fund-nav') {
    const fund = params.get('fund') ?? '';
    if (!/^0x[0-9a-fA-F]{40}$/.test(fund)) return { error: 'Provide ?fund=0x… (fund NFT address).', status: 400 };
    return buildFundNav(fund);
  }
  return { error: 'Unknown product.', status: 404 };
}
