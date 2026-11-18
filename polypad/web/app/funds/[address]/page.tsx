import type { Metadata } from 'next';
import { FundPageSwitch } from './_components/fund-page-switch';

export const metadata: Metadata = {
  title: 'Tokenized Fund | Polypad',
  description: 'A tokenized fund on Robinhood Chain. Share price, shares sold and ETH raised are read live from the tokenized fund. Unaudited. Not financial advice.',
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
  return <FundPageSwitch address={address} focusMint={mint === 'skin'} />;
}
