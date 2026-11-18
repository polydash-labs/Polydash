import type { Metadata } from 'next';
import { FundsList } from './_components/funds-list';

export const metadata: Metadata = {
  title: 'Tokenized Funds | Polypad',
  description: 'Start your own on-chain fund on Polypad: raise from anyone, invest in public under a locked mandate, and prove it live on the terminal.',
};

export default function FundsPage() {
  return <FundsList />;
}
