'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { formatUnits, parseEventLogs, parseUnits } from 'viem';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatTokens } from '@/lib/format';
import { useLaunches } from '@/lib/hooks/use-launches';
import { useEligiblePools, useVestToken, useVestingTx } from '@/lib/hooks/use-vesting';
import { VESTING_FACTORY_ABI } from '@/lib/vestingArtifacts';
import {
  DAY, Erc20VestABI, MAX_DURATION_DAYS, MAX_START_AHEAD_DAYS, MIN_DURATION_DAYS, NOT_POLYPAD_TOKEN, PRESETS, ZERO_ADDRESS,
  fmtDate, isAddr, isPolydashToken, isZero, meetsBadge, vestingFactory, type Addr, type PresetId,
} from '@/lib/vesting';
import { useNowSec } from '@/app/stake/_components/primitives';
import { BadgePill, HowItWorks, NoAdminWarning, VestingNote, VestingNotLive } from '@/components/vesting/notes';
import { PoolSelect } from '@/components/vesting/pool-select';

const label = 'text-[12px] font-medium text-white/70';
const section = 'glass-card space-y-3 p-4 sm:p-5';
const selectCls = 'h-10 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 text-[13px] text-white focus:outline-none focus:ring-1 focus:ring-polydash-green/50 disabled:opacity-60';

const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? parseInt(s.trim(), 10) : NaN);

