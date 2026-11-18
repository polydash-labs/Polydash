'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatEther, parseEther, parseUnits } from 'viem';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useNow } from '@/lib/hooks/use-nft-collections';
import { useCreatorTokens, useGateToken, type GateToken } from '@/lib/hooks/use-gated-mint';
import {
  DURATION_PRESETS, MAX_HOLDER_DURATION, MAX_PER_WALLET, MAX_PRICE, MAX_START_AHEAD, MIN_HOLDER_DURATION, MIN_PRICE, NOT_ELIGIBLE,
  PLATFORM_FEE_BPS, ZERO_ADDRESS, isAddr, isPolydashToken, type Addr,
} from '@/lib/gatedMint';
import { GatedNote, HolderCheckNote } from '@/components/gated/notes';

const label = 'text-xs text-muted-foreground mb-1 block';
const ZERO = BigInt(0);
const BPS = BigInt(10000);

function price(s: string): bigint | null {
  try {
    const v = parseEther(s.trim() || '0');
    return v >= MIN_PRICE && v <= MAX_PRICE ? v : null;
  } catch { return null; }
}
const int = (s: string) => { const n = Number(s); return Number.isInteger(n) ? n : NaN; };

export type HolderSettings = ReturnType<typeof useHolderSettings>;

/** State, validation and createCollection args for the "Holder mint" sale type. */
export function useHolderSettings(o: { supplyN: number; supplyOk: boolean; floorBps: number; initialToken?: string | null }) {
  const creatorTokens = useCreatorTokens();
  const now = useNow();
  const [tokenInput, setTokenInput] = useState(o.initialToken && !isPolydashToken(o.initialToken) ? o.initialToken : '');
  const [gatedOn, setGatedOn] = useState(true);
  const [minBalance, setMinBalance] = useState('');
  const [holderPrice, setHolderPrice] = useState('0.001');
  const [publicPrice, setPublicPrice] = useState('0.002');
  const [holderOnly, setHolderOnly] = useState(false);
  const [openPrice, setOpenPrice] = useState('0.001');
  const [startMode, setStartMode] = useState<'now' | 'date'>('now');
  const [startDate, setStartDate] = useState('');
  const [duration, setDuration] = useState<number | 'custom'>(86_400);
  const [customHours, setCustomHours] = useState('48');
  const [holderMax, setHolderMax] = useState('2');
  const [maxPerWallet, setMaxPerWallet] = useState('5');
  const [payout, setPayout] = useState('');

  const token = tokenInput.trim();
  const check = useGateToken(isAddr(token) ? token : null);
  const gate: GateToken | undefined = check.data;
  const eligible = (creatorTokens.data?.length ?? 0) > 0;
  const tokenErr = !token ? 'Pick or paste a linked token.'
    : !isAddr(token) ? 'Enter a valid token address.'
    : isPolydashToken(token) ? 'POLYDASH is not a launch token.'
    : check.isLoading ? null
    : check.error ? 'Could not check this token. Try again.'
    : !gate?.launch ? 'This token was not launched on Polypad.'
    : !gate.isCreator ? NOT_ELIGIBLE
    : null;
  const tokenOk = !tokenErr && !check.isLoading && !!gate?.isCreator;

  const decimals = gate?.decimals ?? 18;
  const minBalWei = useMemo(() => { try { return minBalance.trim() ? parseUnits(minBalance.trim(), decimals) : ZERO; } catch { return null; } }, [minBalance, decimals]);
  const hPrice = price(holderPrice);
  const pPrice = holderOnly ? ZERO : price(publicPrice);
  const oPrice = price(openPrice);
  const mpw = int(maxPerWallet);
  const hMax = int(holderMax);
  const durSec = duration === 'custom' ? int(customHours) * 3600 : duration;
  const startTs = startMode === 'date' && startDate ? Math.floor(new Date(startDate).getTime() / 1000) : NaN;

  const startErr = startMode === 'now' ? null
    : !Number.isFinite(startTs) ? 'Pick a start date and time.'
    : now != null && startTs <= now ? 'Start must be in the future, or choose Now.'
    : now != null && startTs > now + MAX_START_AHEAD ? 'Start must be within 30 days.'
    : null;
  const mpwErr = !Number.isFinite(mpw) || mpw < 1 || mpw > MAX_PER_WALLET ? 'Max per wallet must be 1 to 100.'
    : o.supplyOk && mpw > o.supplyN ? 'Max per wallet cannot be above supply.' : null;

  const error: string | null = !o.supplyOk ? 'Supply must be a whole number from 1 to 10,000.'
    : tokenErr ?? (check.isLoading ? 'Checking token…' : null)
    ?? (gatedOn ? (
      minBalWei == null || minBalWei <= ZERO ? `Minimum balance must be above 0 ${gate?.symbol ?? 'tokens'}.`
      : !hPrice ? 'Holder price must be between 0.00001 and 100 ETH.'
      : !holderOnly && !pPrice ? 'Public price must be between 0.00001 and 100 ETH.'
      : !holderOnly && pPrice != null && hPrice != null && pPrice < hPrice ? 'Public price must be at least the holder price.'
      : startErr
      ?? (!Number.isFinite(durSec) || durSec < MIN_HOLDER_DURATION || durSec > MAX_HOLDER_DURATION ? 'Holder phase must be 1 hour to 30 days.' : null)
      ?? mpwErr
      ?? (!Number.isFinite(hMax) || hMax < 1 || (Number.isFinite(mpw) && hMax > mpw) ? 'Holder mints per wallet must be 1 to max per wallet.' : null)
    ) : (
      !oPrice ? 'Mint price must be between 0.00001 and 100 ETH.' : startErr ?? mpwErr
    ))
    ?? (payout.trim() && !isAddr(payout.trim()) ? 'Payout wallet must be a valid address, or leave it blank.' : null);

  const valid = !error;
  const holderP = gatedOn ? hPrice ?? ZERO : ZERO;
  const publicP = gatedOn ? pPrice ?? ZERO : oPrice ?? ZERO;
  const lower = gatedOn ? (publicP > ZERO && publicP < holderP ? publicP : holderP) : publicP;
  const floorWei = (lower * BigInt(o.floorBps)) / BPS;
  const split = (p: bigint) => {
    const fee = (p * BigInt(PLATFORM_FEE_BPS)) / BPS;
    return { fee, creator: p > floorWei + fee ? p - floorWei - fee : ZERO };
  };

  const durationLabel = Number.isFinite(durSec) ? (DURATION_PRESETS.find((d) => d.value === durSec)?.label ?? `${durSec / 3600} hours`) : '';
  const startLabel = startMode === 'now' ? 'When the collection is created' : startDate ? `${new Date(startDate).toLocaleString('en-US')}` : '';

  const reviewRows: [string, string][] = [
    ['Sale type', gatedOn ? 'Holder mint' : 'Holder mint (open mint)'],
    ['Linked token', gate?.symbol ? `${gate.symbol} (${token.slice(0, 6)}…${token.slice(-4)})` : token],
    ...(gatedOn ? [
      ['Minimum balance', `${minBalance} ${gate?.symbol ?? ''}`.trim()],
      ['Holder price', `${formatEther(holderP)} ETH`],
      ['Public price', holderOnly ? 'Holder-only, no public mint' : `${formatEther(publicP)} ETH`],
      ['Holder phase start', startLabel],
      ['Holder phase length', durationLabel],
      ['Holder mints per wallet', String(hMax)],
    ] as [string, string][] : [
      ['Mint price', `${formatEther(publicP)} ETH`],
      ['Mint start', startLabel],
    ] as [string, string][]),
    ['Max per wallet', String(mpw)],
    ['Floor vault', `${o.floorBps / 100}% of ${formatEther(lower)} ETH = ${formatEther(floorWei)} ETH per NFT`],
    ['Payout wallet', payout.trim() || 'Your wallet'],
  ];

  const buildArgs = (base: { name: string; symbol: string; imageUri: string; description: string; baseURI: string; royaltyBps: number }) => ({
    ...base,
    maxSupply: BigInt(o.supplyN),
    holderPrice: holderP,
    publicPrice: publicP,
    floorBps: BigInt(o.floorBps),
    royaltyBps: BigInt(base.royaltyBps),
    holderMaxPerWallet: gatedOn ? BigInt(hMax) : ZERO,
    maxPerWallet: BigInt(mpw),
    gateToken: token as Addr,
    minBalance: gatedOn ? minBalWei ?? ZERO : ZERO,
    holderStart: startMode === 'now' ? ZERO : BigInt(startTs),
    holderDuration: gatedOn ? BigInt(durSec) : ZERO,
    payoutWallet: (payout.trim() || ZERO_ADDRESS) as Addr,
  });

  return {
    creatorTokens, eligible, check, gate, tokenInput, setTokenInput, tokenErr, tokenOk,
    gatedOn, setGatedOn, minBalance, setMinBalance, holderPrice, setHolderPrice, publicPrice, setPublicPrice, holderOnly, setHolderOnly,
    openPrice, setOpenPrice, startMode, setStartMode, startDate, setStartDate, duration, setDuration, customHours, setCustomHours,
    holderMax, setHolderMax, maxPerWallet, setMaxPerWallet, payout, setPayout,
    error, valid, holderP, publicP, floorWei, split, reviewRows, buildArgs,
  };
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('h-9 rounded-full border px-3 text-[12px] font-medium transition-colors sm:text-[13px]',
        active ? 'border-primary bg-primary/10 text-primary' : 'border-white/10 bg-secondary/40 text-muted-foreground hover:text-foreground')}>
      {children}
    </button>
  );
}

