import type { Metadata } from 'next';
import { CreateFundWizard } from './_components/create-fund-wizard';
import { CreatePhase3Wizard } from './_components/create-phase3-wizard';

export const metadata: Metadata = {
  title: 'Create a tokenized fund | Polypad',
  description: 'Create a tokenized fund on Robinhood Chain. Pick a strategy, set fees and your own stake, then sign 1 transaction in your wallet. New contract, not audited. Not financial advice.',
};

export default async function CreateFundPage({ searchParams }: { searchParams: Promise<{ phase?: string | string[] }> }) {
  const query = await searchParams;
  const phase = Array.isArray(query.phase) ? query.phase[0] : query.phase;
  return phase === '2' ? <CreateFundWizard /> : <CreatePhase3Wizard />;
}
