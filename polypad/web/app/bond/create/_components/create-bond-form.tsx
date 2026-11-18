'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { formatEther, formatUnits, parseEther, parseEventLogs, parseUnits } from 'viem';
import { CheckCircle2, Circle, Loader2, Lock, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatTokens, shortenAddress } from '@/lib/format';
import { useLaunches } from '@/lib/hooks/use-launches';
import { useBondToken, useBondTx, useWalletBalances } from '@/lib/hooks/use-bond';
import { BOND_FACTORY_ABI } from '@/lib/bondArtifacts';
import {
  BADGE_HINT, DAY, DEFAULT_ALLOWANCE_BPS, MAX_ALLOWANCE_BPS, MAX_DURATION_DAYS, MAX_WALLETS, MIN_DURATION_DAYS, NOT_CREATOR,
  NOT_POLYPAD_TOKEN, PRESETS, WALLETS_NOTE, bondFactory, floorOf, floorSentence, inputsMeetBadge, isAddr, isPolydashToken, isZero,
  sameAddr, type Addr, type PresetId,
} from '@/lib/bond';
import { BondNote, BondNotLive, Limitations, Outcome } from '@/components/bond/notes';

const label = 'text-[12px] font-medium text-white/70';
const section = 'glass-card space-y-3 p-4 sm:p-5';
const selectCls = 'h-10 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 text-[13px] text-white focus:outline-none focus:ring-1 focus:ring-polydash-green/50 disabled:opacity-60';
const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? parseInt(s.trim(), 10) : NaN);

function Req({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={cn('flex items-center gap-1.5', met ? 'text-polydash-green' : 'text-white/60')}>
      {met ? <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Circle className="h-3.5 w-3.5" strokeWidth={1.75} />} {children}
    </li>
  );
}

