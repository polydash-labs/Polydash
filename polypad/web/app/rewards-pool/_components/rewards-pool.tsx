'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatEther, parseEther } from 'viem';
import { Input } from '@/components/ui/input';
import { usePoolHistory, usePoolSummary, usePoolUser, useBuybackTx, useVaultTargetLive } from '@/lib/hooks/use-buyback';
import { useEthPrice, useLaunches } from '@/lib/hooks/use-launches';
import { formatUsd } from '@/lib/format';
import { APR_NOTE, NOT_LIVE_POOL, POLYDASH, POOL_NOTE, fmtPT, fmtToken, poolAddress, vaultAddress, type Addr } from '@/lib/buyback';
import { AddrLink, Card, ConnectOr, ContractLinks, Note, Row, Stat, TxButton, TxLink } from '@/components/buyback/ui';

const EVENT_LABELS: Record<string, string> = { Staked: 'Staked', Withdrawn: 'Withdrawn', RewardPaid: 'Claimed', RewardAdded: 'Rewards added', Restreamed: 'Restreamed' };

function parseAmt(v: string): bigint | null {
  try {
    const t = v.trim();
    if (!t || !/^\d*\.?\d*$/.test(t)) return null;
    const n = parseEther(t);
    return n > BigInt(0) ? n : null;
  } catch {
    return null;
  }
}

function WalletPanel({ live }: { live: boolean }) {
  const pool = poolAddress();
  const { data: u } = usePoolUser();
  const tx = useBuybackTx();
  const [stakeIn, setStakeIn] = useState('');
  const [unstakeIn, setUnstakeIn] = useState('');
  const stakeAmt = parseAmt(stakeIn);
  const unstakeAmt = parseAmt(unstakeIn);
  const busy = !!tx.pending;

  const stake = async () => {
    if (!pool || !stakeAmt) return;
    if ((u?.allowance ?? BigInt(0)) < stakeAmt) {
      const r = await tx.send({ key: 'approve', address: POLYDASH as Addr, abi: 'erc20', functionName: 'approve', args: [pool, stakeAmt], success: 'Approved' });
      if (!r) return;
    }
    const r = await tx.send({ key: 'stake', address: pool, abi: 'pool', functionName: 'stake', args: [stakeAmt], success: 'Staked' });
    if (r) setStakeIn('');
  };
  const unstake = async () => {
    if (!pool || !unstakeAmt) return;
    const r = await tx.send({ key: 'withdraw', address: pool, abi: 'pool', functionName: 'withdraw', args: [unstakeAmt], success: 'Withdrew' });
    if (r) setUnstakeIn('');
  };

  return (
    <Card title="Your position">
      <Row label="Staked">{fmtToken(u?.staked)} POLYDASH</Row>
      <Row label="Claimable">{fmtToken(u?.earned)} POLYDASH</Row>
      <Row label="Wallet balance">{fmtToken(u?.wallet)} POLYDASH</Row>
      <div className="mt-4 space-y-3">
        <ConnectOr>
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Input value={stakeIn} onChange={(e) => setStakeIn(e.target.value)} placeholder="Amount to stake" inputMode="decimal" disabled={!live} className="pr-14 font-mono" />
                <button type="button" disabled={!live || !u?.wallet} onClick={() => u && setStakeIn(formatEther(u.wallet))} className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-polydash-green disabled:opacity-40">Max</button>
              </div>
              <TxButton testId="stake-btn" disabled={!live || !stakeAmt || (u ? stakeAmt > u.wallet : true)} busy={tx.pending === 'approve' || tx.pending === 'stake'} onClick={stake}>
                {u && stakeAmt && u.allowance < stakeAmt ? 'Approve and stake' : 'Stake'}
              </TxButton>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Input value={unstakeIn} onChange={(e) => setUnstakeIn(e.target.value)} placeholder="Amount to withdraw" inputMode="decimal" disabled={!live} className="pr-14 font-mono" />
                <button type="button" disabled={!live || !u?.staked} onClick={() => u && setUnstakeIn(formatEther(u.staked))} className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-polydash-green disabled:opacity-40">Max</button>
              </div>
              <TxButton testId="unstake-btn" variant="outline" disabled={!live || !unstakeAmt || (u ? unstakeAmt > u.staked : true)} busy={tx.pending === 'withdraw'} onClick={unstake}>Withdraw</TxButton>
            </div>
            <div className="flex flex-wrap gap-2">
              <TxButton testId="claim-btn" disabled={!live || !u?.earned || busy} busy={tx.pending === 'claim'} onClick={() => pool && tx.send({ key: 'claim', address: pool, abi: 'pool', functionName: 'claim', success: 'Claimed' })}>Claim</TxButton>
              <TxButton testId="exit-btn" variant="outline" disabled={!live || (!u?.staked && !u?.earned) || busy} busy={tx.pending === 'exit'} onClick={() => pool && tx.send({ key: 'exit', address: pool, abi: 'pool', functionName: 'exit', success: 'Withdrew all and claimed' })}>Withdraw all and claim</TxButton>
            </div>
            {u && stakeAmt && u.allowance < stakeAmt && (
              <p className="text-[12px] leading-relaxed text-white/55">
                Step 1 of 2: you approve this page to move up to {fmtToken(stakeAmt.toString())} POLYDASH once. Step 2: you stake it. Approving alone moves nothing.
              </p>
            )}
          </div>
        </ConnectOr>
        <p className="text-[12px] text-white/55">No lockup; withdraw any time.</p>
        {tx.lastHash && <p className="text-[12px] text-white/55">Tx: <TxLink hash={tx.lastHash.hash} /></p>}
      </div>
    </Card>
  );
}

