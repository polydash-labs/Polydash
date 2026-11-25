'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { formatEther, parseUnits } from 'viem';
import { CheckCircle2, Circle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatTokens, shortenAddress } from '@/lib/format';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { BOND_ABI } from '@/lib/bondArtifacts';
import {
  CONFIRM_NOTE, Erc20BondABI, STATUS_ACTIVE, STATUS_PENDING, STATUS_SLASHED, bondFactory, bondMeetsBadge, days, fmtDate, isAddr,
  sameAddr, timeLeft, type BondFn,
} from '@/lib/bond';
import { useBond, useBondTx, useRedeemQuote, type BondDetail } from '@/lib/hooks/use-bond';
import { useNowSec } from '@/app/stake/_components/primitives';
import { BadgePill, BondNote, BondNotLive, FloorBar, Limitations, Outcome, Stat, StatusPill } from '@/components/bond/notes';

const ZERO = BigInt(0);

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14"><p className="text-[12px] text-white/55">Creator bond</p>{children}</div>;
}

export function BondDetailView({ bond }: { bond: string }) {
  const live = !!bondFactory();
  const valid = isAddr(bond);
  const { data: b, isLoading, isError } = useBond(live && valid ? bond : null);

  if (!live) return <Shell><h1 className="mt-1 text-2xl font-semibold text-white">Creator bond</h1><BondNote className="mt-6" /><BondNotLive className="mt-4" /><Limitations className="mt-4" /></Shell>;
  if (!valid || b === null) return <Shell><h1 className="mt-1 text-2xl font-semibold text-white">Bond not found</h1><p className="mt-2 text-[13px] text-white/65">This address is not a bond from the Polypad bond factory.</p><BondNote className="mt-6" /></Shell>;
  if (isLoading) return <Shell><p className="mt-6 flex items-center gap-2 text-[13px] text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> Loading bond…</p><BondNote className="mt-6" /></Shell>;
  if (isError || !b) return <Shell><p className="mt-6 text-[13px] text-white/60">Could not load this bond right now.</p><BondNote className="mt-6" /></Shell>;
  return <Loaded b={b} />;
}

function parseAmt(s: string, decimals: number): bigint | null {
  const t = s.trim();
  if (!t || !/^\d*\.?\d*$/.test(t) || t === '.') return null;
  try { return parseUnits(t, decimals); } catch { return null; }
}

