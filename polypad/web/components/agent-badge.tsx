'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';

type Item = { launch: string; token: string };

/** Set of lowercase launch and token addresses registered as agent-launched. */
export function useAgentLaunched() {
  const q = useQuery({
    queryKey: ['agent-launched'],
    queryFn: async (): Promise<Set<string>> => {
      const res = await fetch('/api/agents/v1/launched');
      if (!res.ok) throw new Error(`agent-launched ${res.status}`);
      const { items } = (await res.json()) as { items: Item[] };
      const s = new Set<string>();
      for (const i of items) { s.add(i.launch.toLowerCase()); s.add(i.token.toLowerCase()); }
      return s;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  return { set: q.data ?? new Set<string>(), ready: q.isSuccess };
}

export function isAgentLaunched(set: Set<string>, launch?: string, token?: string) {
  return (!!launch && set.has(launch.toLowerCase())) || (!!token && set.has(token.toLowerCase()));
}

export function AgentBadge({ launch, token, size = 'sm' }: { launch?: string; token?: string; size?: 'sm' | 'md' }) {
  const { set } = useAgentLaunched();
  if (!isAgentLaunched(set, launch, token)) return null;
  return (
    <span
      title="Launched through the Polypad agent API by an outside agent"
      className={`inline-flex items-center gap-1 rounded-full bg-white/[0.07] font-medium text-white/75 ${size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'}`}
    >
      <Bot className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} strokeWidth={1.75} aria-hidden />
      Agent-launched
    </span>
  );
}