export function CreateVaultForm({ initialToken }: { initialToken: string }) {
  const router = useRouter();
  const factory = vestingFactory();
  const live = !!factory;
  const { address: user, isConnected } = useAccount();
  const now = useNowSec(30_000);

  const [tokenInput, setTokenInput] = useState(isPolydashToken(initialToken) ? '' : initialToken);
  const [amount, setAmount] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [startDays, setStartDays] = useState('0');
  const [preset, setPreset] = useState<PresetId>('hp');
  const [cliffDays, setCliffDays] = useState('30');
  const [durationDays, setDurationDays] = useState('180');
  const [pool, setPool] = useState<Addr>(ZERO_ADDRESS);

  useEffect(() => { if (user && !beneficiary) setBeneficiary(user); }, [user, beneficiary]);

  const token = tokenInput.trim();
  const tokenValid = isAddr(token) && !isPolydashToken(token);
  const { data: launches } = useLaunches();
  const picker = useMemo(
    () => (launches ?? []).filter((l) => !isPolydashToken(l.tokenAddress)).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [launches],
  );
  const { data: info, isLoading: infoLoading } = useVestToken(tokenValid ? token : null);
  const polypadOk = !!info?.isPolypad;
  const { data: pools = [], isLoading: poolsLoading } = useEligiblePools(tokenValid && polypadOk ? token : null);

  useEffect(() => { setPool(ZERO_ADDRESS); setAmount(''); }, [token]);
  useEffect(() => {
    if (!isZero(pool) && !pools.some((p) => p.address.toLowerCase() === pool.toLowerCase())) setPool(ZERO_ADDRESS);
  }, [pools, pool]);

  // schedule
  const p = PRESETS.find((x) => x.id === preset);
  const cliffD = p ? p.cliffDays : toInt(cliffDays);
  const durD = p ? p.durationDays : toInt(durationDays);
  const startD = toInt(startDays);
  const scheduleErr =
    Number.isNaN(startD) || startD < 0 || startD > MAX_START_AHEAD_DAYS ? `Start must be 0 to ${MAX_START_AHEAD_DAYS} days from now.`
    : Number.isNaN(durD) || durD < MIN_DURATION_DAYS || durD > MAX_DURATION_DAYS ? `Duration must be ${MIN_DURATION_DAYS} to ${MAX_DURATION_DAYS.toLocaleString('en-US')} days.`
    : Number.isNaN(cliffD) || cliffD < 0 || cliffD > durD ? 'Cliff must be between 0 and the duration.'
    : null;
  const badgeOk = !scheduleErr && meetsBadge(cliffD * DAY, durD * DAY);
  const startSec = now ? now + (Number.isNaN(startD) ? 0 : startD) * DAY : 0;
  const vestEnd = startSec && !scheduleErr ? startSec + durD * DAY : 0;
  const cliffEnd = startSec && !scheduleErr ? startSec + cliffD * DAY : 0;

  // amount
  const decimals = info?.decimals ?? 18;
  let amountWei: bigint | null = null;
  try { if (amount.trim() && /^\d*\.?\d*$/.test(amount.trim())) amountWei = parseUnits(amount.trim(), decimals); } catch { amountWei = null; }
  const amountErr = !amount.trim() ? null
    : amountWei == null || amountWei <= BigInt(0) ? 'Enter a valid amount.'
    : info && amountWei > info.balance ? 'Amount exceeds your wallet balance.'
    : null;
  const benOk = isAddr(beneficiary.trim()) && !isZero(beneficiary.trim());

  const ready = live && isConnected && polypadOk && amountWei != null && amountWei > BigInt(0) && !amountErr && benOk && !scheduleErr;
  const needsApproval = ready && (info?.allowance ?? BigInt(0)) < (amountWei as bigint);

  const { send, pending } = useVestingTx();

  const approve = async () => {
    if (!factory || !amountWei) return;
    await send({ key: 'approve', address: token as Addr, abi: Erc20VestABI, functionName: 'approve', args: [factory, amountWei], fn: 'approve', success: 'Approved' });
  };

  const create = async () => {
    if (!factory || !amountWei || scheduleErr) return;
    const start = startD === 0 ? BigInt(0) : BigInt(Math.floor(Date.now() / 1000) + startD * DAY);
    const r = await send({
      key: 'create', address: factory, abi: VESTING_FACTORY_ABI, functionName: 'createVault',
      args: [token as Addr, beneficiary.trim() as Addr, amountWei, start, BigInt(cliffD * DAY), BigInt(durD * DAY), pool],
      fn: 'createVault', success: 'Vault created',
    });
    if (!r) return;
    try {
      const ev = parseEventLogs({ abi: VESTING_FACTORY_ABI, eventName: 'VaultCreated', logs: r.logs });
      const vault = (ev[0]?.args as { vault?: Addr } | undefined)?.vault;
      if (vault) { router.push(`/vesting/${vault}`); return; }
    } catch (e) {
      console.error('VaultCreated parse failed', e);
    }
    toast.message('Vault created. Find it under your vaults.');
    router.push('/vesting');
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <p className="text-[12px] uppercase tracking-wider text-white/55">Creator vesting</p>
      <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Lock &amp; stake</h1>
      <p className="mt-2 text-[13px] text-white/65">Lock Polypad tokens in a vesting vault on Robinhood Chain and optionally stake them in a V2 pool while they vest. Your wallet signs every transaction.</p>

      <VestingNote className="mt-6" />
      {!live && <VestingNotLive className="mt-4" />}

      <fieldset disabled={!live} className="mt-6 space-y-4 disabled:opacity-70">
        {/* Token */}
        <section className={section}>
          <h2 className="text-[14px] font-semibold text-white">Token</h2>
          <div className="space-y-1.5">
            <label htmlFor="vest-pick" className={label}>Pick a Polypad token</label>
            <select
              id="vest-pick" className={selectCls}
              value={picker.some((l) => l.tokenAddress.toLowerCase() === token.toLowerCase()) ? picker.find((l) => l.tokenAddress.toLowerCase() === token.toLowerCase())!.tokenAddress : ''}
              onChange={(e) => setTokenInput(e.target.value)}
            >
              <option value="" className="bg-neutral-900">Select a token</option>
              {picker.map((l) => (
                <option key={l.tokenAddress} value={l.tokenAddress} className="bg-neutral-900">{l.symbol} · {l.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="vest-token" className={label}>Or paste a token address</label>
            <Input id="vest-token" placeholder="0x…" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} className="font-mono text-[13px]" spellCheck={false} />
          </div>
          {token && isPolydashToken(token) && <p className="text-[12px] text-amber-300">{NOT_POLYPAD_TOKEN}</p>}
          {token && !isAddr(token) && <p className="text-[12px] text-amber-300">Enter a valid token address.</p>}
          {tokenValid && live && (infoLoading ? (
            <p className="flex items-center gap-2 text-[12px] text-white/55"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking token…</p>
          ) : info && !info.isPolypad ? (
            <p className="text-[12px] text-amber-300">{NOT_POLYPAD_TOKEN}</p>
          ) : info ? (
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.03] p-3 text-[12px] ring-1 ring-white/[0.06] sm:grid-cols-4">
              <div><p className="text-white/50">Name</p><p className="truncate text-white">{info.name || '—'}</p></div>
              <div><p className="text-white/50">Symbol</p><p className="text-white">{info.symbol || '—'}</p></div>
              <div><p className="text-white/50">Decimals</p><p className="font-mono text-white">{info.decimals}</p></div>
              <div><p className="text-white/50">Wallet balance</p><p className="font-mono text-white">{user ? formatTokens(info.balance, info.decimals) : '—'}</p></div>
            </div>
          ) : null)}
        </section>

        {/* Amount + beneficiary */}
        <section className={section}>
          <h2 className="text-[14px] font-semibold text-white">Amount and beneficiary</h2>
          <div className="space-y-1.5">
            <label htmlFor="vest-amount" className={label}>Amount to lock</label>
            <div className="flex gap-2">
              <Input id="vest-amount" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" disabled={!polypadOk} />
              <Button type="button" variant="outline" className="rounded-full" disabled={!polypadOk || !info?.balance}
                onClick={() => info && setAmount(formatUnits(info.balance, info.decimals))}>Max</Button>
            </div>
            {amountErr && <p className="text-[12px] text-amber-300">{amountErr}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="vest-ben" className={label}>Beneficiary</label>
            <Input id="vest-ben" placeholder="0x…" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} className="font-mono text-[13px]" spellCheck={false} />
            <p className="text-[11px] text-white/50">Defaults to your connected wallet. The beneficiary receives staking rewards and unlocked tokens.</p>
            {beneficiary.trim() && !benOk && <p className="text-[12px] text-amber-300">Enter a valid beneficiary address.</p>}
          </div>
        </section>

        {/* Schedule */}
        <section className={section}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold text-white">Schedule</h2>
            {!scheduleErr && <BadgePill met={badgeOk} />}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="vest-start" className={label}>Start (days from now)</label>
            <Input id="vest-start" inputMode="numeric" value={startDays} onChange={(e) => setStartDays(e.target.value)} className="font-mono" />
            <p className="text-[11px] text-white/50">0 starts the schedule when the vault is created. Up to {MAX_START_AHEAD_DAYS} days ahead.</p>
          </div>
          <div className="space-y-2">
            {[...PRESETS.map((x) => ({ id: x.id as PresetId, label: x.label })), { id: 'custom' as PresetId, label: 'Custom' }].map((o) => (
              <button key={o.id} type="button" onClick={() => setPreset(o.id)} aria-pressed={preset === o.id}
                className={cn('flex w-full items-center gap-3 rounded-xl p-3 text-left text-[13px] ring-1 transition-colors',
                  preset === o.id ? 'bg-polydash-green/[0.07] text-white ring-polydash-green/40' : 'bg-white/[0.03] text-white/80 ring-white/[0.08] hover:bg-white/[0.05]')}>
                <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1', preset === o.id ? 'ring-polydash-green' : 'ring-white/30')}>
                  {preset === o.id && <span className="h-2 w-2 rounded-full bg-polydash-green" />}
                </span>
                {o.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="vest-cliff" className={label}>Cliff (days)</label>
                <Input id="vest-cliff" inputMode="numeric" value={cliffDays} onChange={(e) => setCliffDays(e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="vest-dur" className={label}>Duration (days)</label>
                <Input id="vest-dur" inputMode="numeric" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} className="font-mono" />
              </div>
              <p className="col-span-2 text-[11px] text-white/50">Duration {MIN_DURATION_DAYS} to {MAX_DURATION_DAYS.toLocaleString('en-US')} days; the cliff cannot be longer than the duration.</p>
            </div>
          )}
          {scheduleErr ? (
            <p className="text-[12px] text-amber-300">{scheduleErr}</p>
          ) : (
            <p className="text-[12px] text-white/60">
              {now ? <>Nothing unlocks before {fmtDate(cliffEnd)}. Fully unlocked {fmtDate(vestEnd)}. </> : null}
              The Holder Protections minimum is a cliff of at least 30 days and a duration of at least 180 days.
            </p>
          )}
        </section>

        {/* Pool */}
        <section className={section}>
          <h2 className="text-[14px] font-semibold text-white">Staking pool (optional)</h2>
          {polypadOk ? (
            <PoolSelect pools={pools} loading={poolsLoading} value={pool} onChange={setPool} vestEnd={vestEnd} disabled={!live} />
          ) : (
            <p className="text-[12px] text-white/55">Choose a Polypad token to see its active V2 staking pools.</p>
          )}
        </section>

        <section className={section}>
          <h2 className="text-[14px] font-semibold text-white">How it works</h2>
          <HowItWorks />
        </section>

        <NoAdminWarning />

        {/* Actions */}
        <div className="glass-card space-y-3 p-4 sm:p-5">
          <ol className="flex items-center gap-3 text-[12px]">
            <li className={cn('flex items-center gap-1.5', ready && !needsApproval ? 'text-polydash-green' : 'text-white/70')}>
              {ready && !needsApproval ? <Check className="h-3.5 w-3.5" /> : <span className="font-mono">1</span>} Approve
            </li>
            <span className="h-px flex-1 bg-white/10" />
            <li className="flex items-center gap-1.5 text-white/70"><span className="font-mono">2</span> Create vault</li>
          </ol>
          {!isConnected ? (
            <ConnectButton.Custom>{({ openConnectModal }) => <Button type="button" className="w-full rounded-full" onClick={openConnectModal} disabled={!live}>Connect wallet</Button>}</ConnectButton.Custom>
          ) : needsApproval ? (
            <Button type="button" className="w-full rounded-full" onClick={approve} disabled={!!pending}>
              {pending === 'approve' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Approve {info?.symbol || 'token'}
            </Button>
          ) : (
            <Button type="button" className="w-full rounded-full" onClick={create} disabled={!ready || !!pending}>
              {pending === 'create' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create vault
            </Button>
          )}
        </div>
      </fieldset>
    </div>
  );
}