/** Linked token + gate settings. Supply, floor and royalty stay in the wizard. */
export function HolderSettingsFields({ h }: { h: HolderSettings }) {
  const list = h.creatorTokens.data ?? [];
  const picked = list.some((t) => t.address.toLowerCase() === h.tokenInput.trim().toLowerCase());
  const only = list.length === 1 ? list[0].address : null;
  const { tokenInput, setTokenInput } = h;
  useEffect(() => {
    if (!tokenInput && only) setTokenInput(only);
  }, [only, tokenInput, setTokenInput]);

  return (
    <div className="space-y-4">
      <GatedNote />
      <div>
        <label className={label}>Linked token *</label>
        {list.length > 0 && (
          <select value={picked ? h.tokenInput : ''} onChange={(e) => h.setTokenInput(e.target.value)}
            className="mb-2 h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 text-[16px] sm:text-sm">
            <option value="">Choose one of your tokens…</option>
            {list.map((t) => <option key={t.address} value={t.address}>{t.symbol || t.name} · {t.address.slice(0, 6)}…{t.address.slice(-4)}</option>)}
          </select>
        )}
        <Input value={h.tokenInput} onChange={(e) => h.setTokenInput(e.target.value)} placeholder="or paste a token address 0x…" className="bg-secondary/50 font-mono" />
        {h.check.isLoading ? (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking launch creator…</p>
        ) : h.tokenInput && h.tokenErr ? (
          <p className="mt-1 text-[11px] text-red-300">{h.tokenErr}</p>
        ) : h.tokenOk ? (
          <p className="mt-1 text-[11px] text-polydash-green">You are the launch creator of {h.gate?.symbol}.</p>
        ) : null}
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-secondary/30 p-3">
        <span>
          <span className="block text-[13px] font-medium">Token-gated holder mint</span>
          <span className="block text-[11px] text-muted-foreground">{h.gatedOn ? 'Holders of the linked token mint first, then the public mint opens.' : 'Open mint: anyone can mint from the start time.'}</span>
        </span>
        <input type="checkbox" checked={h.gatedOn} onChange={(e) => h.setGatedOn(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
      </label>

      {h.gatedOn ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>Minimum balance{h.gate?.symbol ? ` (${h.gate.symbol})` : ''}</label>
              <Input type="number" inputMode="decimal" value={h.minBalance} onChange={(e) => h.setMinBalance(e.target.value)} placeholder="e.g. 1000000" className="bg-secondary/50 font-mono" />
            </div>
            <div>
              <label className={label}>Holder price (ETH)</label>
              <Input type="number" inputMode="decimal" value={h.holderPrice} onChange={(e) => h.setHolderPrice(e.target.value)} className="bg-secondary/50 font-mono" />
            </div>
            <div>
              <label className={label}>Public price (ETH)</label>
              <Input type="number" inputMode="decimal" value={h.holderOnly ? '' : h.publicPrice} disabled={h.holderOnly} placeholder={h.holderOnly ? 'No public mint' : ''} onChange={(e) => h.setPublicPrice(e.target.value)} className="bg-secondary/50 font-mono" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={h.holderOnly} onChange={(e) => h.setHolderOnly(e.target.checked)} className="h-3.5 w-3.5" />
            Holder-only, no public mint
          </label>
          <StartFields h={h} title="Holder phase start" />
          <div>
            <label className="mb-2 block text-xs text-muted-foreground">Holder phase length</label>
            <div className="flex flex-wrap gap-2">
              {DURATION_PRESETS.map((d) => <Pill key={d.value} active={h.duration === d.value} onClick={() => h.setDuration(d.value)}>{d.label}</Pill>)}
              <Pill active={h.duration === 'custom'} onClick={() => h.setDuration('custom')}>Custom</Pill>
            </div>
            {h.duration === 'custom' && (
              <div className="mt-2 max-w-[200px]">
                <label className={label}>Hours (1–720)</label>
                <Input type="number" inputMode="numeric" value={h.customHours} onChange={(e) => h.setCustomHours(e.target.value)} className="bg-secondary/50 font-mono" />
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Holder mints per wallet (1 to max per wallet)</label>
              <Input type="number" inputMode="numeric" value={h.holderMax} onChange={(e) => h.setHolderMax(e.target.value)} className="bg-secondary/50 font-mono" />
            </div>
            <div>
              <label className={label}>Max per wallet total (1–100)</label>
              <Input type="number" inputMode="numeric" value={h.maxPerWallet} onChange={(e) => h.setMaxPerWallet(e.target.value)} className="bg-secondary/50 font-mono" />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Mint price (ETH)</label>
              <Input type="number" inputMode="decimal" value={h.openPrice} onChange={(e) => h.setOpenPrice(e.target.value)} className="bg-secondary/50 font-mono" />
            </div>
            <div>
              <label className={label}>Max per wallet (1–100)</label>
              <Input type="number" inputMode="numeric" value={h.maxPerWallet} onChange={(e) => h.setMaxPerWallet(e.target.value)} className="bg-secondary/50 font-mono" />
            </div>
          </div>
          <StartFields h={h} title="Mint start" />
        </>
      )}

      <div>
        <label className={label}>Payout wallet (optional, blank = your wallet)</label>
        <Input value={h.payout} onChange={(e) => h.setPayout(e.target.value)} placeholder="0x…" className="bg-secondary/50 font-mono" />
      </div>
      {h.gatedOn && <HolderCheckNote />}
    </div>
  );
}

function StartFields({ h, title }: { h: HolderSettings; title: string }) {
  return (
    <div>
      <label className="mb-2 block text-xs text-muted-foreground">{title}</label>
      <div className="flex flex-wrap items-center gap-2">
        <Pill active={h.startMode === 'now'} onClick={() => h.setStartMode('now')}>Now</Pill>
        <Pill active={h.startMode === 'date'} onClick={() => h.setStartMode('date')}>Pick a date</Pill>
        {h.startMode === 'date' && (
          <Input type="datetime-local" value={h.startDate} onChange={(e) => h.setStartDate(e.target.value)} className="h-9 w-auto bg-secondary/50 font-mono" />
        )}
      </div>
      {h.startMode === 'date' && <p className="mt-1 text-[11px] text-muted-foreground">Your local time. Must be within 30 days.</p>}
    </div>
  );
}

/** Per-NFT split shown before signing. */
export function HolderSplit({ h, floorBps }: { h: HolderSettings; floorBps: number }) {
  const rows = h.gatedOn
    ? [['Holder mint', h.holderP] as const, ...(h.publicP > ZERO ? [['Public mint', h.publicP] as const] : [])]
    : [['Mint', h.publicP] as const];
  return (
    <div className="rounded-lg bg-secondary/30 p-3">
      <p className="text-[12px] font-medium">Per NFT</p>
      <div className="mt-2 space-y-1.5 text-[12px]">
        {rows.map(([k, p]) => {
          const s = h.split(p);
          return (
            <div key={k} className="flex flex-wrap justify-between gap-2">
              <span className="text-muted-foreground">{k} at {formatEther(p)} ETH</span>
              <span className="font-mono">floor vault {formatEther(h.floorWei)} · platform fee {formatEther(s.fee)} · creator {formatEther(s.creator)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Floor vault = {floorBps / 100}% of the lower price, locked in the collection for burns. Platform fee 0.2%. The creator gets the rest.
        {h.gate && h.gatedOn ? ` Minimum balance: ${h.minBalance} ${h.gate.symbol}.` : ''}
      </p>
    </div>
  );
}
