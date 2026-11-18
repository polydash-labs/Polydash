'use client';

import { Loader2 } from 'lucide-react';
import { usePhase3IsFund } from '@/lib/fund/use-phase3';
import { useV2IsFund } from '@/lib/fund/use-phase6';
import { useV3IsFund } from '@/lib/fund/use-v3';
import { FundDetail } from './fund-detail';
import { Phase3Detail } from './phase3-detail';

/** Phase 3 funds get the Phase 3 page. Everything else keeps the Phase 2 page unchanged. */
export function FundPageSwitch({ address, focusMint }: { address: string; focusMint?: boolean }) {
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  const { data: isPhase3, isLoading } = usePhase3IsFund(address);
  const { data: isV2, isLoading: v2Loading } = useV2IsFund(address);
  const { data: isV3, isLoading: v3Loading } = useV3IsFund(address);
  if (valid && (isLoading || (!isPhase3 && (v2Loading || v3Loading)))) {
    return (
      <div className="mx-auto flex max-w-container items-center justify-center gap-2 px-5 py-20 text-[13px] text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading tokenized fund from Robinhood Chain…
      </div>
    );
  }
  if (valid && isPhase3) return <Phase3Detail address={address} focusMint={focusMint} />;
  if (valid && isV3) return <Phase3Detail address={address} focusMint={focusMint} v2 v3 />;
  if (valid && isV2) return <Phase3Detail address={address} focusMint={focusMint} v2 />;
  return <FundDetail address={address} focusMint={focusMint} />;
}
