'use client';

import { useSliceStatus } from '@/lib/hooks/use-slice';
import { fmtUTC, pctOf, sliceLive } from '@/lib/slice';

/** Neutral chip shown next to the Holder Protections badge. Not an HP criterion. Hidden while the feature is off. */
export function SliceChip({ token }: { token?: string | null }) {
  const live = sliceLive();
  const { data } = useSliceStatus();
  if (!live || !token || !data?.live) return null;
  const mine = (data.slices ?? []).filter((x: any) => x.token?.toLowerCase() === token.toLowerCase());
  const bps = mine.reduce((a: number, x: any) => a + (x.bps ?? 0), 0);
  if (!mine.length || bps < 25) return null;
  const end = Math.max(...mine.map((x: any) => x.start + x.duration));
  return (
    <span title={`${pctOf(bps).replace('%', '')}% of supply set aside for POLYDASH stakers, released until ${fmtUTC(end)}.`}
      className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[11px] font-medium text-white/75">
      Shares with POLYDASH stakers
    </span>
  );
}
