'use client';

import { shortenAddress } from '@/lib/format';
import { usePoolLeaderboard } from '@/lib/hooks/use-nft-staking';
import type { Addr } from '@/lib/nftStaking';

export function Leaderboard({ pool, me }: { pool: Addr; me?: Addr }) {
  const { data, isLoading, isError } = usePoolLeaderboard(pool);
  return (
    <section className="glass-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-white">Stakers</h2>
        <p className="text-[11px] text-white/55">Share of pool weight decides each wallet&apos;s share of rewards.</p>
      </div>
      {isLoading ? (
        <div className="mt-3 h-24 animate-pulse rounded-xl bg-white/[0.04]" />
      ) : isError ? (
        <p className="mt-3 text-[12px] text-white/55">Could not load stakers right now.</p>
      ) : !data?.length ? (
        <p className="mt-3 text-[12px] text-white/55">No stakers yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-white/55">
                <th className="py-2 pr-3 font-normal">#</th>
                <th className="py-2 pr-3 font-normal">Wallet</th>
                <th className="py-2 pr-3 text-right font-normal">NFTs staked</th>
                <th className="py-2 pr-3 text-right font-normal">Weight multiple</th>
                <th className="py-2 text-right font-normal">Share of weight</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 50).map((r, i) => {
                const mine = !!me && r.user.toLowerCase() === me.toLowerCase();
                return (
                  <tr key={r.user} className="border-t border-white/[0.06]">
                    <td className="py-2 pr-3 font-mono text-white/55">{i + 1}</td>
                    <td className="py-2 pr-3 font-mono text-white">{shortenAddress(r.user)}{mine && <span className="ml-2 text-polydash-green">You</span>}</td>
                    <td className="py-2 pr-3 text-right font-mono text-white">{r.count}</td>
                    <td className="py-2 pr-3 text-right font-mono text-white">{r.multiple.toFixed(2)}x</td>
                    <td className="py-2 text-right font-mono text-white">{r.share.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
