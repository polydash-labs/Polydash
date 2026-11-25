import Link from 'next/link';
import { getX402Volume } from '@/lib/x402/volume';

/**
 * Settle-volume counter for /x402 — server-rendered, read live from the
 * chains at request time. Degrades to a quiet note if the RPC reads fail;
 * the page must never break over a counter.
 */
export async function SettleVolume() {
  let volume: Awaited<ReturnType<typeof getX402Volume>> | null = null;
  try {
    volume = await getX402Volume();
  } catch {
    volume = null;
  }

  if (!volume || volume.allTimeUsd == null) {
    return (
      <div className="mt-4 max-w-[640px] rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-[15px] font-semibold text-white">Settled so far</p>
        <p className="mt-1 text-[13px] leading-relaxed text-white/55">
          Settlement totals are not available right now — the chain read failed. Try again shortly.
        </p>
      </div>
    );
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`;
  return (
    <div className="mt-4 max-w-[640px] rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-[15px] font-semibold text-white">Settled so far</p>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-white">
        {fmt(volume.allTimeUsd)}
        <span className="ml-2 text-[13px] font-normal text-white/50">paid for reports, all time</span>
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-white/70">
        <span className="font-semibold text-white">{fmt(volume.weekUsd ?? 0)} this week.</span>{' '}
        Every payment settled so far landed Nov 22–23, inside the last 7 days — so this week&apos;s
        total is the all-time total for now. {volume.note}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-white/55">
        {volume.chains.map((c) => (
          <p key={c.network}>
            <span className="text-white/70">{c.symbol}</span>{' '}
            {c.settledUsd != null ? fmt(c.settledUsd) : '—'}{' '}
            <span className="text-white/40">· {c.chainId === 8453 ? 'Base' : 'Robinhood Chain'}</span>
          </p>
        ))}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-white/40">
        Read live from the chains just now — the fee wallet&apos;s USDC balance on Base and USDG
        balance on Robinhood Chain. No estimates. Live data:{' '}
        <Link href="/api/x402/volume" className="text-polydash-green hover:underline">
          /api/x402/volume
        </Link>
      </p>
    </div>
  );
}
