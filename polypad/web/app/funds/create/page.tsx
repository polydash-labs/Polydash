import type { Metadata } from 'next';
import { CreateFundWizard } from './_components/create-fund-wizard';

export const metadata: Metadata = {
  title: 'Create a fund | Polypad',
  description: 'Create a tokenized fund on Robinhood Chain. You set the mint price and the raise goal, then sign in your wallet. Unaudited. Not financial advice.',
};

export default function CreateFundPage() {
  return <CreateFundWizard />;
}
