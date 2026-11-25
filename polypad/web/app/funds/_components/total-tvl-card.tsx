'use client';

import { useTotalTvl } from '@/lib/hooks/use-total-tvl';
import { cn } from '@/lib/utils';

const usd0 = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Total TVL — everything locked on Polypad, priced on-chain:
 * staked principal across both staking factories + ETH/POLYDASH in the
 * fund vaults. DeFiLlama shows a smaller number: it counts only the fund
 * vaults, leaves staking out, and cannot price POLYDASH.
 *
 * Resilience: the last good figure stays on screen when a background
 * refetch fails (placeholderData), with a small retry control beside it.
 * An error state only appears when nothing ever loaded — never $0.
 */
export function TotalTvlCard({ className }: { className?: string }) {
  const { data, isLoading, isError, refetch, isFetching } = useTotalTvl();

  return (
    <div className={cn('glass-card w-full p-4 sm:w-80', className)} aria-live="polite">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-polydash-green">Total TVL</p>
      {data ? (
        <>
          <p className="mt-1 text-[28px] font-semibold leading-none tracking-tight text-white">{usd0(data.totalUsd)}</p>
          <p className="mt-2 text-[12px] text-white/60">
            Staking {usd0(data.stakingUsd)} <span className="text-white/25">·</span> Fund vaults {usd0(data.vaultsUsd)}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/40">
            Staked funds plus the tokenized fund vaults, priced on-chain. DeFiLlama shows a smaller number — it counts only the fund vaults, not staking, and it can&rsquo;t price POLYDASH yet.
          </p>
          {isError && (
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/70 transition-colors hover:bg-white/5 hover:text-white"
            >
              ↻ Couldn&rsquo;t refresh — retry
            </button>
          )}
          {isFetching && !isError && <p className="mt-2 text-[11px] text-white/40">Updating…</p>}
        </>
      ) : isLoading ? (
        <div className="mt-2 space-y-2" aria-label="Loading total value locked">
          <div className="h-7 w-32 animate-pulse rounded bg-white/10" />
          <div className="h-3.5 w-48 animate-pulse rounded bg-white/10" />
          <div className="h-3 w-56 animate-pulse rounded bg-white/10" />
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-[14px] text-white">Couldn&rsquo;t load Total TVL right now</p>
          <p className="mt-1 text-[12px] text-white/50">The chain read didn&rsquo;t answer. Your funds are unaffected.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-polydash-green px-3.5 py-1.5 text-[12px] font-medium text-black transition-colors hover:bg-polydash-green-light"
          >
            ↻ Retry
          </button>
        </div>
      )}
    </div>
  );
}
