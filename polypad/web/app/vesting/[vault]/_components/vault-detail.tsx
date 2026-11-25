'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatTokens, shortenAddress } from '@/lib/format';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { VESTING_VAULT_ABI } from '@/lib/vestingArtifacts';
import {
  DAY, EMERGENCY_CONFIRM, MAX_DURATION_DAYS, ZERO_ADDRESS, days, fmtDateTime, isAddr, isZero, vestingFactory, type Addr, type VestingFn,
} from '@/lib/vesting';
import { useEligiblePools, useVault, useVestingTx, type VaultDetail } from '@/lib/hooks/use-vesting';
import { useNowSec } from '@/app/stake/_components/primitives';
import { BadgePill, HowItWorks, NoAdminWarning, Stat, VestingNote, VestingNotLive } from '@/components/vesting/notes';
import { PoolSelect } from '@/components/vesting/pool-select';

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? parseInt(s.trim(), 10) : NaN);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <Link href="/vesting" className="text-[12px] text-white/55 hover:text-white">Creator vesting</Link>
      {children}
    </div>
  );
}

export function VaultDetailView({ vault }: { vault: string }) {
  const live = !!vestingFactory();
  const valid = isAddr(vault);
  const { data: v, isLoading, isError } = useVault(live && valid ? vault : null);

  if (!live) return <Shell><h1 className="mt-1 text-2xl font-semibold text-white">Vesting vault</h1><VestingNote className="mt-6" /><VestingNotLive className="mt-4" /></Shell>;
  if (!valid || v === null) return <Shell><h1 className="mt-1 text-2xl font-semibold text-white">Vault not found</h1><p className="mt-2 text-[13px] text-white/65">This address is not a vault from the Polypad vesting factory.</p><VestingNote className="mt-6" /></Shell>;
  if (isLoading) return <Shell><p className="mt-6 flex items-center gap-2 text-[13px] text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> Loading vault…</p></Shell>;
  if (isError || !v) return <Shell><p className="mt-6 text-[13px] text-white/60">Could not load this vault right now.</p><VestingNote className="mt-6" /></Shell>;
  return <Loaded v={v} />;
}