function Helpers({ unaccounted }: { unaccounted: bigint }) {
  const vault = vaultAddress();
  const pool = poolAddress();
  const { data: t } = useVaultTargetLive();
  const tx = useBuybackTx();
  const canRelease = !!vault && !!t?.active && (t?.held ?? BigInt(0)) > BigInt(0);
  const canSync = !!pool && unaccounted > BigInt(0);
  if (!canRelease && !canSync) return null;
  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 sm:px-5">
      <summary className="cursor-pointer text-[13px] font-medium text-white">
        Help run Polypad (optional — costs you a network fee, you get nothing back)
      </summary>
      <div className="pt-3">
        <p className="text-[12px] text-white/55">Anyone can send these. The caller pays gas and receives nothing.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ConnectOr>
            {canRelease && (
              <TxButton busy={tx.pending === 'release'} onClick={() => tx.send({ key: 'release', address: vault!, abi: 'vault', functionName: 'releaseToTarget', success: 'Released to stakers' })}>
                Release to stakers ({fmtToken(t?.held)} POLYDASH held)
              </TxButton>
            )}
            {canSync && (
              <TxButton variant="outline" busy={tx.pending === 'sync'} onClick={() => tx.send({ key: 'sync', address: pool!, abi: 'pool', functionName: 'syncDonations', success: 'Donations streamed' })}>
                Stream donations ({fmtToken(unaccounted)} POLYDASH)
              </TxButton>
            )}
          </ConnectOr>
        </div>
      </div>
    </details>
  );
}

