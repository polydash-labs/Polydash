'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatEther, parseEther } from 'viem';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { useNow } from '@/lib/hooks/use-nft-collections';
import { useFloorCreatorTokens, useFloorToken, type FloorToken } from '@/lib/hooks/use-floor-vault';
import {
  ACK_TEXT, L, MAX_BUY, MAX_START_AHEAD, MIN_BUY, NOT_ELIGIBLE, SLIPPAGE_NOTE, ZERO_ADDRESS, floorSplit, isAddr, isPolydashToken, type Addr,
} from '@/lib/floorVault';
import { FloorRiskNote } from '@/components/floor-vault/notes';

const label = 'text-xs text-muted-foreground mb-1 block';
const ZERO = BigInt(0);

function buyEth(s: string): bigint | null {
  try {
    const v = parseEther(s.trim() || '0');
    return v >= MIN_BUY && v <= MAX_BUY ? v : null;
  } catch { return null; }
}

export type FloorSettings = ReturnType<typeof useFloorSettings>;

/** State, validation and createCollection params for the "Token-backed floor vault" sale type. Supply, price, max per wallet, floor and royalty come from the wizard. */
export function useFloorSettings(o: {
  supplyN: number; supplyOk: boolean; priceWei: bigint | null; mpwN: number; mpwOk: boolean; floorBps: number;
}) {
  const creatorTokens = useFloorCreatorTokens();
  const now = useNow();
  const [tokenInput, setTokenInput] = useState('');
  const [tokenShareBps, setTokenShareBps] = useState<number>(L.tokenShareBps.default);
  const [slippageBps, setSlippageBps] = useState<number>(L.maxSlippageBps.default);
  const [maxBuy, setMaxBuy] = useState<string>(L.maxBuyEth.default);
  const [startMode, setStartMode] = useState<'now' | 'date'>('now');
  const [startDate, setStartDate] = useState('');
  const [payout, setPayout] = useState('');
  const [ack, setAck] = useState(false);

  const token = tokenInput.trim();
  const check = useFloorToken(isAddr(token) ? token : null);
  const info: FloorToken | undefined = check.data;
  const eligible = (creatorTokens.data?.length ?? 0) > 0 || !!info?.isCreator;
  const tokenErr = !token ? 'Pick or paste a linked token.'
    : !isAddr(token) ? 'Enter a valid token address.'
    : isPolydashToken(token) ? 'POLYDASH is not a launch token.'
    : check.isLoading ? null
    : check.error ? 'Could not check this token. Try again.'
    : !info?.launch ? 'This token was not launched through the Polypad factory.'
    : !info.isCreator ? NOT_ELIGIBLE
    : null;
  const tokenOk = !tokenErr && !check.isLoading && !!info?.isCreator;

  const maxBuyWei = buyEth(maxBuy);
  const startTs = startMode === 'date' && startDate ? Math.floor(new Date(startDate).getTime() / 1000) : NaN;
  const startErr = startMode === 'now' ? null
    : !Number.isFinite(startTs) ? 'Pick a start date and time.'
    : now != null && startTs <= now ? 'Start must be in the future, or choose Now.'
    : now != null && startTs > now + MAX_START_AHEAD ? 'Start must be within 30 days.'
    : null;

  const error: string | null = !o.supplyOk ? 'Supply must be a whole number from 1 to 10,000.'
    : !o.priceWei ? 'Price must be between 0.00001 and 100 ETH.'
    : !o.mpwOk ? 'Max per wallet must be 1 to 100 and not above supply.'
    : tokenErr ?? (check.isLoading ? 'Checking token…' : null)
    ?? (!maxBuyWei ? `Max ETH per vault buy must be between ${L.maxBuyEth.min} and ${L.maxBuyEth.max}.` : null)
    ?? startErr
    ?? (payout.trim() && !isAddr(payout.trim()) ? 'Payout wallet must be a valid address, or leave it blank.' : null)
    ?? (!ack ? 'Tick the confirmation box to continue.' : null);

  const valid = !error;
  const split = floorSplit(o.priceWei ?? ZERO, o.floorBps, tokenShareBps);
  const sym = info?.symbol || 'the token';
  const startLabel = startMode === 'now' ? 'When the collection is created' : startDate ? new Date(startDate).toLocaleString('en-US') : '';

  const reviewRows: [string, string][] = [
    ['Sale type', 'Token-backed floor vault'],
    ['Linked token', info?.symbol ? `${info.symbol} (${token.slice(0, 6)}…${token.slice(-4)})` : token],
    ['Mint price', `${formatEther(o.priceWei ?? ZERO)} ETH`],
    ['Max per wallet', String(o.mpwN)],
    ['Mint start', startLabel],
    ['Floor vault', `${o.floorBps / 100}% (${formatEther(split.vault)} ETH per NFT)`],
    ['Token share', `${tokenShareBps / 100}% of the vault part`],
    ['Max slippage', `${slippageBps / 100}%`],
    ['Max ETH per vault buy', `${maxBuy} ETH`],
    ['Payout wallet', payout.trim() || 'Your wallet'],
  ];

  const buildArgs = (base: { name: string; symbol: string; imageUri: string; description: string; baseURI: string; royaltyBps: number }) => ({
    ...base,
    maxSupply: BigInt(o.supplyN),
    price: o.priceWei ?? ZERO,
    floorBps: BigInt(o.floorBps),
    tokenShareBps: BigInt(tokenShareBps),
    maxSlippageBps: BigInt(slippageBps),
    maxBuyEth: maxBuyWei ?? ZERO,
    royaltyBps: BigInt(base.royaltyBps),
    maxPerWallet: BigInt(o.mpwN),
    startTime: startMode === 'now' ? ZERO : BigInt(startTs),
    token: token as Addr,
    payoutWallet: (payout.trim() || ZERO_ADDRESS) as Addr,
  });

  return {
    creatorTokens, eligible, check, info, sym, tokenInput, setTokenInput, tokenErr, tokenOk,
    tokenShareBps, setTokenShareBps, slippageBps, setSlippageBps, maxBuy, setMaxBuy,
    startMode, setStartMode, startDate, setStartDate, payout, setPayout, ack, setAck,
    error, valid, split, reviewRows, buildArgs,
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

/** Linked token picker (launch creator only). */
export function FloorTokenField({ f }: { f: FloorSettings }) {
  const list = f.creatorTokens.data ?? [];
  const picked = list.some((t) => t.address.toLowerCase() === f.tokenInput.trim().toLowerCase());
  const only = list.length === 1 ? list[0].address : null;
  const { tokenInput, setTokenInput } = f;
  useEffect(() => {
    if (!tokenInput && only) setTokenInput(only);
  }, [only, tokenInput, setTokenInput]);

  return (
    <div>
      <label className={label}>Linked token *</label>
      {list.length > 0 && (
        <select value={picked ? f.tokenInput : ''} onChange={(e) => f.setTokenInput(e.target.value)}
          className="mb-2 h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 text-[16px] sm:text-sm">
          <option value="">Choose one of your tokens…</option>
          {list.map((t) => <option key={t.address} value={t.address}>{t.symbol || t.name} · {t.address.slice(0, 6)}…{t.address.slice(-4)}</option>)}
        </select>
      )}
      <Input value={f.tokenInput} onChange={(e) => f.setTokenInput(e.target.value)} placeholder="or paste a token address 0x…" className="bg-secondary/50 font-mono" />
      {f.check.isLoading ? (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking launch creator…</p>
      ) : f.tokenInput && f.tokenErr ? (
        <p className="mt-1 text-[11px] text-red-300">{f.tokenErr}</p>
      ) : f.tokenOk ? (
        <p className="mt-1 text-[11px] text-polydash-green">You are the launch creator of {f.info?.symbol}.</p>
      ) : null}
    </div>
  );
}

/** Token share, slippage, buy cap, start, payout and confirmation. */
export function FloorSettingsFields({ f }: { f: FloorSettings }) {
  const s = f.split;
  return (
    <div className="space-y-5">
      <div>
        <label className="mb-2 block text-xs text-muted-foreground">Token share of the vault: {f.tokenShareBps / 100}%</label>
        <Slider value={[f.tokenShareBps]} onValueChange={(v) => f.setTokenShareBps(v?.[0] ?? L.tokenShareBps.default)} min={L.tokenShareBps.min} max={L.tokenShareBps.max} step={100} />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{L.tokenShareBps.min / 100}%</span><span>{L.tokenShareBps.default / 100}% (default)</span><span>{L.tokenShareBps.max / 100}%</span></div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Per NFT: {formatEther(s.vault)} ETH to the vault, of which {formatEther(s.toToken)} ETH is used to buy {f.sym} and {formatEther(s.toEth)} ETH stays ETH.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-xs text-muted-foreground">Max slippage per vault buy: {f.slippageBps / 100}%</label>
          <Slider value={[f.slippageBps]} onValueChange={(v) => f.setSlippageBps(v?.[0] ?? L.maxSlippageBps.default)} min={L.maxSlippageBps.min} max={L.maxSlippageBps.max} step={50} />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{L.maxSlippageBps.min / 100}%</span><span>{L.maxSlippageBps.max / 100}%</span></div>
          <p className="mt-2 text-[11px] text-muted-foreground">{SLIPPAGE_NOTE}</p>
        </div>
        <div>
          <label className={label}>Max ETH per vault buy ({L.maxBuyEth.min}–{L.maxBuyEth.max})</label>
          <Input type="number" inputMode="decimal" value={f.maxBuy} onChange={(e) => f.setMaxBuy(e.target.value)} className="bg-secondary/50 font-mono" />
          <p className="mt-1 text-[11px] text-muted-foreground">Each vault buy uses at most this much of the ETH waiting to swap.</p>
        </div>
      </div>
      <div>
        <label className="mb-2 block text-xs text-muted-foreground">Mint start</label>
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={f.startMode === 'now'} onClick={() => f.setStartMode('now')}>Now</Pill>
          <Pill active={f.startMode === 'date'} onClick={() => f.setStartMode('date')}>Pick a date</Pill>
          {f.startMode === 'date' && (
            <Input type="datetime-local" value={f.startDate} onChange={(e) => f.setStartDate(e.target.value)} className="h-9 w-auto bg-secondary/50 font-mono" />
          )}
        </div>
        {f.startMode === 'date' && <p className="mt-1 text-[11px] text-muted-foreground">Your local time. Must be within 30 days.</p>}
      </div>
      <div>
        <label className={label}>Payout wallet (optional, blank = your wallet)</label>
        <Input value={f.payout} onChange={(e) => f.setPayout(e.target.value)} placeholder="0x…" className="bg-secondary/50 font-mono" />
      </div>
      <FloorRiskNote symbol={f.info?.symbol} />
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-secondary/30 p-3 text-[12px]">
        <input type="checkbox" checked={f.ack} onChange={(e) => f.setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
        <span>{ACK_TEXT}</span>
      </label>
    </div>
  );
}

/** Per-NFT summary shown before signing. */
export function FloorSplit({ f, priceWei }: { f: FloorSettings; priceWei: bigint }) {
  const s = f.split;
  const rows: [string, string][] = [
    ['Mint price', `${formatEther(priceWei)} ETH`],
    ['Platform fee (0.2%)', `${formatEther(s.fee)} ETH`],
    ['Vault share', `${formatEther(s.vault)} ETH`],
    [`Token share (bought as ${f.sym})`, `${formatEther(s.toToken)} ETH`],
    ['Kept as ETH in the vault', `${formatEther(s.toEth)} ETH`],
    ['Creator proceeds', `${formatEther(s.creator)} ETH`],
  ];
  return (
    <div className="rounded-lg bg-secondary/30 p-3">
      <p className="text-[12px] font-medium">Per NFT</p>
      <div className="mt-2 space-y-1.5 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-wrap justify-between gap-2">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono">{v}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">The token share waits as ETH until the token graduates, then vault buys convert it in capped batches.</p>
    </div>
  );
}
