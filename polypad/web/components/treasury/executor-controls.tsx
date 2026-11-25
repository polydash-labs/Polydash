'use client';

import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { Loader2 } from 'lucide-react';
import { formatUnits, parseEther, parseUnits } from 'viem';
import { Button } from '@/components/ui/button';
import { robinhoodChain } from '@/lib/chain';
import { PolydashLaunchABI } from '@/lib/contracts/abis';
import { useTreasuryTx, type TreasuryData } from '@/lib/hooks/use-treasury';
import { BUYBACK_NOTE, fmtAmount, fmtEth, type Addr } from '@/lib/treasury';
import { inputCls } from '@/components/treasury/rules-form';

export function ExecutorControls({ t, decimals, symbol, graduated }: { t: TreasuryData; decimals: number; symbol: string; graduated: boolean }) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { send, pending, lastError } = useTreasuryTx();
  const [ethIn, setEthIn] = useState('');
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [poolAmount, setPoolAmount] = useState('');
  const vault = t.vault as Addr;
  const slipBps = t.rules?.maxSlippageBps ?? 500;
  const buybacksOn = BigInt(t.rules?.maxEthPerDay ?? '0') > BigInt(0);
  const poolsOn = BigInt(t.rules?.maxPoolReward ?? '0') > BigInt(0);

  let ethWei: bigint | null = null;
  try { ethWei = ethIn.trim() ? parseEther(ethIn.trim() as `${number}`) : null; } catch { ethWei = null; }

  useEffect(() => {
    setQuote(null);
    setQuoteErr(null);
    if (graduated || !client || !t.launch || !ethWei || ethWei <= BigInt(0)) return;
    let live = true;
    const id = setTimeout(() => {
      client.readContract({ address: t.launch as Addr, abi: PolydashLaunchABI, functionName: 'quoteBuy', args: [ethWei!] })
        .then((r: any) => { if (live) setQuote(r[0] as bigint); })
        .catch((e) => { console.error('quoteBuy failed', e); if (live) setQuoteErr('Quote unavailable right now.'); });
    }, 350);
    return () => { live = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ethIn, graduated, client, t.launch]);

  const minOut = quote != null ? (quote * BigInt(10_000 - slipBps)) / BigInt(10_000) : BigInt(0);

  const buyback = () => {
    if (!ethWei || ethWei <= BigInt(0)) return;
    send({ key: 'buyback', address: vault, abi: 'vault', functionName: 'buyback', args: [ethWei, graduated ? BigInt(0) : minOut], success: 'Buyback executed' });
  };
  const createPool = () => {
    let amt: bigint;
    try { amt = parseUnits(poolAmount.trim() as `${number}`, decimals); } catch { return; }
    if (amt <= BigInt(0)) return;
    send({ key: 'pool', address: vault, abi: 'vault', functionName: 'createRewardPool', args: [amt], success: 'Reward pool created' });
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h3 className="text-[14px] font-semibold text-white">Agent actions</h3>
      <p className="mt-1 text-[12px] text-white/55">{t.openExecution ? 'Anyone can trigger these actions within the limits above.' : 'Your wallet is an approved agent for this treasury.'} Agents never receive funds.</p>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-white/80">Buyback</p>
          <p className="text-[11px] text-white/45">{BUYBACK_NOTE}</p>
          {!buybacksOn ? <p className="text-[12px] text-white/55">Buybacks are off in these rules.</p> : (
            <>
              <input className={inputCls} inputMode="decimal" placeholder="ETH to spend" value={ethIn} onChange={(e) => setEthIn(e.target.value)} />
              <p className="text-[11px] text-white/45">Remaining today: {fmtEth(t.remainingToday ?? '0')} · Max per buyback: {fmtEth(t.rules?.maxEthPerBuyback ?? '0')}</p>
              {graduated ? (
                <p className="text-[11px] text-white/55">Graduated token: the vault reads the pool price itself and applies the slippage limit ({slipBps / 100}%).</p>
              ) : quote != null ? (
                <p className="text-[11px] text-white/65">Quote: about {fmtAmount(quote, decimals)} {symbol} · Minimum accepted: {Number(formatUnits(minOut, decimals)).toLocaleString('en-US', { maximumFractionDigits: 4 })} {symbol}</p>
              ) : quoteErr ? <p className="text-[11px] text-amber-200">{quoteErr}</p> : null}
              <Button size="sm" className="rounded-full" onClick={buyback} disabled={!!pending || !ethWei}>
                {pending === 'buyback' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Run buyback
              </Button>
            </>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-white/80">Reward pool</p>
          <p className="text-[11px] text-white/45">Creates a new Polydash staking pool funded from the treasury&apos;s available tokens.</p>
          {!poolsOn ? <p className="text-[12px] text-white/55">Reward pools are off in these rules.</p> : (
            <>
              <input className={inputCls} inputMode="decimal" placeholder={`${symbol} amount`} value={poolAmount} onChange={(e) => setPoolAmount(e.target.value)} />
              <p className="text-[11px] text-white/45">Max per pool: {fmtAmount(t.rules?.maxPoolReward ?? '0', decimals)} {symbol} · Available: {fmtAmount(t.balances?.available ?? '0', decimals)} {symbol}</p>
              <Button size="sm" className="rounded-full" onClick={createPool} disabled={!!pending || !poolAmount.trim()}>
                {pending === 'pool' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Create reward pool
              </Button>
            </>
          )}
        </div>
      </div>
      {lastError && <p className="mt-3 text-[12px] text-red-300">{lastError}</p>}
    </div>
  );
}
