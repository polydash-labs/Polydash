import Link from 'next/link';
import { getX402Volume } from '@/lib/x402/volume';
import { EMERALD_CARD } from '@/lib/ui/template';

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
      <div className={`${EMERALD_CARD} max-w-2xl`}>
        <p className="text-[18px] font-semibold text-white">Settled so far</p>
        <p className="mt-1 text-[13px] leading-relaxed text-white/55">
          Settlement totals are not available right now — the chain read failed. Try again shortly.
        </p>
      </div>
    );
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const count = (n: number | null | undefined) =>
    n == null ? null : `${n} payment${n === 1 ? '' : 's'}`;
  const allTimeCount = count(volume.allTimeCount);
  const weekCount = count(volume.weekCount);
  return (
    <div className={`${EMERALD_CARD} max-w-2xl`}>
      <p className="text-[18px] font-semibold text-white">Settled so far</p>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-white">
        {fmt(volume.allTimeUsd)}
        <span className="ml-2 text-[13px] font-normal text-white/50">
          paid for reports, all time
          {allTimeCount ? ` · ${allTimeCount}` : ''}
        </span>
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-white/70">
        <span className="font-semibold text-white">
          {fmt(volume.weekUsd ?? 0)} this week{weekCount ? ` · ${weekCount}` : ''}.
        </span>{' '}
        {volume.allTimeCount != null &&
        volume.weekCount != null &&
        volume.weekCount < volume.allTimeCount ? (
          <>
            {volume.weekCount} of the {volume.allTimeCount} payments landed in the last 7 days —
            the rest predate the window (the first two were Nov 18 pre-launch tests), so this
            week&apos;s total is slightly below the all-time total.{' '}
          </>
        ) : (
          <>
            Every payment settled so far landed inside the last 7 days — so this week&apos;s total
            is the all-time total for now.{' '}
          </>
        )}
        {volume.note}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-white/55">
        {volume.chains.map((c) => (
          <p key={c.network}>
            <span className="text-white/70">{c.symbol}</span>{' '}
            {c.settledUsd != null ? fmt(c.settledUsd) : '—'}{' '}
            <span className="text-white/40">· {c.chainId === 8453 ? 'Base' : 'Robinhood Chain'}</span>
            {count(c.count) ? <span className="text-white/40"> · {count(c.count)}</span> : null}
          </p>
        ))}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-white/40">
        Read live from the chains just now — the fee wallet&apos;s USDC balance on Base and USDG
        balance on Robinhood Chain, and the payment count from the same wallet&apos;s transfer
        records. No estimates. Live data:{' '}
        <Link href="/api/x402/volume" className="text-emerald-300 hover:underline">
          /api/x402/volume
        </Link>
      </p>
    </div>
  );
}