function Loaded({ b }: { b: BondDetail }) {
  const { address: user } = useAccount();
  const now = useNowSec(1000);
  const { send, pending } = useBondTx();
  const amt = (x: bigint) => `${formatTokens(x, b.decimals)} ${b.symbol}`;
  const busy = !!pending;
  const spin = (k: string) => (pending === k ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null);
  const tx = (key: string, functionName: string, fn: BondFn, success: string, args?: readonly unknown[]) =>
    send({ key, address: b.address, abi: BOND_ABI, functionName, args, fn, success });

  const isCreator = sameAddr(user, b.creator);
  const pendingStatus = b.status === STATUS_PENDING;
  const active = b.status === STATUS_ACTIVE;
  const slashed = b.status === STATUS_SLASHED;
  const ended = active && now > 0 && now > b.endTime;
  const meets = bondMeetsBadge(b.status, b.bondAmount, b.duration);

  const showConfirm = pendingStatus && b.userRegistered && !b.userConfirmed;
  const showCancel = pendingStatus && isCreator;
  const showRefund = isCreator && ended && !b.isBelowFloor;

  const [amountIn, setAmountIn] = useState('');
  const redeemAmt = parseAmt(amountIn, b.decimals);
  const { data: quote, isFetching: quoting } = useRedeemQuote(slashed && !b.userRegistered ? b.address : null, redeemAmt);
  const overBalance = redeemAmt != null && redeemAmt > b.userBalance;
  const needsApprove = redeemAmt != null && redeemAmt > ZERO && b.userAllowance < redeemAmt;
  const ratePerToken = b.supplyAtSlash > ZERO ? (b.pot * BigInt(10) ** BigInt(b.decimals)) / b.supplyAtSlash : ZERO;

  const redeem = async () => {
    if (!redeemAmt || redeemAmt <= ZERO) return;
    if (needsApprove) {
      const r = await send({ key: 'approve', address: b.token, abi: Erc20BondABI, functionName: 'approve', args: [b.address, redeemAmt], fn: 'approve', success: 'Approved' });
      if (!r) return;
    }
    const r = await tx('redeem', 'redeem', 'redeem', 'Redeemed', [redeemAmt]);
    if (r) setAmountIn('');
  };

  return (
    <Shell>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">{b.symbol || 'Token'} creator bond</h1>
        <div className="flex items-center gap-2"><StatusPill status={b.status} /><BadgePill met={meets} /></div>
      </div>
      <a href={getExplorerAddressUrl(b.address)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 break-all font-mono text-[12px] text-white/55 hover:text-white">
        {b.address} <ExternalLink className="h-3 w-3 shrink-0" />
      </a>

      <BondNote className="mt-6" />

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Token" value={<Link href={`/token/${b.token}`} className="hover:underline">{b.name || shortenAddress(b.token)}</Link>} sub={b.symbol} />
        <Stat label="Creator" value={shortenAddress(b.creator)} sub={isCreator ? 'You' : undefined} />
        <Stat label="Bond" value={`${formatEther(b.bondAmount)} ETH`} />
      </div>

      <div className="glass-card mt-4 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-white">Floor</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Committed" value={amt(b.committed)} />
          <Stat label="Allowance" value={`${(b.allowanceBps / 100).toFixed(2).replace(/\.00$/, '')}%`} />
          <Stat label="Floor" value={amt(b.floor)} />
          <Stat label="Wallets' total" value={amt(b.aggregate)} sub={b.isBelowFloor ? 'Below the floor' : undefined} />
        </div>
        <FloorBar className="mt-4" current={b.aggregate} floor={b.floor} decimals={b.decimals} symbol={b.symbol} />
      </div>

      <div className="glass-card mt-4 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-white">Timing</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Duration" value={`${days(b.duration)} days`} />
          <Stat label="Start" value={<span className="text-[13px]">{b.startTime ? fmtDate(b.startTime) : 'Not started'}</span>} />
          <Stat label="End" value={<span className="text-[13px]">{b.endTime ? fmtDate(b.endTime) : '—'}</span>} />
          <Stat label="Time left" value={<span className="text-[13px]">{active && b.endTime && now ? timeLeft(b.endTime, now) : '—'}</span>} />
        </div>
      </div>

      <div className="glass-card mt-4 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-white">Registered wallets</h2>
          {pendingStatus && <span className="text-[12px] text-white/60">{b.pendingConfirmations} pending confirmation{b.pendingConfirmations === 1 ? '' : 's'}</span>}
        </div>
        <ul className="mt-3 space-y-2">
          {b.wallets.map((w) => (
            <li key={w.address} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
              <a href={getExplorerAddressUrl(w.address)} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] text-white/80 hover:text-white">
                {shortenAddress(w.address)}{sameAddr(w.address, b.creator) ? ' (creator)' : ''}{sameAddr(w.address, user) ? ' (you)' : ''}
              </a>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[12px] text-white/75">{w.balance === undefined ? '—' : amt(w.balance)}</span>
                {w.confirmed ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-polydash-green"><CheckCircle2 className="h-3 w-3" /> Confirmed</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-yellow-300"><Circle className="h-3 w-3" /> Pending</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {slashed && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Pot" value={`${formatEther(b.pot)} ETH`} />
          <Stat label="Rate" value={`${formatEther(ratePerToken)} ETH`} sub={`per ${b.symbol || 'token'}, fixed`} />
          <Stat label="Total paid" value={`${formatEther(b.totalPaid)} ETH`} />
          <Stat label="Total burned" value={amt(b.totalBurned)} />
        </div>
      )}

      {(showConfirm || showCancel || b.canSlash || showRefund) && (
        <div className="glass-card mt-4 space-y-4 p-4 sm:p-5">
          <h2 className="text-[14px] font-semibold text-white">Actions</h2>
          {showConfirm && (
            <div className="space-y-2">
              <Button className="rounded-full" disabled={busy} onClick={() => tx('confirm', 'confirmWallet', 'confirmWallet', 'Wallet confirmed')}>{spin('confirm')} Confirm wallet</Button>
              <p className="text-[12px] text-white/60">{CONFIRM_NOTE}</p>
            </div>
          )}
          {showCancel && (
            <div className="space-y-2">
              <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => tx('cancel', 'cancel', 'cancel', 'Bond cancelled')}>{spin('cancel')} Cancel bond</Button>
              <p className="text-[12px] text-white/60">Cancels the pending bond and returns the ETH to you.</p>
            </div>
          )}
          {b.canSlash && (
            <div className="space-y-2">
              <Button variant="outline" className="rounded-full border-red-400/30 text-red-300 hover:bg-red-500/10" disabled={busy} onClick={() => tx('slash', 'slash', 'slash', 'Bond triggered')}>{spin('slash')} Trigger bond</Button>
              <p className="text-[12px] text-white/60">The registered wallets are below the floor. Anyone can trigger the bond.</p>
            </div>
          )}
          {showRefund && (
            <div className="space-y-2">
              <Button className="rounded-full" disabled={busy} onClick={() => tx('refund', 'refund', 'refund', 'ETH returned')}>{spin('refund')} Refund bond</Button>
              <p className="text-[12px] text-white/60">The bond has ended and the floor held. Returns the ETH to you.</p>
            </div>
          )}
        </div>
      )}

      {slashed && user && (
        <div className="glass-card mt-4 space-y-3 p-4 sm:p-5">
          <h2 className="text-[14px] font-semibold text-white">Redeem</h2>
          {b.userRegistered ? (
            <p className="text-[13px] text-white/65">Registered wallets cannot redeem.</p>
          ) : (
            <>
              <div className="flex items-center justify-between text-[12px] text-white/60">
                <span>Your balance: {amt(b.userBalance)}</span>
                <button type="button" className="text-polydash-green hover:underline" onClick={() => setAmountIn(formatTokensPlain(b.userBalance, b.decimals))}>Max</button>
              </div>
              <Input inputMode="decimal" placeholder="0.0" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} className="font-mono" aria-label="Amount to redeem" />
              {amountIn && redeemAmt == null && <p className="text-[12px] text-amber-300">Enter a valid amount.</p>}
              {overBalance && <p className="text-[12px] text-amber-300">Amount is above your balance.</p>}
              <p className="text-[12px] text-white/65">
                You receive: {redeemAmt && redeemAmt > ZERO ? (quoting ? 'Quoting…' : quote !== undefined ? `${formatEther(quote)} ETH` : '—') : '—'}
              </p>
              <p className="text-[12px] text-white/55">Redeemed tokens are burned.</p>
              <Button className="rounded-full" disabled={busy || !redeemAmt || redeemAmt <= ZERO || overBalance} onClick={redeem}>
                {spin('approve')}{spin('redeem')} {needsApprove ? 'Approve and redeem' : 'Redeem'}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="glass-card mt-4 p-5">
        <h2 className="text-[14px] font-semibold text-white">How it works</h2>
        <Outcome className="mt-2" />
      </div>
      <Limitations className="mt-4" />
    </Shell>
  );
}

/** Exact decimal string for an input field (no grouping, no rounding). */
function formatTokensPlain(x: bigint, decimals: number): string {
  const s = x.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}
