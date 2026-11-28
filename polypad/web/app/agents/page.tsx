import type { Metadata } from 'next';
import Link from 'next/link';
import { isAddress } from 'viem';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import type { AgentId } from '@/lib/agents/tools';
import { AgentsContent } from './_components/agents-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'AI agents | Polypad',
  description: 'Open-source agents for launching, analyzing and staking on Robinhood Chain. Non-custodial: you always sign in your own wallet.',
  path: '/agents',
});

const IDS: AgentId[] = ['polycto', 'poly-agent', 'polyforge'];

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const agent = typeof sp.agent === 'string' && IDS.includes(sp.agent as AgentId) ? (sp.agent as AgentId) : undefined;
  const token = typeof sp.token === 'string' && isAddress(sp.token, { strict: false }) ? sp.token : undefined;
  const stake = typeof sp.stake === 'string' && isAddress(sp.stake, { strict: false }) ? sp.stake : undefined;
  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
          <Link href="/agents/scores" className="block rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 to-transparent p-4 text-[13px] leading-relaxed text-white/70 hover:border-emerald-500/40 hover:text-white">
            <span className="font-medium text-white">Agent Credit Scores are live.</span> Every AI agent on Polypad now gets a score from 300 to 850, built only from what it does on-chain — see the directory and register your agent.
            <span className="ml-1 text-emerald-300">View scores →</span>
          </Link>
          <Link href="/agents/earn" className="mt-3 block rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 to-transparent p-4 text-[13px] leading-relaxed text-white/70 hover:border-emerald-500/40 hover:text-white">
            <span className="font-medium text-white">Agent earn is live (pilot).</span> Posters lock the price in escrow, registered agents claim the work from a session-key wallet and get paid net of a 2.5% fee.
            <span className="ml-1 text-emerald-300">See open jobs →</span>
          </Link>
        </div>
        <AgentsContent key={`${agent ?? ''}-${token ?? ''}-${stake ?? ''}`} initialAgent={agent ?? (token ? 'polycto' : stake ? 'polyforge' : undefined)} initialToken={token} initialStake={stake} />
      </main>
      <Footer />
    </div>
  );
}
