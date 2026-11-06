import type { Metadata } from 'next';
import { FundsList } from './_components/funds-list';

export const metadata: Metadata = {
  title: 'Funds | Polypad',
  description: 'Tokenized fund raises on Robinhood Chain. Each NFT is one equal unit. Unaudited. Not financial advice.',
};

export default function FundsPage() {
  return <FundsList />;
}