export function CreateBondForm({ initialToken }: { initialToken: string }) {
  const router = useRouter();
  const factory = bondFactory();
  const live = !!factory;
  const { address: user, isConnected } = useAccount();

  const [tokenInput, setTokenInput] = useState(isPolydashToken(initialToken) ? '' : initialToken);
  const [bondEth, setBondEth] = useState('0.1');
  const [preset, setPreset] = useState<PresetId>('90');
  const [customDays, setCustomDays] = useState('90');
  const [committed, setCommitted] = useState('');
  const [allowanceBps, setAllowanceBps] = useState(DEFAULT_ALLOWANCE_BPS);
  const [extra, setExtra] = useState<string[]>([]);

  const token = tokenInput.trim();
  const tokenValid = isAddr(token) && !isPolydashToken(token);
  const { data: launches } = useLaunches();
  const picker = useMemo(
    () => (launches ?? []).filter((l) => !isPolydashToken(l.tokenAddress)).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [launches],
  );
  const { data: info, isLoading: infoLoading, isError: infoError } = useBondToken(tokenValid ? token : null);
  const polypadOk = !!info?.isPolypad;
  const isCreator = polypadOk && sameAddr(user, info?.creator);
  const formOn = live && isConnected && isCreator;

  useEffect(() => { setCommitted(''); setExtra([]); }, [token]);

  // wallets: creator row fixed + up to 9 more
  const creator = info?.creator ?? null;
  const allWallets = useMemo(() => [creator ?? '', ...extra.map((w) => w.trim())], [creator, extra]);
  const { data: balances } = useWalletBalances(polypadOk ? token : null, allWallets.filter((w) => isAddr(w)));
  const walletErr = (w: string, i: number): string | null => {
    if (!w) return null;
    if (!isAddr(w) || isZero(w)) return 'Enter a valid address.';
    if (sameAddr(w, token)) return 'The token address cannot be registered.';
    if (sameAddr(w, info?.launch)) return 'The launch address cannot be registered.';
    if (allWallets.findIndex((x) => sameAddr(x, w)) !== i) return 'Duplicate wallet.';
    return null;
  };
  const walletsOk = !!creator && allWallets.every((w, i) => (i === 0 ? true : !!w && !walletErr(w, i)));
  const total = allWallets.reduce((s, w) => s + (isAddr(w) ? balances?.get(w.toLowerCase()) ?? BigInt(0) : BigInt(0)), BigInt(0));

  // amounts
  const decimals = info?.decimals ?? 18;
  let bondWei: bigint | null = null;
  try { if (/^\d*\.?\d+$|^\d+\.$/.test(bondEth.trim())) bondWei = parseEther(bondEth.trim()); } catch { bondWei = null; }
  const minBond = info?.minBond ?? parseEther('0.01');
  const bondErr = bondWei == null ? 'Enter a valid ETH amount.' : bondWei < minBond ? `Minimum bond is ${formatEther(minBond)} ETH.` : null;

  const p = PRESETS.find((x) => x.id === preset);
  const durD = p ? p.days : toInt(customDays);
  const durErr = Number.isNaN(durD) || durD < MIN_DURATION_DAYS || durD > MAX_DURATION_DAYS ? `Duration must be ${MIN_DURATION_DAYS} to ${MAX_DURATION_DAYS} days.` : null;
  const durSec = durErr ? 0 : durD * DAY;

  let committedWei: bigint | null = null;
  try { if (committed.trim() && /^\d*\.?\d*$/.test(committed.trim())) committedWei = parseUnits(committed.trim(), decimals); } catch { committedWei = null; }
  const committedErr = !committed.trim() ? null
    : committedWei == null || committedWei <= BigInt(0) ? 'Enter a valid amount.'
    : committedWei > total ? "Committed amount exceeds the registered wallets' total."
    : null;
  const floor = committedWei && committedWei > BigInt(0) ? floorOf(committedWei, allowanceBps) : BigInt(0);
  const badgeAmountOk = bondWei != null && bondWei >= parseEther('0.1');
  const badgeDurOk = !durErr && durSec >= 90 * DAY;
  const badgeOk = bondWei != null && !durErr && inputsMeetBadge(bondWei, durSec);

  const ready = formOn && !bondErr && !durErr && walletsOk && committedWei != null && committedWei > BigInt(0) && !committedErr;

  const { send, pending } = useBondTx();
  const submit = async () => {
    if (!factory || !ready || !bondWei || !committedWei) return;
    const r = await send({
      key: 'create', address: factory, abi: BOND_FACTORY_ABI, functionName: 'createBond',
      args: [token as Addr, allWallets as Addr[], committedWei, BigInt(allowanceBps), BigInt(durSec)],
      value: bondWei, fn: 'createBond', success: 'Bond created',
    });
    if (!r) return;
    try {
      const ev = parseEventLogs({ abi: BOND_FACTORY_ABI, eventName: 'BondCreated', logs: r.logs });
      const bond = (ev[0]?.args as { bond?: Addr } | undefined)?.bond;
      if (bond) { router.push(`/bond/${bond}`); return; }
    } catch (e) {
      console.error('BondCreated parse failed', e);
    }
    toast.message('Bond created. Find it on the token page.');
    router.push(`/token/${token}`);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <p className="text-[12px] uppercase tracking-wider text-white/55">Creator bond</p>
      <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Post a bond</h1>
      <p className="mt-2 text-[13px] text-white/65">
        Put up ETH against a token balance floor for the wallets you register. Your wallet signs every transaction on Robinhood Chain.
      </p>

      <BondNote className="mt-6" showContract />
      {!live && <BondNotLive className="mt-4" />}

      <div className="glass-card mt-4 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-white">What happens</h2>
        <Outcome className="mt-2" />
      </div>

      <fieldset disabled={!live} className="mt-4 space-y-4 disabled:opacity-70">
        {/* Token */}
        <section className={section}>
          <h2 className="text-[14px] font-semibold text-white">Token</h2>
          <div className="space-y-1.5">
            <label htmlFor="bond-pick" className={label}>Pick a Polypad token</label>
            <select
              id="bond-pick" className={selectCls}
              value={picker.find((l) => sameAddr(l.tokenAddress, token))?.tokenAddress ?? ''}
              onChange={(e) => setTokenInput(e.target.value)}
            >
              <option value="" className="bg-neutral-900">Select a token</option>
              {picker.map((l) => (
                <option key={l.tokenAddress} value={l.tokenAddress} className="bg-neutral-900">{l.symbol} · {l.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bond-token" className={label}>Or paste a token address</label>
            <Input id="bond-token" placeholder="0x…" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} className="font-mono text-[13px]" spellCheck={false} />
          </div>
          {token && isPolydashToken(token) && <p className="text-[12px] text-amber-300">{NOT_POLYPAD_TOKEN}</p>}
          {token && !isAddr(token) && <p className="text-[12px] text-amber-300">Enter a valid token address.</p>}
          {tokenValid && live && (infoLoading ? (
            <p className="flex items-center gap-2 text-[12px] text-white/55"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking token…</p>
          ) : infoError ? (
            <p className="text-[12px] text-white/55">Could not read this token right now.</p>
          ) : info && !info.isPolypad ? (
            <p className="text-[12px] text-amber-300">{NOT_POLYPAD_TOKEN}</p>
          ) : info ? (
            <>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.03] p-3 text-[12px] ring-1 ring-white/[0.06] sm:grid-cols-4">
                <div><p className="text-white/50">Name</p><p className="truncate text-white">{info.name || '—'}</p></div>
                <div><p className="text-white/50">Symbol</p><p className="text-white">{info.symbol || '—'}</p></div>
                <div><p className="text-white/50">Decimals</p><p className="font-mono text-white">{info.decimals}</p></div>
                <div><p className="text-white/50">Creator balance</p><p className="font-mono text-white">{formatTokens(info.creatorBalance, info.decimals)}</p></div>
              </div>
              <p className="text-[11px] text-white/50">Launch creator <span className="font-mono">{info.creator ? shortenAddress(info.creator) : '—'}</span></p>
              {isConnected && !isCreator && <p className="text-[12px] text-amber-300">{NOT_CREATOR}</p>}
            </>
          ) : null)}
        </section>

        <fieldset disabled={!formOn} className="space-y-4 disabled:opacity-60">
          {/* Bond + duration */}
          <section className={section}>
            <h2 className="text-[14px] font-semibold text-white">Bond and duration</h2>
            <div className="space-y-1.5">
              <label htmlFor="bond-eth" className={label}>Bond amount (ETH)</label>
              <Input id="bond-eth" inputMode="decimal" placeholder="0.1" value={bondEth} onChange={(e) => setBondEth(e.target.value)} className="font-mono" />
              <p className="text-[11px] text-white/50">Minimum {formatEther(minBond)} ETH. Sent with the create transaction and held by the bond contract.</p>
              {bondEth.trim() && bondErr && <p className="text-[12px] text-amber-300">{bondErr}</p>}
            </div>
            <div className="space-y-2">
              <p className={label}>Duration</p>
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
              {preset === 'custom' && (
                <div className="space-y-1.5">
                  <label htmlFor="bond-days" className={label}>Days ({MIN_DURATION_DAYS} to {MAX_DURATION_DAYS})</label>
                  <Input id="bond-days" inputMode="numeric" value={customDays} onChange={(e) => setCustomDays(e.target.value)} className="font-mono" />
                </div>
              )}
              {durErr && <p className="text-[12px] text-amber-300">{durErr}</p>}
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
              <p className="text-[12px] text-white/75">{BADGE_HINT}</p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                <Req met={badgeAmountOk}>At least 0.1 ETH</Req>
                <Req met={badgeDurOk}>At least 90 days</Req>
              </ul>
              <p className={cn('mt-2 text-[12px] font-medium', badgeOk ? 'text-polydash-green' : 'text-white/60')}>
                {badgeOk ? 'These inputs meet the badge minimum once the bond is Active.' : 'These inputs do not meet the badge minimum.'}
              </p>
            </div>
          </section>

          {/* Wallets */}
          <section className={section}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-white">Registered wallets</h2>
              <span className="text-[11px] text-white/50">{allWallets.length} of {MAX_WALLETS}</span>
            </div>
            <p className="text-[12px] text-white/60">{WALLETS_NOTE}</p>
            <ul className="space-y-2">
              {allWallets.map((w, i) => {
                const err = i === 0 ? null : walletErr(w, i);
                const bal = isAddr(w) ? balances?.get(w.toLowerCase()) : undefined;
                return (
                  <li key={i} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
                    <div className="flex items-center gap-2">
                      {i === 0 ? (
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <Lock className="h-3.5 w-3.5 shrink-0 text-white/45" strokeWidth={1.5} />
                          <span className="truncate font-mono text-[12px] text-white">{w || 'Creator wallet'}</span>
                          <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/60">Creator</span>
                        </div>
                      ) : (
                        <Input aria-label={`Wallet ${i + 1}`} placeholder="0x…" value={w} spellCheck={false} className="h-9 flex-1 font-mono text-[12px]"
                          onChange={(e) => setExtra((xs) => xs.map((x, j) => (j === i - 1 ? e.target.value : x)))} />
                      )}
                      <span className="shrink-0 font-mono text-[12px] text-white/70">{bal != null ? formatTokens(bal, decimals) : '—'}</span>
                      {i > 0 && (
                        <button type="button" onClick={() => setExtra((xs) => xs.filter((_, j) => j !== i - 1))}
                          className="rounded-lg p-1.5 text-white/55 hover:bg-white/10 hover:text-white" aria-label={`Remove wallet ${i + 1}`}>
                          <X className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                    {err && <p className="mt-1 text-[11px] text-amber-300">{err}</p>}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={allWallets.length >= MAX_WALLETS}
                onClick={() => setExtra((xs) => [...xs, ''])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add wallet
              </Button>
              <p className="text-[12px] text-white/70">Total <span className="font-mono text-white">{formatTokens(total, decimals)} {info?.symbol}</span></p>
            </div>
          </section>

          {/* Commitment */}
          <section className={section}>
            <h2 className="text-[14px] font-semibold text-white">Commitment</h2>
            <div className="space-y-1.5">
              <label htmlFor="bond-committed" className={label}>Committed amount ({info?.symbol || 'tokens'})</label>
              <div className="flex gap-2">
                <Input id="bond-committed" inputMode="decimal" placeholder="0.0" value={committed} onChange={(e) => setCommitted(e.target.value)} className="font-mono" />
                <Button type="button" variant="outline" className="rounded-full" disabled={total === BigInt(0)}
                  onClick={() => setCommitted(formatUnits(total, decimals))}>Max</Button>
              </div>
              <p className="text-[11px] text-white/50">Max is the registered wallets&apos; current total. The total must be at least the committed amount.</p>
              {committedErr && <p className="text-[12px] text-amber-300">{committedErr}</p>}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="bond-allow" className={label}>Allowance</label>
                <span className="font-mono text-[13px] text-white">{(allowanceBps / 100).toFixed(1)}%</span>
              </div>
              <input id="bond-allow" type="range" min={0} max={MAX_ALLOWANCE_BPS} step={50} value={allowanceBps}
                onChange={(e) => setAllowanceBps(Number(e.target.value))} className="w-full accent-[#00E676]" />
              <p className="text-[11px] text-white/50">How much of the committed amount the registered wallets may move. 0% to {MAX_ALLOWANCE_BPS / 100}%.</p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
              <p className="text-[11px] text-white/55">Floor</p>
              <p className="mt-1 font-mono text-[15px] text-white">{formatTokens(floor, decimals)} {info?.symbol}</p>
              <p className="mt-1 text-[12px] text-white/70">{floorSentence(formatTokens(floor, decimals), info?.symbol || 'tokens')}</p>
            </div>
          </section>
        </fieldset>

        <Limitations />

        <div className="glass-card space-y-3 p-4 sm:p-5">
          {!isConnected ? (
            <ConnectButton.Custom>{({ openConnectModal }) => <Button type="button" className="w-full rounded-full" onClick={openConnectModal} disabled={!live}>Connect wallet</Button>}</ConnectButton.Custom>
          ) : (
            <Button type="button" className="w-full rounded-full" onClick={submit} disabled={!ready || !!pending}>
              {pending === 'create' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Post bond{bondWei && !bondErr ? ` (${formatEther(bondWei)} ETH)` : ''}
            </Button>
          )}
          <p className="text-center text-[11px] text-white/50">Creates the bond in Pending. It activates once every registered wallet has confirmed.</p>
        </div>
      </fieldset>
    </div>
  );
}
