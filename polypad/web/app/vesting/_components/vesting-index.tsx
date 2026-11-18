'use client';

import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTokens, shortenAddress } from '@/lib/format';
import { fmtDate, vestingFactory } from '@/lib/vesting';
import { useVaultsByBeneficiary } from '@/lib/hooks/use-vesting';
import { BadgePill, HowItWorks, NoAdminWarning, VestingNote, VestingNotLive } from '@/components/vesting/notes';

export function VestingIndex() {
  const live = !!vestingFactory();
  const { address, isConnected } = useAccount();
  const { data: rows, isLoading, isError } = useVaultsByBeneficiary(live ? address : null);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-wider text-white/55">Creator vesting</p>
          <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Your vaults</h1>
          <p className="mt-2 max-w-xl text-[13px] text-white/65">Lock Polypad tokens on a fixed schedule and optionally stake them while they vest.</p>
        </div>
        {live ? (
          <Button asChild className="rounded-full"><Link href="/vesting/create">Lock &amp; stake</Link></Button>
        ) : (
          <Button className="rounded-full" disabled>Lock &amp; stake</Button>
        )}
      </div>

      <VestingNote className="mt-6" />

      <div className="mt-6">
        {!live ? (
          <VestingNotLive />
        ) : !isConnected ? (
          <div className="glass-card p-6 text-center">
            <p className="text-[14px] text-white">Connect your wallet to see vaults where you are the beneficiary.</p>
            <ConnectButton.Custom>{({ openConnectModal }) => <Button className="mt-4 rounded-full" onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>
          </div>
        ) : isLoading ? (
          <p className="flex items-center gap-2 text-[13px] text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> Loading your vaults…</p>
        ) : isError ? (
          <p className="text-[13px] text-white/60">Could not load your vaults right now.</p>
        ) : !rows?.length ? (
          <div className="glass-card p-6 text-center text-[13px] text-white/65">You are not the beneficiary of any vaults yet.</div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.address}>
                <Link href={`/vesting/${r.address}`} className="glass-card block p-4 transition-colors hover:bg-white/[0.05] sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[14px] font-medium text-white">{r.symbol || shortenAddress(r.token)}</span>
                    <ArrowUpRight className="h-4 w-4 text-white/45" strokeWidth={1.5} />
                  </div>
                  <p className="mt-1 font-mono text-[15px] text-white">{formatTokens(r.locked, r.decimals)} locked</p>
                  <p className="mt-1 text-[12px] text-white/55">Cliff ends {fmtDate(r.cliffEnd)} · Vest ends {fmtDate(r.endTime)} · {r.isStaked ? 'Staked' : 'Not staked'}</p>
                  <BadgePill met={r.meetsBadge} className="mt-2" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="glass-card mt-8 p-5">
        <h2 className="text-[14px] font-semibold text-white">How it works</h2>
        <HowItWorks className="mt-3" />
      </div>
      <NoAdminWarning className="mt-4" />
    </div>
  );
}
