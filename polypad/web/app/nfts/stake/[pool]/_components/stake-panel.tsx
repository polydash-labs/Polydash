'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { usePublicClient } from 'wagmi';
import { type Abi } from 'viem';
import { Check, Layers, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { robinhoodChain } from '@/lib/chain';
import { NftStakingPoolABI } from '@/lib/contracts/nft-staking-pool-abi';
import { useWalletNfts, verifyOwnedIds, type StakingPool, type UserPoolState, useStakingTx } from '@/lib/hooks/use-nft-staking';
import { BOOST_NOTE, EMERGENCY_WARNING, Erc721ReadABI, STAKED_LOCK_NOTE, WITHDRAW_BOOST_WARNING, formatDuration, multLabel, type Addr } from '@/lib/nftStaking';

const MAX_BATCH = 50;

function Chip({ id, selected, onClick, children }: { id: bigint; selected: boolean; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={cn('flex min-w-[92px] flex-col items-start gap-1 rounded-xl px-3 py-2 text-left ring-1 transition',
        selected ? 'bg-polydash-green/10 ring-polydash-green/50' : 'bg-white/[0.03] ring-white/10 hover:ring-white/25')}>
      <span className="flex w-full items-center justify-between gap-2 font-mono text-[13px] text-white">#{id.toString()}{selected && <Check className="h-3.5 w-3.5 text-polydash-green" strokeWidth={2} />}</span>
      {children}
    </button>
  );
}

const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };

export function StakePanel({ p, user, state, now, ended }: { p: StakingPool; user?: Addr; state?: UserPoolState; now: number; ended: boolean }) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { send, pending } = useStakingTx();
  const owned = useWalletNfts(p.collection, user, p.polypad);
  const [manual, setManual] = useState<bigint[]>([]);
  const [manualText, setManualText] = useState('');
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [pickStaked, setPickStaked] = useState<Set<string>>(new Set());
  const [confirmEmergency, setConfirmEmergency] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const autoPickedOnce = useRef(false);
  const userTouchedPick = useRef(false);

  const walletIds = useMemo(() => {
    const m = new Map<string, bigint>();
    [...(owned.data?.ids ?? []), ...manual].forEach((id) => m.set(id.toString(), id));
    return Array.from(m.values()).sort((a, b) => (a < b ? -1 : 1));
  }, [owned.data, manual]);
  // Owned NFTs are already known, so select them by default — tap to unpick
  // any you want to keep. Only done once, so a manual unpick is respected.
  useEffect(() => {
    if (autoPickedOnce.current || userTouchedPick.current) return;
    const ids = owned.data?.ids ?? [];
    if (!ids.length) return;
    autoPickedOnce.current = true;
    setPick(new Set(ids.map((i) => i.toString())));
  }, [owned.data]);
  const staked = state?.ids ?? [];
  const age = state ? Math.max(0, now - state.fetchedAt) : 0;
  const boosted = p.tierBps.length > 1;

  if (!user) {
    return (
      <section className="glass-card space-y-3 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-white">Your NFTs</h2>
        <p className="text-[12px] text-white/55">Connect a wallet to stake, claim or withdraw.</p>
        <ConnectButton.Custom>{({ openConnectModal }) => <Button className="rounded-full" onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>
      </section>
    );
  }

  const addManual = async () => {
    setManualMsg(null);
    const ids = Array.from(new Set(manualText.split(/[\s,]+/).filter(Boolean)));
    if (!ids.length || ids.some((s) => !/^\d+$/.test(s))) { setManualMsg('Enter whole-number token IDs separated by commas or spaces.'); return; }
    if (!client) return;
    try {
      const big = ids.slice(0, 200).map((s) => BigInt(s));
      const mine = await verifyOwnedIds(client, p.collection, user, big);
      setManual((m) => [...m, ...mine]);
      const missing = big.length - mine.length;
      setManualMsg(mine.length ? `${mine.length} added.${missing ? ` ${missing} not held by this wallet.` : ''}` : 'None of these are held by this wallet.');
      setManualText('');
    } catch (e) {
      console.error('manual id check failed', e);
      setManualMsg('Could not check those IDs. Try again.');
    }
  };

  const selected = walletIds.filter((id) => pick.has(id.toString()));
  const selectedStaked = staked.filter((s) => pickStaked.has(s.id.toString())).map((s) => s.id);
  const ready = staked.filter((s) => s.eligibleTier > s.tier).map((s) => s.id);

  const approve = () => send({ key: 'approveAll', address: p.collection, abi: Erc721ReadABI as Abi, functionName: 'setApprovalForAll', args: [p.address, true], fn: 'setApprovalForAll', success: 'Collection approved for this pool' });
  const stake = async () => {
    const ids = selected.slice(0, MAX_BATCH);
    const r = await send({ key: 'stake', address: p.address, abi: NftStakingPoolABI as Abi, functionName: 'stake', args: [ids], fn: 'stake', ids: ids.length, success: `Staked ${ids.length} NFT${ids.length === 1 ? '' : 's'}` });
    if (r) { setPick(new Set()); setManual((m) => m.filter((x) => !ids.includes(x))); }
  };
  const withdraw = async (emergency: boolean) => {
    const ids = selectedStaked.slice(0, MAX_BATCH);
    const fn = emergency ? 'emergencyWithdraw' : 'withdraw';
    const r = await send({ key: fn, address: p.address, abi: NftStakingPoolABI as Abi, functionName: fn, args: [ids], fn, ids: ids.length, success: emergency ? 'NFTs returned. Unclaimed rewards forfeited.' : 'NFTs withdrawn' });
    if (r) setPickStaked(new Set());
  };
  const poke = () => send({ key: 'poke', address: p.address, abi: NftStakingPoolABI as Abi, functionName: 'poke', args: [ready.slice(0, MAX_BATCH)], fn: 'poke', ids: Math.min(ready.length, MAX_BATCH), success: 'Boost activated' });

  const busy = !!pending;

  return (
    <section className="glass-card space-y-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-white">Your NFTs</h2>
        {p.setMin > 0 && p.setBonusBps > 0 && (
          <span className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium ring-1 ring-inset',
            state?.setBonus ? 'bg-polydash-green/10 text-polydash-green ring-polydash-green/30' : 'bg-white/[0.06] text-white/70 ring-white/10')}>
            <Layers className="h-3 w-3" strokeWidth={1.75} />
            {state?.setBonus ? `Set bonus active: +${p.setBonusBps / 100}%` : `Set bonus: stake ${p.setMin}+ for +${p.setBonusBps / 100}% (${Number(state?.staked ?? 0)}/${p.setMin})`}
          </span>
        )}
      </div>

      {/* Staked */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-white">Staked ({staked.length})</p>
          {staked.length > 0 && (
            <button type="button" className="text-[12px] text-white/60 hover:text-white" onClick={() => setPickStaked(pickStaked.size === staked.length ? new Set() : new Set(staked.map((s) => s.id.toString())))}>
              {pickStaked.size === staked.length ? 'Clear' : 'Select all'}
            </button>
          )}
        </div>
        {staked.length === 0 ? (
          <p className="text-[12px] text-white/55">Nothing staked in this pool from this wallet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {staked.map((s) => {
              const left = Math.max(0, s.toNext - age);
              return (
                <Chip key={s.id.toString()} id={s.id} selected={pickStaked.has(s.id.toString())} onClick={() => setPickStaked(toggle(pickStaked, s.id.toString()))}>
                  {boosted && (
                    <>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/80">
                        Tier {s.tier + 1} · {multLabel(p.tierBps[s.tier] ?? 10_000)}
                      </span>
                      {s.eligibleTier > s.tier ? (
                        <span className="text-[10px] text-polydash-green">Boost ready</span>
                      ) : s.tier < p.tierBps.length - 1 && s.toNext > 0 ? (
                        <span className="text-[10px] text-white/55">Next tier in {formatDuration(left)}</span>
                      ) : (
                        <span className="text-[10px] text-white/55">Top tier</span>
                      )}
                    </>
                  )}
                </Chip>
              );
            })}
          </div>
        )}
        {ready.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-polydash-green/[0.06] p-3 ring-1 ring-polydash-green/25">
            <Sparkles className="h-4 w-4 text-polydash-green" strokeWidth={1.5} />
            <p className="flex-1 text-[12px] text-white/75">{ready.length} NFT{ready.length === 1 ? ' has' : 's have'} reached a higher tier. {BOOST_NOTE}</p>
            <Button size="sm" className="rounded-full" disabled={busy} onClick={poke}>{pending === 'poke' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Activate boost</Button>
          </div>
        )}
        {staked.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="rounded-full" disabled={busy || !selectedStaked.length} onClick={() => setConfirmWithdraw(true)}>
                {pending === 'withdraw' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Withdraw{selectedStaked.length ? ` ${selectedStaked.length}` : ''}
              </Button>
              <Button size="sm" variant="ghost" className="rounded-full text-red-300 hover:bg-red-500/10 hover:text-red-200" disabled={busy || !selectedStaked.length} onClick={() => setConfirmEmergency(true)}>
                {pending === 'emergencyWithdraw' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Emergency withdraw
              </Button>
            </div>
            {boosted || (p.setMin > 0 && p.setBonusBps > 0) ? <p className="text-[11px] text-white/55">{WITHDRAW_BOOST_WARNING}</p> : null}
          </div>
        )}
      </div>

      <div className="h-px bg-white/[0.06]" />

      {/* Wallet */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-white">In your wallet ({walletIds.length})</p>
          <button type="button" className="text-[12px] text-white/60 hover:text-white" onClick={() => setShowManual((v) => !v)}>Enter token IDs</button>
        </div>
        {owned.isLoading ? (
          <div className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />
        ) : owned.data?.tooLarge ? (
          <p className="text-[12px] text-amber-300">This collection has too much history to scan. Enter your token IDs below.</p>
        ) : owned.isError ? (
          <p className="text-[12px] text-white/55">Could not scan this wallet. Enter your token IDs below.</p>
        ) : null}
        {(showManual || owned.data?.tooLarge || owned.isError) && (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <input value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="e.g. 12, 48, 301" aria-label="Token IDs"
                className="h-9 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 font-mono text-[13px] text-white outline-none placeholder:text-white/35 focus:border-polydash-green/50" />
              <Button size="sm" variant="outline" className="rounded-full" onClick={addManual}>Add</Button>
            </div>
            <p className="text-[11px] text-white/55">Only needed if your NFTs don&apos;t show up above — paste the number printed on each NFT, separated by commas.</p>
            {manualMsg && <p className="text-[11px] text-white/60">{manualMsg}</p>}
          </div>
        )}
        {walletIds.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              {walletIds.map((id) => <Chip key={id.toString()} id={id} selected={pick.has(id.toString())} onClick={() => { userTouchedPick.current = true; setPick(toggle(pick, id.toString())); }} />)}
            </div>
            <button type="button" className="text-[12px] text-white/60 hover:text-white" onClick={() => { userTouchedPick.current = true; setPick(pick.size === walletIds.length ? new Set() : new Set(walletIds.map((i) => i.toString()))); }}>
              {pick.size === walletIds.length ? 'Clear selection' : 'Select all'}
            </button>
          </>
        )}
        {!owned.isLoading && !walletIds.length && !owned.data?.tooLarge && !owned.isError && <p className="text-[12px] text-white/55">No NFTs from this collection found in your wallet.</p>}
        <p className="rounded-xl bg-amber-400/[0.07] px-3 py-2 text-[12px] leading-relaxed text-amber-200/90 ring-1 ring-amber-400/25">{STAKED_LOCK_NOTE}</p>
        <div className="flex flex-wrap gap-2">
          {!state?.approved ? (
            <Button size="sm" className="rounded-full" disabled={busy || ended} onClick={approve}>{pending === 'approveAll' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Approve collection</Button>
          ) : null}
          <Button size="sm" className="rounded-full" disabled={busy || ended || !state?.approved || !selected.length} onClick={stake}>
            {pending === 'stake' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Stake{selected.length ? ` ${Math.min(selected.length, MAX_BATCH)}` : ''}
          </Button>
        </div>
        {!state?.approved && (
          <p className="text-[12px] leading-relaxed text-white/55">
            Step 1 of 2: you approve this page to move NFTs from this collection. Step 2: you stake the ones you pick. Approving alone moves nothing.
          </p>
        )}
        {selected.length > MAX_BATCH && <p className="text-[11px] text-amber-300">Up to {MAX_BATCH} NFTs per transaction. The first {MAX_BATCH} will be staked.</p>}
        {ended && <p className="text-[11px] text-white/55">This pool has ended. Staking is closed; you can still withdraw and claim.</p>}
      </div>

      <AlertDialog open={confirmWithdraw} onOpenChange={setConfirmWithdraw}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw {selectedStaked.length} NFT{selectedStaked.length === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>{WITHDRAW_BOOST_WARNING} Pending rewards stay claimable.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => withdraw(false)}>Withdraw</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEmergency} onOpenChange={setConfirmEmergency}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Emergency withdraw?</AlertDialogTitle>
            <AlertDialogDescription>{EMERGENCY_WARNING} This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500 text-white hover:bg-red-600" onClick={() => withdraw(true)}>Forfeit rewards and withdraw</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
