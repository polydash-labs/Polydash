'use client';

import { useQuery } from '@tanstack/react-query';
import type { PromiseSummary } from '@/lib/promises/presets';
import { cn } from '@/lib/utils';

/** One shared request for every badge on the page (cached DB counts, no RPC). */
export function usePromiseCounts() {
  return useQuery<Record<string, PromiseSummary>>({
    queryKey: ['promise-counts'],
    queryFn: async () => {
      const res = await fetch('/api/promises/counts');
      const data = await res.json().catch(() => ({}));
      return (data?.counts ?? {}) as Record<string, PromiseSummary>;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function PromiseBadge({ launch, className }: { launch: string; className?: string }) {
  const { data } = usePromiseCounts();
  const s = data?.[launch.toLowerCase()];
  if (!s || s.total === 0) return null;
  if (s.broken > 0) {
    return <span className={cn('inline-flex shrink-0 items-center rounded-full bg-[#FF5252]/15 px-2 py-0.5 text-[11px] font-medium text-[#FF8A80]', className)}>{s.broken} broken</span>;
  }
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] font-medium text-white/75', className)}>
      {s.total} {s.total === 1 ? 'promise' : 'promises'} · {s.kept} kept
    </span>
  );
}