export function RewardsPool() {
  const { data: p, isLoading } = usePoolSummary();
  const live = !!p?.live && !!poolAddress();
  const { data: h } = usePoolHistory(live);
  const items: any[] = h?.items ?? [];
  const perDay = p?.rewardRate ? (BigInt(p.rewardRate) * BigInt(86400)).toString() : '0';
  const pool = poolAddress();
  // $ value of the daily reward rate, from the POLYDASH price in ETH x ETH/USD.
  const { data: ethUsd } = useEthPrice();
  const { data: launches } = useLaunches();
  const polyPriceEth = launches?.find((l) => l.tokenAddress.toLowerCase() === POLYDASH.toLowerCase())?.priceEth;
  const perDayUsd = ethUsd && polyPriceEth ? Number(formatEther(BigInt(perDay))) * polyPriceEth * ethUsd : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">POLYDASH Rewards Pool</h1>
        <p className="mt-2 max-w-2xl text-[14px] text-white/60">
          Stake POLYDASH. The stakers&apos; share of buybacks (15 of the 40% of fees) is streamed to this pool over 30 days.
        </p>
      </header>

      {!isLoading && !live && <Note>{NOT_LIVE_POOL}</Note>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Total staked" value={`${fmtToken(p?.totalStaked ?? '0')}`} sub="POLYDASH" />
        <Stat label="Rewards streaming until" value={live && p?.periodFinish ? fmtPT(p.periodFinish, false) : '-'} sub={live && p?.periodFinish ? fmtPT(p.periodFinish) : undefined} />
        <Stat label="Reward rate per day" value={fmtToken(perDay)} sub={`POLYDASH${perDayUsd != null ? ` · ≈ ${formatUsd(perDayUsd)}` : ''}`} />
        <Stat label="Total rewards added" value={fmtToken(p?.totalNotified ?? '0')} sub="POLYDASH" />
        <Stat label="Total claimed" value={fmtToken(p?.totalClaimed ?? '0')} sub="POLYDASH" />
        <Stat label="Current APR (variable)" value={p?.aprVariable == null ? '-' : `${Number(p.aprVariable).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`} sub={APR_NOTE} />
      </div>

      <Note tone="muted">{POOL_NOTE}</Note>

      <div className="grid gap-6 lg:grid-cols-2">
        <WalletPanel live={live} />
        <Card title="How the pool works">
          <ul className="list-disc space-y-2 pl-5 text-[13px] text-white/75">
            <li>Stake POLYDASH and receive a share of rewards in POLYDASH, in proportion to your stake.</li>
            <li>The buyback vault sends the stakers&apos; share of each buyback here. Each top-up is streamed over 30 days.</li>
            <li>No lockup; withdraw any time. Claim whenever you like.</li>
          </ul>
          <Link href="/buybacks" className="mt-3 inline-block text-[12px] text-polydash-green hover:underline">See POLYDASH buybacks</Link>
          <Link href="/slice" className="ml-4 mt-3 inline-block text-[12px] text-polydash-green hover:underline">Airdrop slice for stakers</Link>
        </Card>
      </div>

      <Helpers unaccounted={BigInt(p?.unaccounted ?? '0')} />

      <Card title="History">
        {items.length === 0 ? (
          <p className="text-[12px] text-white/55">{live ? 'No activity yet.' : 'Shown once the pool is live.'}</p>
        ) : (
          <>
            {/* mobile: stacked cards instead of a sideways-scrolling table */}
            <ul className="space-y-2 sm:hidden">
              {items.map((i) => (
                <li key={`${i.txHash}-${i.logIndex}`} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.05]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-white">{EVENT_LABELS[i.type] ?? i.type}</span>
                    <span className="font-mono text-[13px] text-white/85">{fmtToken(i.polyToStakers)} POLYDASH</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px] text-white/55">
                    <span>{fmtPT(i.time)}</span>
                    <TxLink hash={i.txHash} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[520px] text-left text-[12px]">
                <thead className="text-white/55">
                  <tr><th className="py-2 font-normal">Time (PT)</th><th className="py-2 font-normal">Event</th><th className="py-2 font-normal">Amount</th><th className="py-2 font-normal">Wallet</th><th className="py-2 font-normal">Tx</th></tr>
                </thead>
                <tbody className="text-white">
                  {items.map((i) => (
                    <tr key={`${i.txHash}-${i.logIndex}`} className="border-t border-white/5">
                      <td className="py-2">{fmtPT(i.time)}</td>
                      <td className="py-2">{EVENT_LABELS[i.type] ?? i.type}</td>
                      <td className="py-2 font-mono">{fmtToken(i.polyToStakers)}</td>
                      <td className="py-2">{i.caller ? <AddrLink address={i.caller} /> : '-'}</td>
                      <td className="py-2"><TxLink hash={i.txHash} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {pool && <Card title="Contract"><ContractLinks name="POLYDASH Rewards Pool" address={pool} /></Card>}
    </div>
  );
}
