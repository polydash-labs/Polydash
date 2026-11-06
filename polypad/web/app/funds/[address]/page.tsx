import type { Metadata } from 'next';
import { FundDetail } from './_components/fund-detail';

export const metadata: Metadata = {
  title: 'Fund | Polypad',
  description: 'Fund raise on Robinhood Chain. Mint price, supply, and ETH raised are read from the contracts. Unaudited. Not financial advice.',
};

export default async function FundPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ mint?: string | string[] }>;
}) {
  const { address } = await params;
  const query = await searchParams;
  const mint = Array.isArray(query.mint) ? query.mint[0] : query.mint;
  return <FundDetail address={address} focusMint={mint === 'skin'} />;
}
