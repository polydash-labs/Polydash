'use client';

import Link from 'next/link';
import { bandForScore, useAgentScoreByWallet, REGISTRY_ADDRESS, SCORE_ADDRESS } from '@/lib/agents/credit-score';
import { cn } from '@/lib/utils';

/** The fund manager's Agent Credit Score. Shows the unregistered state cleanly — never errors. */
export function AgentScoreBadge({ address }: { address: string }) {
  const { data, isLoading } = useAgentScoreByWallet(address);
  if (!REGISTRY_ADDRESS || !SCORE_ADDRESS) return null;
  if (isLoading) {
    return <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/40">Checking agent score…</span>;
  }
  if (!data?.registered) {
    return (
      <Link href="/agents/scores" className="rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/50 hover:text-white" title="This manager has not registered as an agent. See how agent scores work.">
        Not a registered agent
      </Link>
    );
  }
  if (!data.scored || data.score == null) {
    return (
      <Link href="/agents/scores" className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/70 hover:text-white" title="Registered as an agent. The first score is posted within a day of registering.">
        Registered agent · score coming soon
      </Link>
    );
  }
  const band = bandForScore(data.score);
  return (
    <Link href="/agents/scores" className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium hover:opacity-80', band.chip)} title={`Agent Credit Score ${data.score} — ${band.label} (${band.range}). Scores run 300–850 and come from on-chain behavior.`}>
      Agent score {data.score} · {band.label}
    </Link>
  );
}
