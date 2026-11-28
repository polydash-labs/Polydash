import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { CreateFundWizard } from './_components/create-fund-wizard';
import { CreatePhase3Wizard } from './_components/create-phase3-wizard';

export const metadata: Metadata = pageMetadata({
  title: 'Create a tokenized fund | Polypad',
  description: 'Create a tokenized fund on Robinhood Chain. Pick a strategy, set fees and your own stake, then sign 1 transaction in your wallet. New contract, not audited. Not financial advice.',
  path: '/funds/create',
  noindex: true,
});

export default async function CreateFundPage({ searchParams }: { searchParams: Promise<{ phase?: string | string[] }> }) {
  const query = await searchParams;
  const phase = Array.isArray(query.phase) ? query.phase[0] : query.phase;
  const isPhase2 = phase === '2';
  return (
    <div className="mx-auto max-w-[720px] px-5 pt-8 sm:pt-12">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="Choose how to create your tokenized fund">
        <Link
          href="/funds/create"
          aria-current={isPhase2 ? undefined : 'true'}
          className={cn(
            'rounded-xl border p-4 text-left transition-colors',
            !isPhase2 ? 'border-white bg-white/[0.06]' : 'border-white/10 hover:border-white/30',
          )}
        >
          <p className="text-[14px] font-semibold text-white">I want to pick from ready-made strategies</p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/60">
            For most creators. Choose a published strategy with fixed rules — which tokens it may buy, fees and limits — then set your price and stake.
          </p>
          {!isPhase2 && <p className="mt-2 text-[11px] font-medium text-polydash-green">Selected</p>}
        </Link>
        <Link
          href="/funds/create?phase=2"
          aria-current={isPhase2 ? 'true' : undefined}
          className={cn(
            'rounded-xl border p-4 text-left transition-colors',
            isPhase2 ? 'border-white bg-white/[0.06]' : 'border-white/10 hover:border-white/30',
          )}
        >
          <p className="text-[14px] font-semibold text-white">I want to write my own rules</p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/60">
            For creators who want full control. You write the fund&apos;s rules yourself, pick the tokens it may buy, and set your own limits.
          </p>
          {isPhase2 && <p className="mt-2 text-[11px] font-medium text-polydash-green">Selected</p>}
        </Link>
      </div>
      {isPhase2 ? <CreateFundWizard /> : <CreatePhase3Wizard />}
    </div>
  );
}
