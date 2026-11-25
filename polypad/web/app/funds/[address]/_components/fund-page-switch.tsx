'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useFundKind } from '@/lib/fund/use-phase3';
import { Button } from '@/components/ui/button';
import { FundDetail } from './fund-detail';
import { Phase3Detail } from './phase3-detail';

/** Phase 3 funds get the Phase 3 page. Everything else keeps the Phase 2 page unchanged. */
export function FundPageSwitch({ address, focusMint }: { address: string; focusMint?: boolean }) {
  // "Try again" remounts the load below (fresh chain reads, same fetch logic).
  const [attempt, setAttempt] = useState(0);
  return <SwitchInner key={attempt} address={address} focusMint={focusMint} onRetry={() => setAttempt((a) => a + 1)} />;
}

function SwitchInner({ address, focusMint, onRetry }: { address: string; focusMint?: boolean; onRetry: () => void }) {
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  // One server-side kind check (round 4): the three isFund checks used to
  // run from the browser, and when they all errored in the first-load storm
  // the switch fell through to the legacy page, which can never load a V3
  // fund — that was the Polyfund first-load failure. An errored kind check
  // now stays on this loading screen (with Try again) instead of falling
  // through; the kind never changes for an address, so a good answer is
  // cached forever.
  const kind = useFundKind(address);
  const loading = valid && (kind.isPending || kind.isError);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, [loading]);
  if (loading) {
    return (
      <div className="mx-auto flex max-w-container flex-col items-center justify-center gap-2 px-5 py-20 text-center text-[13px] text-white/50">
        <p className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading tokenized fund from Robinhood Chain…
        </p>
        {slow && (
          <>
            <p className="text-white/70">Still loading… the chain is slow to answer.</p>
            <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
          </>
        )}
      </div>
    );
  }
  if (valid && kind.data === 'phase3') return <Phase3Detail address={address} focusMint={focusMint} />;
  if (valid && kind.data === 'v3') return <Phase3Detail address={address} focusMint={focusMint} v2 v3 />;
  if (valid && kind.data === 'v2') return <Phase3Detail address={address} focusMint={focusMint} v2 />;
  return <FundDetail address={address} focusMint={focusMint} />;
}