function Loaded({ v }: { v: VaultDetail }) {
  const { address: user } = useAccount();
  const now = useNowSec(1000);
  const { send, pending } = useVestingTx();
  const amt = (x: bigint) => `${formatTokens(x, v.decimals)} ${v.symbol}`;

  const hasPool = !isZero(v.pool);
  const poolEnded = hasPool && v.poolEnd != null && now > 0 && now >= v.poolEnd;
  const isBen = same(user, v.beneficiary);
  const isPendingBen = !isZero(v.pendingBeneficiary) && same(user, v.pendingBeneficiary);
  const vestedPct = v.totalAllocation > BigInt(0) ? Number((v.vestedAmount * BigInt(10000)) / v.totalAllocation) / 100 : 0;
  const timePct = now && v.endTime > v.start ? Math.min(100, Math.max(0, ((now - v.start) / (v.endTime - v.start)) * 100)) : 0;

  const canMigrate = isBen && (!hasPool || poolEnded);
  const { data: pools = [], isLoading: poolsLoading } = useEligiblePools(canMigrate ? v.token : null);
  const migratePools = pools.filter((p) => !same(p.address, v.pool));
  const [newPool, setNewPool] = useState<Addr>(ZERO_ADDRESS);
  useEffect(() => { if (!migratePools.some((p) => same(p.address, newPool))) setNewPool(migratePools[0]?.address ?? ZERO_ADDRESS); }, [migratePools, newPool]);

  const curCliffD = days(v.cliffDuration);
  const curDurD = days(v.duration);
  const [cliffIn, setCliffIn] = useState(String(curCliffD));
  const [durIn, setDurIn] = useState(String(curDurD));
  const nc = toInt(cliffIn);
  const nd = toInt(durIn);
  const newCliffSec = nc * DAY;
  const newDurSec = nd * DAY;
  const extendErr = Number.isNaN(nc) || Number.isNaN(nd) ? 'Enter whole days.'
    : newCliffSec < v.cliffDuration || newDurSec < v.duration ? 'The schedule can only be extended, never shortened.'
    : nc > nd ? 'The cliff cannot be longer than the duration.'
    : nd > MAX_DURATION_DAYS ? `Duration cannot exceed ${MAX_DURATION_DAYS.toLocaleString('en-US')} days.`
    : newCliffSec === v.cliffDuration && newDurSec === v.duration ? 'Increase the cliff or the duration.'
    : null;

  const [nextBen, setNextBen] = useState('');
  const nextBenTrim = nextBen.trim();
  const nextBenOk = nextBenTrim === '' || isAddr(nextBenTrim);

  const tx = (key: string, functionName: string, fn: VestingFn, success: string, args?: readonly unknown[]) =>
    send({ key, address: v.address, abi: VESTING_VAULT_ABI, functionName, args, fn, success });
  const spin = (k: string) => (pending === k ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null);
  const busy = !!pending;

  return (
    <Shell>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">{v.symbol || 'Token'} vesting vault</h1>
        <BadgePill met={v.meetsBadgeMinimum} />
      </div>
      <a href={getExplorerAddressUrl(v.address)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-mono text-[12px] text-white/55 hover:text-white">
        {v.address} <ExternalLink className="h-3 w-3" />
      </a>

      <VestingNote className="mt-6" />

      {/* Parties */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Token" value={<Link href={`/token/${v.token}`} className="hover:underline">{v.name || shortenAddress(v.token)}</Link>} sub={v.symbol} />
        <Stat label="Beneficiary" value={shortenAddress(v.beneficiary)} sub={isBen ? 'You' : undefined} />
        <Stat label="Pending beneficiary" value={isZero(v.pendingBeneficiary) ? 'None' : shortenAddress(v.pendingBeneficiary)} sub={isPendingBen ? 'You' : undefined} />
      </div>

      {/* Schedule */}
      <div className="glass-card mt-4 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-white">Schedule</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat label="Start" value={<span className="text-[13px]">{fmtDateTime(v.start)}</span>} />
          <Stat label="Cliff ends" value={<span className="text-[13px]">{fmtDateTime(v.cliffEnd)}</span>} sub={`${curCliffD} days`} />
          <Stat label="Fully vested" value={<span className="text-[13px]">{fmtDateTime(v.endTime)}</span>} sub={`${curDurD} days`} />
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-white/55"><span>Vested {vestedPct.toFixed(2)}%</span><span>Time elapsed {timePct.toFixed(1)}%</span></div>
          <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="absolute inset-y-0 left-0 rounded-full bg-polydash-green" style={{ width: `${vestedPct}%` }} />
          </div>
        </div>
      </div>

      {/* Amounts */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Total allocation" value={amt(v.totalAllocation)} />
        <Stat label="Vested" value={amt(v.vestedAmount)} />
        <Stat label="Locked" value={amt(v.lockedAmount)} />
        <Stat label="Releasable" value={amt(v.releasable)} />
        <Stat label="Staked" value={amt(v.stakedAmount)} />
        <Stat label="Idle in vault" value={amt(v.idleAmount)} />
        <Stat label="Holdings" value={amt(v.holdings)} />
        <Stat label="Pending rewards" value={formatTokens(v.pendingRewards, 18)} sub="Paid to the beneficiary" />
        <Stat label="Staking" value={<span className="text-[13px]">{v.isStaked ? 'Staked' : 'Not staked'}</span>} />
      </div>

      {/* Pool */}
      <div className="glass-card mt-4 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-white">Staking pool</h2>
        {hasPool ? (
          <div className="mt-2 text-[13px] text-white/75">
            <p className="text-white">{v.poolName || 'Staking pool'}</p>
            <a href={getExplorerAddressUrl(v.pool)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-white/55 hover:text-white">{shortenAddress(v.pool)} <ExternalLink className="h-3 w-3" /></a>
            <p className="mt-1 text-[12px] text-white/60">{v.poolEnd ? `${poolEnded ? 'Ended' : 'Ends'} ${fmtDateTime(v.poolEnd)}` : 'End date unavailable'}</p>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-white/60">No pool. Tokens are locked without staking.</p>
        )}
      </div>

      {/* Public actions */}
      <div className="glass-card mt-4 space-y-3 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-white">Actions</h2>
        <p className="text-[12px] text-white/55">Anyone can run these. Rewards and released tokens always go to the beneficiary.</p>
        <div className="flex flex-wrap gap-2">
          <Button className="rounded-full" disabled={busy || v.releasable === BigInt(0)} onClick={() => tx('release', 'release', 'release', 'Released to beneficiary')}>{spin('release')} Release</Button>
          {hasPool && (
            <Button variant="outline" className="rounded-full" disabled={busy || v.pendingRewards === BigInt(0)} onClick={() => tx('claim', 'claimRewards', 'claimRewards', 'Rewards sent to beneficiary')}>{spin('claim')} Claim rewards</Button>
          )}
          {hasPool && !poolEnded && (
            <Button variant="outline" className="rounded-full" disabled={busy || v.idleAmount === BigInt(0)} onClick={() => tx('stake', 'stakeIdle', 'stakeIdle', 'Idle tokens staked')}>{spin('stake')} Stake idle</Button>
          )}
          {poolEnded && (
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => tx('exit', 'exitEndedPool', 'exitEndedPool', 'Principal returned to the vault')}>{spin('exit')} Exit ended pool</Button>
          )}
        </div>
      </div>

      {/* Pending beneficiary */}
      {isPendingBen && (
        <div className="glass-card mt-4 space-y-3 p-4 sm:p-5">
          <h2 className="text-[14px] font-semibold text-white">Accept beneficiary role</h2>
          <p className="text-[12px] text-white/60">The current beneficiary proposed your wallet. Accepting makes you the beneficiary of this vault.</p>
          <Button className="rounded-full" disabled={busy} onClick={() => tx('accept', 'acceptBeneficiary', 'acceptBeneficiary', 'You are now the beneficiary')}>{spin('accept')} Accept beneficiary</Button>
        </div>
      )}

      {/* Beneficiary-only */}
      {isBen && (
        <div className="glass-card mt-4 space-y-5 p-4 sm:p-5">
          <h2 className="text-[14px] font-semibold text-white">Beneficiary controls</h2>

          {canMigrate && (
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-white">Move to a new pool</p>
              <PoolSelect pools={migratePools} loading={poolsLoading} value={newPool} onChange={setNewPool} vestEnd={v.endTime} allowNone={false} />
              <Button variant="outline" className="rounded-full" disabled={busy || isZero(newPool)} onClick={() => tx('migrate', 'migrate', 'migrate', 'Moved to the new pool', [newPool])}>{spin('migrate')} Migrate</Button>
            </div>
          )}

          {v.isStaked && (
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-white">Emergency exit</p>
              <p className="text-[12px] text-white/60">Leaves the pool immediately. {EMERGENCY_CONFIRM}</p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="rounded-full border-red-400/30 text-red-300 hover:bg-red-500/10" disabled={busy}>{spin('emergency')} Emergency exit pool</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Emergency exit the pool?</AlertDialogTitle>
                    <AlertDialogDescription>{EMERGENCY_CONFIRM}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => tx('emergency', 'emergencyExitPool', 'emergencyExitPool', 'Exited the pool')}>Exit pool</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[13px] font-medium text-white">Extend schedule</p>
            <p className="text-[12px] text-white/60">You can only lengthen the cliff or the duration. Nobody can shorten it.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><label htmlFor="ext-cliff" className="text-[11px] text-white/55">Cliff (days)</label><Input id="ext-cliff" inputMode="numeric" value={cliffIn} onChange={(e) => setCliffIn(e.target.value)} className="font-mono" /></div>
              <div className="space-y-1"><label htmlFor="ext-dur" className="text-[11px] text-white/55">Duration (days)</label><Input id="ext-dur" inputMode="numeric" value={durIn} onChange={(e) => setDurIn(e.target.value)} className="font-mono" /></div>
            </div>
            {extendErr && (cliffIn !== String(curCliffD) || durIn !== String(curDurD)) && <p className="text-[12px] text-amber-300">{extendErr}</p>}
            <Button variant="outline" className="rounded-full" disabled={busy || !!extendErr}
              onClick={() => tx('extend', 'extendSchedule', 'extendSchedule', 'Schedule extended', [BigInt(newCliffSec), BigInt(newDurSec)])}>{spin('extend')} Extend schedule</Button>
          </div>

          <div className="space-y-2">
            <p className="text-[13px] font-medium text-white">Transfer beneficiary</p>
            <p className="text-[12px] text-white/60">Propose a new beneficiary; they must accept from their wallet. Leave empty to cancel a pending proposal.</p>
            <Input placeholder="0x… (empty cancels)" value={nextBen} onChange={(e) => setNextBen(e.target.value)} className="font-mono text-[13px]" spellCheck={false} aria-label="New beneficiary address" />
            {!nextBenOk && <p className="text-[12px] text-amber-300">Enter a valid address, or leave empty to cancel.</p>}
            <Button variant="outline" className="rounded-full" disabled={busy || !nextBenOk || (nextBenTrim === '' && isZero(v.pendingBeneficiary))}
              onClick={() => tx('propose', 'proposeBeneficiary', 'proposeBeneficiary', nextBenTrim ? 'New beneficiary proposed' : 'Proposal cancelled', [nextBenTrim ? (nextBenTrim as Addr) : ZERO_ADDRESS])}>
              {spin('propose')} {nextBenTrim ? 'Propose beneficiary' : 'Cancel proposal'}
            </Button>
          </div>
        </div>
      )}

      <NoAdminWarning className="mt-4" />
      <div className="glass-card mt-4 p-5">
        <h2 className="text-[14px] font-semibold text-white">How it works</h2>
        <HowItWorks className="mt-3" />
      </div>
    </Shell>
  );
}
