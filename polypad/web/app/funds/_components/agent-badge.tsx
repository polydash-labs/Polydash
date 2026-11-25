'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { Bot, User } from 'lucide-react';
import { AgentRegistryABI, getAgentRegistryAddress } from '@/lib/fund/agent';
import { robinhoodChain } from '@/lib/chain';
import { cn } from '@/lib/utils';

/**
 * "Managed by a human" / "Managed by an AI agent" badge for a fund.
 * Reads agentOfFund from the registry. When the registry is not configured
 * yet, nothing is shown — the badge must not claim a human manages a fund
 * whose agent record cannot be read.
 */
export function AgentBadge({ fund, link = true }: { fund: string; link?: boolean }) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const registry = getAgentRegistryAddress();
  const valid = /^0x[0-9a-fA-F]{40}$/.test(fund);
  const { data: agentId } = useQuery({
    queryKey: ['agent-of-fund', registry ?? '', fund.toLowerCase()],
    enabled: !!client && !!registry && valid,
    queryFn: async () => {
      if (!client || !registry) return 0n;
      return client.readContract({
        address: registry,
        abi: AgentRegistryABI,
        functionName: 'agentOfFund',
        args: [fund as `0x${string}`],
      });
    },
  });

  if (!registry || agentId === undefined) return null;
  const isAgent = agentId > 0n;
  const inner = (
    <>
      {isAgent ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
      {isAgent ? 'Managed by an AI agent' : 'Managed by a human'}
    </>
  );
  const classes = cn(
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
    isAgent ? 'bg-violet-400/10 text-violet-200' : 'bg-white/10 text-white/60',
  );
  if (isAgent && link) {
    return (
      <Link href={`/funds/${fund}#agent`} className={classes}>
        {inner}
      </Link>
    );
  }
  return <span className={classes}>{inner}</span>;
}
