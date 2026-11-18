'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Wallet } from 'lucide-react';
import { formatUnits, parseUnits } from 'viem';
import { useAccount, useSwitchChain } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { robinhoodChain } from '@/lib/chain';
import { cn } from '@/lib/utils';
import { erc20Abi, fmtNum, type PoolSummary } from '@/lib/staking/shared';
import { TokenLogo, sym, useReducedMotion } from './primitives';
import { usePoolWallet, useStakeTx } from './use-stake';

type Tab = 'stake' | 'unstake' | 'claim';
const Z = BigInt(0);
const toNum = (v: bigint, d: number) => Number(formatUnits(v, d));

function parseAmt(s: string, d: number): bigint | null {
  const v = s.trim();
  if (!v || !/^\d*\.?\d*$/.test(v) || v === '.') return null;
  try { return parseUnits(v, d); } catch { return null; }
}

function fmtLive(v: number) {
  if (!Number.isFinite(v) || v <= 0) return '0.000000';
  const dp = v < 1 ? 6 : v < 1000 ? 4 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Live earned counter: base value from the last read plus the accrual rate, redrawn smoothly. */
export function LiveEarned({ base, at, ratePerSec, className }: { base: number; at: number; ratePerSec: number; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const draw = () => { if (ref.current) ref.current.textContent = fmtLive(base + Math.max(0, (Date.now() - (at || Date.now())) / 1000) * ratePerSec); };
    draw();
    if (ratePerSec <= 0) return;
    if (reduced) { const id = setInterval(draw, 1000); return () => clearInterval(id); }
    let raf = 0, last = 0;
    const loop = (t: number) => { if (t - last > 80) { draw(); last = t; } raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [base, at, ratePerSec, reduced]);
  return <span ref={ref} className={cn('tabular-nums', className)}>{fmtLive(base)}</span>;
}

function NoWallet({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[12px] text-white/60 underline-offset-2 transition-colors hover:text-white hover:underline">
      Connect wallet
    </button>
  );
}

export function ActionPanel({ pool, className }: { pool: PoolSummary; className?: string }) {
  const { chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const w = usePoolWallet(pool);
  const { send, pending } = useStakeTx();
  const [tab, setTab] = useState<Tab>('stake');
  const [amount, setAmount] = useState('');
  const [maxPick, setMaxPick] = useState(false);
  const [stage, setStage] = useState<'idle' | 'approve' | 'stake'>('idle');
  const [done, setDone] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const sd = pool.stake.decimals, rd = pool.reward.decimals;
  const S = sym(pool.stake), R = sym(pool.reward);
  const amt = parseAmt(amount, sd);
  const wrongChain = !!w.address && chainId !== robinhoodChain.id;
  const ended = pool.status === 'ended';
  const fee = pool.claimFeeBps / 10_000;
  const busy = !!pending;

  useEffect(() => { setAmount(''); setMaxPick(false); setStage('idle'); }, [tab]);
  useEffect(() => { if (!done) return; const id = setTimeout(() => setDone(null), 5000); return () => clearTimeout(id); }, [done]);

  const sharesNum = toNum(w.shares, sd);
  const ratePerSec = pool.status === 'ended' || pool.totalStaked <= 0 || sharesNum <= 0 ? 0 : (sharesNum / pool.totalStaked) * pool.rewardsPerSec * (1 - fee);
  const maxFor = tab === 'stake' ? w.balance : w.staked;

  const pick = (pct: number) => {
    if (maxFor <= Z) return;
    const v = (maxFor * BigInt(pct)) / BigInt(100);
    setAmount(formatUnits(v, sd));
    setMaxPick(pct === 100);
  };

  const stakeError = useMemo(() => {
    if (tab !== 'stake') return null;
    if (ended) return 'This pool has ended. Staking is closed.';
    if (!pool.funded) return 'This pool is not funded yet.';
    if (amt == null || amt === Z || !w.ready) return null;
    if (amt > w.balance) return `Not enough ${S} in your wallet.`;
    if (pool.maxTotalStake > 0 && pool.totalStaked + toNum(amt, sd) > pool.maxTotalStake) return 'That is over the pool limit.';
    return null;
  }, [tab, ended, pool, amt, w.ready, w.balance, S, sd]);
  const unstakeError = tab === 'unstake' && amt != null && amt > Z && w.ready && amt > w.staked ? 'That is more than you have staked.' : null;
  const needsApprove = tab === 'stake' && amt != null && amt > Z && amt > w.allowance;

  const doStake = async () => {
    if (amt == null || amt === Z) return;
    if (needsApprove) {
      setStage('approve');
      const ok = await send({ key: 'approve', address: pool.stake.address as `0x${string}`, abi: erc20Abi as any, functionName: 'approve', args: [pool.address, amt], success: `${S} approved` });
      if (!ok) { setStage('idle'); return; }
    }
    setStage('stake');
    const ok = await send({ key: 'stake', address: pool.address as `0x${string}`, functionName: 'stake', args: [amt], success: `Staked ${fmtNum(toNum(amt, sd))} ${S}` });
    setStage('idle');
    if (ok) { setDone(`Staked ${fmtNum(toNum(amt, sd))} ${S}`); setAmount(''); w.refetch(); }
  };

  const doWithdraw = async () => {
    if (amt == null || amt === Z || w.staked === Z) return;
    const shares = maxPick || amt >= w.staked ? w.shares : (amt * w.shares) / w.staked;
    const ok = await send({ key: 'withdraw', address: pool.address as `0x${string}`, functionName: 'withdraw', args: [shares], success: `Withdrew ${fmtNum(toNum(amt, sd))} ${S}` });
    if (ok) { setDone(`Withdrew ${fmtNum(toNum(amt, sd))} ${S}`); setAmount(''); w.refetch(); }
  };

  const simple = async (fn: 'claim' | 'exit' | 'emergencyWithdraw', label: string) => {
    const ok = await send({ key: fn, address: pool.address as `0x${string}`, functionName: fn, success: label });
    if (ok) { setDone(label); setAdvanced(false); w.refetch(); }
  };

  // ---- primary button (one per state) ----
  let primary: { label: string; onClick?: () => void; disabled?: boolean; icon?: React.ReactNode };
  if (!w.address) primary = { label: 'Connect wallet', onClick: openConnectModal, icon: <Wallet className="h-4 w-4" strokeWidth={1.75} /> };
  else if (wrongChain) primary = { label: 'Switch to Robinhood Chain', onClick: () => switchChain({ chainId: robinhoodChain.id }) };
  else if (tab === 'stake') {
    const label = stage === 'approve' ? `Approving ${S}` : stage === 'stake' ? `Staking ${S}` : needsApprove ? `Approve and stake ${S}` : `Stake ${S}`;
    primary = { label, onClick: doStake, disabled: busy || ended || !pool.funded || amt == null || amt === Z || !!stakeError };
  } else if (tab === 'unstake') primary = { label: pending === 'withdraw' ? 'Withdrawing' : `Withdraw ${S}`, onClick: doWithdraw, disabled: busy || amt == null || amt === Z || !!unstakeError || w.staked === Z };
  else primary = { label: pending === 'claim' ? 'Claiming' : `Claim ${R}`, onClick: () => simple('claim', `Claimed ${R} rewards`), disabled: busy || w.claimable === Z };

  const showSteps = tab === 'stake' && !!w.address && !wrongChain && amt != null && amt > Z && !stakeError;
  const approveDone = !needsApprove || stage === 'stake';

  return (
    <div className={cn('stk-glass p-4 sm:p-5', className)}>
      {/* Earned */}
      <div className="rounded-xl bg-black/30 p-4 ring-1 ring-white/[0.06]">
        <div className="flex items-center justify-between text-[12px] text-white/50">
          <span>Earned (after claim fee)</span>
          {ratePerSec > 0 && <span className="inline-flex items-center gap-1.5 text-polydash-green"><span className="h-1.5 w-1.5 rounded-full bg-polydash-green motion-safe:animate-pulse" />Live</span>}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          {w.address ? (
            <>
              <LiveEarned base={toNum(w.claimable, rd)} at={w.fetchedAt} ratePerSec={ratePerSec} className="text-[28px] font-semibold tracking-tight text-white sm:text-[32px]" />
              <span className="text-[13px] text-white/50">{R}</span>
            </>
          ) : (
            <>
              <span className="text-[28px] font-semibold tracking-tight text-white/60 sm:text-[32px]">—</span>
              <NoWallet onClick={openConnectModal} />
            </>
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
          <div><div className="text-white/45">Your stake</div><div className="tabular-nums text-white/90">{w.address ? `${fmtNum(toNum(w.staked, sd))} ${S}` : <span className="inline-flex items-baseline gap-1.5"><span className="text-white/60">—</span><NoWallet onClick={openConnectModal} /></span>}</div></div>
          <div><div className="text-white/45">Wallet balance</div><div className="tabular-nums text-white/90">{w.address ? `${fmtNum(toNum(w.balance, sd))} ${S}` : <span className="inline-flex items-baseline gap-1.5"><span className="text-white/60">—</span><NoWallet onClick={openConnectModal} /></span>}</div></div>
        </div>
      </div>

      {/* Segmented control */}
      <div role="tablist" aria-label="Pool actions" className="mt-4 grid grid-cols-3 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/[0.06]">
        {(['stake', 'unstake', 'claim'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn('h-11 rounded-lg text-[14px] font-medium capitalize transition-colors sm:h-10', tab === t ? 'bg-white/[0.1] text-white shadow-sm' : 'text-white/55 hover:text-white')}>
            {t}
          </button>
        ))}
      </div>

      {tab !== 'claim' ? (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[12px] text-white/50">
            <label htmlFor={`amt-${pool.address}`}>{tab === 'stake' ? 'Amount to stake' : 'Amount to withdraw'}</label>
            {w.address && <span className="tabular-nums">{tab === 'stake' ? 'Balance' : 'Staked'}: {fmtNum(toNum(maxFor, sd))}</span>}
          </div>
          <div className="mt-1.5 flex h-14 items-center gap-2 rounded-xl bg-black/30 px-3 ring-1 ring-white/10 focus-within:ring-polydash-green/50">
            <TokenLogo token={pool.stake} size={26} />
            <input id={`amt-${pool.address}`} inputMode="decimal" autoComplete="off" placeholder="0.0" value={amount}
              onChange={(e) => { setAmount(e.target.value.replace(',', '.')); setMaxPick(false); }}
              className="min-w-0 flex-1 bg-transparent text-[20px] font-medium tabular-nums text-white placeholder:text-white/25 focus:outline-none" />
            <span className="text-[13px] text-white/50">{S}</span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {[25, 50, 75, 100].map((p) => (
              <button key={p} onClick={() => pick(p)} disabled={!w.address || maxFor === Z}
                className="h-11 rounded-lg bg-white/[0.04] text-[13px] font-medium text-white/70 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40 sm:h-9">
                {p === 100 ? 'MAX' : `${p}%`}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-white/[0.03] p-4 text-[13px] text-white/65 ring-1 ring-white/[0.06]">
          <div className="flex justify-between"><span>Ready to claim</span><span className="tabular-nums text-white">{fmtNum(toNum(w.claimable, rd))} {R}</span></div>
          <div className="mt-1 flex justify-between"><span>Claim fee</span><span className="tabular-nums">{(pool.claimFeeBps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%</span></div>
          <p className="mt-2 text-[12px] text-white/45">Rewards keep adding up every second. You can claim anytime; your stake stays in the pool.</p>
        </div>
      )}

      {(stakeError || unstakeError) && <p className="mt-3 text-[13px] text-[#FF8A80]">{stakeError || unstakeError}</p>}
      {wrongChain && <p className="mt-3 text-[13px] text-amber-300">Your wallet is on another network. Switch to Robinhood Chain (4663) to continue.</p>}

      {showSteps && (
        <ol className="mt-4 grid grid-cols-2 gap-2 text-[12px]" aria-label="Steps">
          {[{ n: 1, label: needsApprove ? `Approve ${S}` : 'Approved', active: stage === 'approve', ok: approveDone }, { n: 2, label: `Stake ${S}`, active: stage === 'stake', ok: false }].map((s) => (
            <li key={s.n} className={cn('flex h-11 items-center gap-2 rounded-lg px-3 ring-1', s.active ? 'bg-polydash-green/[0.08] text-white ring-polydash-green/40' : s.ok ? 'text-polydash-green ring-polydash-green/20' : 'text-white/55 ring-white/10')}>
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[11px] ring-1', s.ok ? 'bg-polydash-green text-black ring-polydash-green' : 'ring-white/25')}>
                {s.active ? <Loader2 className="h-3 w-3 animate-spin" /> : s.ok ? <Check className="h-3 w-3" strokeWidth={2.5} /> : s.n}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      <button onClick={primary.onClick} disabled={primary.disabled}
        className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-polydash-green text-[15px] font-semibold text-black transition-colors hover:bg-polydash-green-light disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-white/40">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}{!busy && primary.icon}{primary.label}
      </button>

      {done && (
        <div className="stk-check mt-3 flex items-center gap-2 rounded-xl bg-polydash-green/[0.08] px-3 py-2.5 text-[13px] text-polydash-green ring-1 ring-polydash-green/25" role="status">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-polydash-green text-black"><Check className="h-3 w-3" strokeWidth={2.5} /></span>{done}
        </div>
      )}

      {tab === 'stake' && pool.status === 'upcoming' && <p className="mt-3 text-[12px] text-white/50">Rewards start when the pool opens. You can stake now.</p>}

      {w.address && !wrongChain && w.shares > Z && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3 text-[13px]">
          <button onClick={() => simple('exit', 'Withdrew everything and claimed rewards')} disabled={busy}
            className="h-11 rounded-lg px-1 text-white/75 underline-offset-4 hover:text-white hover:underline disabled:opacity-40 sm:h-8">
            Exit: withdraw all and claim
          </button>
          <button onClick={() => setAdvanced((v) => !v)} className="h-11 px-1 text-white/45 hover:text-white/80 sm:h-8">Advanced</button>
        </div>
      )}
      {advanced && w.shares > Z && (
        <div className="mt-2 rounded-xl bg-[#FF5252]/[0.06] p-3 text-[12px] text-[#FFB4AB] ring-1 ring-[#FF5252]/25">
          <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <p>Emergency withdraw returns your staked {S} right away but <strong>forfeits all unclaimed rewards</strong>. Use it only if a normal withdraw fails.</p></div>
          <button onClick={() => simple('emergencyWithdraw', 'Emergency withdraw done')} disabled={busy}
            className="mt-3 h-11 w-full rounded-lg ring-1 ring-[#FF5252]/50 text-[13px] font-medium text-[#FF8A80] hover:bg-[#FF5252]/10 disabled:opacity-40 sm:h-9">
            Emergency withdraw (forfeit rewards)
          </button>
        </div>
      )}
    </div>
  );
}
