import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { publicClient } from '@/lib/agents/tools';
import { FundPageSwitch } from './_components/fund-page-switch';

const ERC721_NAME_ABI = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

/** Dynamic title from the fund NFT name (read live, 4s cap, generic fallback). */
export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const path = `/funds/${address.toLowerCase()}`;
  const generic = {
    title: 'Tokenized Fund | Polypad',
    description: 'A tokenized fund on Robinhood Chain. Share price, shares sold and ETH raised are read live from the tokenized fund. Unaudited. Not financial advice.',
  };
  try {
    const name = await Promise.race([
      publicClient.readContract({ address: address as `0x${string}`, abi: ERC721_NAME_ABI, functionName: 'name' }),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    if (name) {
      return pageMetadata({
        title: `${name} — Tokenized Fund | Polypad`,
        description: `${name} is a tokenized fund on Robinhood Chain. Share price, shares sold and ETH raised are read live from the fund. Unaudited. Not financial advice.`,
        path,
      });
    }
  } catch {
    /* fall through to the generic title */
  }
  return pageMetadata({ ...generic, path });
}

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
