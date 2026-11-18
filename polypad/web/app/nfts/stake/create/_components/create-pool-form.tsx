'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useReadContracts } from 'wagmi';
import { parseEventLogs, parseUnits, type Abi } from 'viem';
import { ArrowLeft, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { robinhoodChain } from '@/lib/chain';
import { formatTokens, shortenAddress } from '@/lib/format';
import { proxiedImage } from '@/lib/sanitize';
import { useNftCollections } from '@/lib/hooks/use-nft-collections';
import { useCurveCollections } from '@/lib/hooks/use-curve-collections';
import { useCollectionCheck, useStakingTx } from '@/lib/hooks/use-nft-staking';
import { NftStakingFactoryABI } from '@/lib/contracts/nft-staking-factory-abi';
import { NftStakingPoolABI } from '@/lib/contracts/nft-staking-pool-abi';
import {
  DAY, DEFAULT_DURATION_DAYS, DEFAULT_REWARD_AMOUNT, DEFAULT_SET, DEFAULT_TIERS, Erc20MiniABI, MAX_DURATION_DAYS, MIN_DURATION_DAYS,
  NFT_STAKING_FACTORY_ADDRESS, NO_TIERS, POLYDASH_TOKEN, isAddr, type Addr,
} from '@/lib/nftStaking';
import { CollectionTag, FactoryMissing, RiskNote } from '@/components/nft-staking/notes';
import { BoostEditor, validateSet, validateTiers, type TierRow } from './boost-editor';

const FACTORY = NFT_STAKING_FACTORY_ADDRESS as Addr | null;
const field = 'h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-polydash-green/50';
const label = 'text-[12px] font-medium text-white/70';

function toLocalInput(sec: number) {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Check({ ok, text, pending }: { ok: boolean | null; text: string; pending?: boolean }) {
  return (
    <li className="flex items-center gap-2 text-[12px]">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white/55" /> : ok ? <CheckCircle2 className="h-3.5 w-3.5 text-polydash-green" strokeWidth={1.75} /> : ok === false ? <XCircle className="h-3.5 w-3.5 text-red-400" strokeWidth={1.75} /> : <Circle className="h-3.5 w-3.5 text-white/35" strokeWidth={1.5} />}
      <span className={ok === false ? 'text-red-300' : 'text-white/70'}>{text}</span>
    </li>
  );
}

function Step({ n, title, state }: { n: number; title: string; state: 'todo' | 'active' | 'done' }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ring-1',
        state === 'done' ? 'bg-polydash-green text-black ring-polydash-green' : state === 'active' ? 'text-white ring-white/40' : 'text-white/45 ring-white/15')}>{n}</span>
      <span className={cn('text-[12px]', state === 'todo' ? 'text-white/55' : 'text-white')}>{title}</span>
    </div>
  );
}

export function CreatePoolForm({ initialCollection }: { initialCollection: string }) {
  const { address: user, isConnected } = useAccount();
  const { data: fixedCols } = useNftCollections();
  const { data: curveCols } = useCurveCollections();
  const { send, pending } = useStakingTx();

  const [collection, setCollection] = useState(initialCollection);
  const [rewardToken, setRewardToken] = useState<string>(POLYDASH_TOKEN);
  const [amount, setAmount] = useState(DEFAULT_REWARD_AMOUNT);
  const [start, setStart] = useState('');
  const [days, setDays] = useState(String(DEFAULT_DURATION_DAYS));
  const [loyalty, setLoyalty] = useState(true);
  const [tiers, setTiers] = useState<TierRow[]>(DEFAULT_TIERS.map((t) => ({ days: String(t.days), mult: String(t.mult) })));
  const [setOn, setSetOn] = useState(true);
  const [setMin, setSetMin] = useState(String(DEFAULT_SET.min));
  const [setPct, setSetPct] = useState(String(DEFAULT_SET.bonusPct));
  const [created, setCreated] = useState<Addr | null>(null);
  const [fundAmount, setFundAmount] = useState('');
  const [funded, setFunded] = useState(false);

  useEffect(() => { setStart(toLocalInput(Math.floor(Date.now() / 1000) + 600)); }, []);

  const polypadOptions = useMemo(() => [
    ...(fixedCols ?? []).map((c) => ({ address: c.address, name: c.name, symbol: c.symbol })),
    ...(curveCols ?? []).map((c) => ({ address: c.address, name: c.name, symbol: c.symbol })),
  ], [fixedCols, curveCols]);

  const check = useCollectionCheck(isAddr(collection) ? collection : undefined);
  const c = check.data;
  const collectionOk = !!c && c.isContract && c.isErc721 && c.allowed === true;

  const tokenValid = isAddr(rewardToken);
  const tokenReads = useReadContracts({
    allowFailure: true,
    query: { enabled: tokenValid, refetchInterval: 15_000 },
    contracts: tokenValid ? [
      { address: rewardToken as Addr, abi: Erc20MiniABI, functionName: 'symbol', chainId: robinhoodChain.id },
      { address: rewardToken as Addr, abi: Erc20MiniABI, functionName: 'decimals', chainId: robinhoodChain.id },
      ...(user ? [
        { address: rewardToken as Addr, abi: Erc20MiniABI, functionName: 'balanceOf', args: [user], chainId: robinhoodChain.id },
        ...(FACTORY ? [{ address: rewardToken as Addr, abi: Erc20MiniABI, functionName: 'allowance', args: [user, FACTORY], chainId: robinhoodChain.id }] : []),
        ...(created ? [{ address: rewardToken as Addr, abi: Erc20MiniABI, functionName: 'allowance', args: [user, created], chainId: robinhoodChain.id }] : []),
      ] : []),
    ] as any : [],
  });
  const tr = tokenReads.data ?? [];
  const tSym = tr[0]?.status === 'success' ? String(tr[0].result) : '';
  const tDec = tr[1]?.status === 'success' ? Number(tr[1].result) : null;
  const tBal = tr[2]?.status === 'success' ? (tr[2].result as bigint) : null;
  const allowFactory = FACTORY && tr[3]?.status === 'success' ? (tr[3].result as bigint) : BigInt(0);
  const allowPool = created ? (tr[FACTORY ? 4 : 3]?.status === 'success' ? (tr[FACTORY ? 4 : 3].result as bigint) : BigInt(0)) : BigInt(0);

  const parsed = (v: string) => { try { return tDec == null || !v.trim() ? null : parseUnits(v.replace(/,/g, '').trim() as `${number}`, tDec); } catch { return null; } };
  const amountWei = parsed(amount);
  const fundWei = parsed(fundAmount);
  const startSec = start ? Math.floor(new Date(start).getTime() / 1000) : 0;
  const durDays = Number(days);

  const errors: string[] = [];
  if (!isAddr(collection)) errors.push('Enter a collection address.');
  else if (c && !collectionOk) errors.push('This collection cannot be used.');
  if (!tokenValid) errors.push('Enter a reward token address.');
  else if (tDec == null) errors.push('The reward token could not be read.');
  if (amountWei == null || amountWei <= BigInt(0)) errors.push('Enter a reward amount above zero.');
  else if (tBal != null && amountWei > tBal) errors.push(`Your ${tSym || 'token'} balance is too low.`);
  if (!Number.isInteger(durDays) || durDays < MIN_DURATION_DAYS || durDays > MAX_DURATION_DAYS) errors.push(`Duration must be ${MIN_DURATION_DAYS} to ${MAX_DURATION_DAYS} whole days.`);
  if (!startSec || startSec < Math.floor(Date.now() / 1000) - 60) errors.push('Start time must be in the future.');
  const tierErr = loyalty ? validateTiers(tiers) : null;
  const setErr = setOn ? validateSet(setMin, setPct) : null;
  if (tierErr) errors.push(tierErr);
  if (setErr) errors.push(setErr);

  const needsApprove = amountWei != null && allowFactory < amountWei;
  const step = created ? (funded ? 4 : 3) : needsApprove ? 1 : 2;

  const create = async () => {
    if (!FACTORY || amountWei == null || errors.length) return;
    if (needsApprove) {
      const r = await send({ key: 'approve', address: rewardToken as Addr, abi: Erc20MiniABI, functionName: 'approve', args: [FACTORY, amountWei], fn: 'approve', success: 'Reward token approved' });
      if (!r) return;
      await tokenReads.refetch();
    }
    const boosted = loyalty || setOn;
    const tierAfter = loyalty ? tiers.map((t) => Math.round(Number(t.days) * DAY)) : NO_TIERS.tierAfter;
    const tierBps = loyalty ? tiers.map((t) => Math.round(Number(t.mult) * 10_000)) : NO_TIERS.tierBps;
    const base = [collection as Addr, rewardToken as Addr, amountWei, BigInt(startSec), BigInt(durDays * DAY)] as const;
    const r = await send(boosted ? {
      key: 'create', address: FACTORY, abi: NftStakingFactoryABI as Abi, functionName: 'createBoostedPool', fn: 'createBoostedPool', success: 'Pool created',
      args: [...base, { tierAfter, tierBps, setMin: setOn ? Number(setMin) : 0, setBonusBps: setOn ? Math.round(Number(setPct) * 100) : 0 }],
    } : { key: 'create', address: FACTORY, abi: NftStakingFactoryABI as Abi, functionName: 'createPool', fn: 'createPool', args: [...base], success: 'Pool created' });
    if (!r) return;
    const ev = parseEventLogs({ abi: NftStakingFactoryABI, eventName: 'PoolCreated', logs: r.logs });
    const pool = (ev[0]?.args as any)?.pool as Addr | undefined;
    if (pool) setCreated(pool);
  };

  const fund = async () => {
    if (!created || fundWei == null || fundWei <= BigInt(0)) return;
    if (allowPool < fundWei) {
      const a = await send({ key: 'approve-fund', address: rewardToken as Addr, abi: Erc20MiniABI, functionName: 'approve', args: [created, fundWei], fn: 'approve', success: 'Approved for funding' });
      if (!a) return;
    }
    const r = await send({ key: 'fund', address: created, abi: NftStakingPoolABI as Abi, functionName: 'fund', args: [fundWei], fn: 'fund', success: 'Pool funded' });
    if (r) setFunded(true);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <Link href="/nfts/stake" className="inline-flex items-center gap-1 text-[12px] text-white/55 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />NFT staking</Link>
      <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Create a staking pool</h1>
      <p className="mt-2 text-[13px] text-white/65">Reward holders of any ERC-721 collection with a token of your choice. Rewards stream evenly from start to end.</p>
      <RiskNote className="mt-6" />

      {!FACTORY && <FactoryMissing className="mt-6" />}

      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
        <Step n={1} title="Approve reward token" state={step > 1 ? 'done' : 'active'} />
        <Step n={2} title="Create pool" state={step > 2 ? 'done' : step === 2 ? 'active' : 'todo'} />
        <Step n={3} title="Fund more (optional)" state={step > 3 ? 'done' : step === 3 ? 'active' : 'todo'} />
      </div>

      {!created ? (
        <div className="mt-6 space-y-6">
          <section className="glass-card space-y-3 p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-white">Collection</h2>
            <div className="space-y-1.5">
              <label className={label} htmlFor="col">ERC-721 contract address</label>
              <input id="col" className={cn(field, 'font-mono')} placeholder="0x..." value={collection} onChange={(e) => setCollection(e.target.value.trim())} spellCheck={false} />
            </div>
            {polypadOptions.length > 0 && (
              <div className="space-y-1.5">
                <label className={label} htmlFor="pp">Or pick a Polypad collection</label>
                <select id="pp" className={field} value={polypadOptions.some((o) => o.address.toLowerCase() === collection.toLowerCase()) ? collection : ''} onChange={(e) => e.target.value && setCollection(e.target.value)}>
                  <option value="">Select a collection</option>
                  {polypadOptions.map((o) => <option key={o.address} value={o.address}>{o.name} ({o.symbol})</option>)}
                </select>
              </div>
            )}
            {isAddr(collection) && (
              <div className="flex gap-4 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
                  {c?.image && proxiedImage(c.image) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proxiedImage(c.image)} alt={`Sample token from ${c.name || 'this collection'}`} className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {c && <p className="truncate text-[14px] font-medium text-white">{c.name || 'Unnamed collection'} {c.symbol && <span className="text-white/55">({c.symbol})</span>}</p>}
                  {c?.isErc721 && <CollectionTag polypad={c.polypad} />}
                  <ul className="space-y-1">
                    <Check pending={check.isLoading} ok={c ? c.isContract : null} text="Is a contract" />
                    <Check pending={check.isLoading} ok={c ? (c.isContract ? c.isErc721 : false) : null} text="Supports ERC-721 (0x80ac58cd)" />
                    <Check pending={check.isLoading} ok={c ? (FACTORY ? c.allowed === true : null) : null} text={FACTORY ? 'Allowed by the staking factory' : 'Factory check runs once the factory is deployed'} />
                  </ul>
                  {check.isError && <p className="text-[12px] text-red-300">Could not read this address. Check it and try again.</p>}
                </div>
              </div>
            )}
          </section>

          <section className="glass-card space-y-4 p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-white">Rewards</h2>
            <div className="space-y-1.5">
              <label className={label} htmlFor="rt">Reward token address</label>
              <input id="rt" className={cn(field, 'font-mono')} value={rewardToken} onChange={(e) => setRewardToken(e.target.value.trim())} spellCheck={false} />
              <p className="text-[11px] text-white/55">
                {rewardToken.toLowerCase() === POLYDASH_TOKEN.toLowerCase() ? 'POLYDASH (default). ' : tSym ? `${tSym}. ` : ''}
                {tBal != null && tDec != null ? `Your balance: ${formatTokens(tBal, tDec)} ${tSym}` : ''}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className={label} htmlFor="amt">Reward amount {tSym && `(${tSym})`}</label>
                <input id="amt" className={cn(field, 'font-mono')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className={label} htmlFor="dur">Duration (days, {MIN_DURATION_DAYS} to {MAX_DURATION_DAYS})</label>
                <input id="dur" className={cn(field, 'font-mono')} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className={label} htmlFor="st">Start time (your local time)</label>
                <input id="st" type="datetime-local" className={cn(field, 'font-mono [color-scheme:dark]')} value={start} onChange={(e) => setStart(e.target.value)} />
                {startSec > 0 && Number.isInteger(durDays) && durDays > 0 && (
                  <p className="text-[11px] text-white/55">Ends {new Date((startSec + durDays * DAY) * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                )}
              </div>
            </div>
          </section>

          <section className="glass-card space-y-3 p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-white">Boosts</h2>
            <BoostEditor loyalty={loyalty} setLoyalty={setLoyalty} tiers={tiers} setTiers={setTiers} setOn={setOn} setSetOn={setSetOn} setMin={setMin} setSetMin={setSetMin} setPct={setPct} setSetPct={setSetPct} />
          </section>

          <section className="glass-card space-y-3 p-4 sm:p-5">
            {errors.length > 0 && isConnected && (
              <ul className="space-y-1">{errors.map((e) => <li key={e} className="text-[12px] text-amber-300">{e}</li>)}</ul>
            )}
            {!isConnected ? (
              <ConnectButton.Custom>{({ openConnectModal }) => <Button className="w-full rounded-full" onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>
            ) : (
              <Button className="w-full rounded-full" disabled={!FACTORY || errors.length > 0 || !!pending} onClick={create}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {needsApprove ? `Approve ${tSym || 'token'} and create pool` : 'Create pool'}
              </Button>
            )}
            <p className="text-[11px] text-white/55">Your wallet signs each step. The reward amount moves from your wallet into the pool when it is created.</p>
          </section>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <section className="glass-card space-y-3 p-4 sm:p-5">
            <p className="text-[15px] font-semibold text-white">Pool created</p>
            <p className="break-all font-mono text-[12px] text-white/70">{created}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="rounded-full"><Link href={`/nfts/stake/${created}`}>Open pool</Link></Button>
              <Button asChild variant="outline" className="rounded-full"><Link href="/nfts/stake">All pools</Link></Button>
            </div>
          </section>
          <section className="glass-card space-y-3 p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-white">Add more rewards (optional)</h2>
            <p className="text-[12px] text-white/55">Funding adds to the rewards streamed over the remaining time. Pool {shortenAddress(created)}.</p>
            <div className="flex gap-2">
              <input className={cn(field, 'font-mono')} inputMode="decimal" placeholder={`Amount (${tSym || 'tokens'})`} value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
              <Button className="rounded-full" disabled={!!pending || fundWei == null || fundWei <= BigInt(0) || (tBal != null && fundWei > tBal)} onClick={fund}>
                {pending === 'fund' || pending === 'approve-fund' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fund'}
              </Button>
            </div>
            {funded && <p className="text-[12px] text-polydash-green">Pool funded.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
