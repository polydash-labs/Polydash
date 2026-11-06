'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FundVaultInvestABI } from '@/lib/contracts/fund-abi';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
import { fundTxError } from '@/lib/fund/model';
import { buildSwap, parseRouterData, parseTokenAmount, type FundInvestView, type SwapMode } from '@/lib/fund/invest';
import { cn } from '@/lib/utils';

const MODES: { key: SwapMode; label: string }[] = [
  { key: 'buy', label: 'Buy' },
  { key: 'sell', label: 'Sell' },
  { key: 'wrap', label: 'Wrap' },
  { key: 'unwrap', label: 'Unwrap' },
];

export function ManagerDesk({
  vault,
  status,
  isManager,
  invest,
}: {
  vault: `0x${string}`;
  status: 'waiting' | 'open' | 'closed' | 'investing';
  isManager: boolean;
  invest: FundInvestView | null;
}) {
  const canSign = isManager || !!invest?.isExecutor;
  if (!invest || !canSign) return null;
  if (status === 'waiting' || status === 'open') {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold">Manager desk</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/60">
          Swaps open after this raise closes. You sign that step in your wallet.
        </p>
      </section>
    );
  }
  if (status === 'closed') {
    if (!isManager) return null;
    return <EnableInvesting vault={vault} />;
  }
  return <SwapDesk vault={vault} invest={invest} isManager={isManager} />;
}

function EnableInvesting({ vault }: { vault: `0x${string}` }) {
  const { chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!publicClient) return;
    setPending(true);
    const tid = toast.loading('Confirm in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await writeContractAsync({
        address: vault,
        abi: FundVaultInvestABI,
        functionName: 'enableInvesting',
        chainId: robinhoodChain.id,
      });
      toast.loading('Starting investing…', { id: tid });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      await queryClient.invalidateQueries({ queryKey: ['fund'] });
      toast.success('Investing is open', {
        id: tid,
        action: { label: 'View tx', onClick: () => window.open(getExplorerTxUrl(hash), '_blank') },
      });
    } catch (error) {
      const message = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage ?? error.message : 'Transaction failed';
      toast.error(fundTxError(message), { id: tid });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">Manager desk</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-white/60">
        The raise is closed. Opening investing lets the manager swap through the allowlist. You sign that transaction. It does not send the vault balance to your wallet.
      </p>
      <Button onClick={submit} disabled={pending} className="mt-4 gap-2">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Open investing
      </Button>
    </section>
  );
}

function SwapDesk({ vault, invest, isManager }: { vault: `0x${string}`; invest: FundInvestView; isManager: boolean }) {
  const { chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();
  const assets = invest.holdings.filter((row) => row.kind === 'asset');
  const [mode, setMode] = useState<SwapMode>(assets.length > 0 ? 'buy' : 'wrap');
  const [quote, setQuote] = useState<'eth' | 'weth'>('eth');
  const [asset, setAsset] = useState(assets[0]?.asset ?? invest.weth);
  const [router, setRouter] = useState<string>(invest.routers[0] ?? '');
  const [amount, setAmount] = useState('');
  const [minimum, setMinimum] = useState('');
  const [dataText, setDataText] = useState('');
  const [executor, setExecutor] = useState('');
  const [pending, setPending] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const assetRow = assets.find((row) => row.asset.toLowerCase() === asset.toLowerCase());
  const amountDecimals = mode === 'sell' ? (assetRow?.decimals ?? 18) : 18;
  const minDecimals = mode === 'buy' ? (assetRow?.decimals ?? 18) : 18;
  const paused = invest.swapsPaused || invest.allowlistPaused;

  const send = async (functionName: 'swap' | 'setSwapsPaused' | 'setExecutor', args: readonly unknown[]) => {
    if (!publicClient) return;
    setPending(true);
    const tid = toast.loading('Confirm in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await writeContractAsync({
        address: vault,
        abi: FundVaultInvestABI,
        functionName,
        chainId: robinhoodChain.id,
        args: args as never,
      });
      toast.loading('Waiting for Robinhood Chain…', { id: tid });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      await queryClient.invalidateQueries({ queryKey: ['fund'] });
      toast.success('Signed and sent', {
        id: tid,
        action: { label: 'View tx', onClick: () => window.open(getExplorerTxUrl(hash), '_blank') },
      });
    } catch (error) {
      const message = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage ?? error.message : 'Transaction failed';
      toast.error(fundTxError(message), { id: tid });
    } finally {
      setPending(false);
    }
  };

  const changeExecutor = (allowed: boolean) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(executor.trim())) {
      toast.error('Enter a wallet address.');
      return;
    }
    void send('setExecutor', [executor.trim() as `0x${string}`, allowed]);
  };

  const submitSwap = async () => {
    if ((mode === 'buy' || mode === 'sell') && assets.length === 0) {
      toast.error('This fund has no allowlisted assets to swap. Wrapping ETH is separate.');
      return;
    }
    const parsedAmount = parseTokenAmount(amount, amountDecimals);
    if (!parsedAmount.ok) {
      toast.error(parsedAmount.message);
      return;
    }
    const parsedMin = mode === 'wrap' || mode === 'unwrap'
      ? { ok: true as const, amount: parsedAmount.amount }
      : parseTokenAmount(minimum, minDecimals);
    if (!parsedMin.ok) {
      toast.error(parsedMin.message);
      return;
    }
    const parsedData = parseRouterData(dataText);
    if (!parsedData.ok) {
      toast.error(parsedData.message);
      return;
    }
    const built = buildSwap({
      mode,
      quote,
      weth: invest.weth,
      asset,
      router,
      amountIn: parsedAmount.amount,
      minAmountOut: parsedMin.amount,
      data: parsedData.data,
    });
    if (!built.ok) {
      toast.error(built.message);
      return;
    }
    const call = built.call;
    await send('swap', [call.router, call.assetIn, call.assetOut, call.amountIn, call.minAmountOut, call.data]);
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">Manager desk</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-white/60">
        Swaps stay in the vault. You sign each one in your wallet. The minimum is the least the vault will accept back.
      </p>
      {paused && (
        <p className="mt-2 text-[13px] text-yellow-200/90">
          {invest.allowlistPaused ? 'The allowlist is paused.' : 'Swaps are paused.'}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {MODES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setMode(item.key)}
            className={cn(
              'inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium',
              mode === item.key ? 'bg-polydash-green text-black' : 'border border-white/15 text-white/70',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(mode === 'buy' || mode === 'sell') && (
          <>
            <label className="block text-xs text-muted-foreground">
              Asset
              <select value={asset} onChange={(event) => setAsset(event.target.value as `0x${string}`)} className="mt-1 h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 text-sm text-white">
                {assets.length === 0 && <option value={invest.weth}>No assets on this mandate</option>}
                {assets.map((row) => <option key={row.asset} value={row.asset}>{row.symbol}</option>)}
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              Quote
              <select value={quote} onChange={(event) => setQuote(event.target.value === 'weth' ? 'weth' : 'eth')} className="mt-1 h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 text-sm text-white">
                <option value="eth">ETH</option>
                <option value="weth">WETH</option>
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              Router
              <select value={router} onChange={(event) => setRouter(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 font-mono text-sm text-white">
                {invest.routers.length === 0 && <option value="">No router on the allowlist</option>}
                {invest.routers.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </>
        )}
        <label className="block text-xs text-muted-foreground">
          Amount
          <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
        </label>
        {(mode === 'buy' || mode === 'sell') && (
          <label className="block text-xs text-muted-foreground">
            Minimum back to the vault
            <Input value={minimum} onChange={(event) => setMinimum(event.target.value)} inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
          </label>
        )}
      </div>
      {(mode === 'buy' || mode === 'sell') && (
        <button type="button" className="mt-3 text-[12px] text-white/60 underline-offset-2 hover:text-white hover:underline" onClick={() => setAdvanced((open) => !open)}>
          {advanced ? 'Hide router data' : 'Add router data'}
        </button>
      )}
      {advanced && (mode === 'buy' || mode === 'sell') && (
        <label className="mt-2 block text-xs text-muted-foreground">
          Hex data for the router
          <Input value={dataText} onChange={(event) => setDataText(event.target.value)} placeholder="0x" className="mt-1 bg-secondary/50 font-mono text-[12px]" />
        </label>
      )}
      <Button onClick={submitSwap} disabled={pending || paused} className="mt-4 gap-2">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Sign swap
      </Button>
      {isManager && (
        <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
          <Button variant="secondary" onClick={() => send('setSwapsPaused', [!invest.swapsPaused])} disabled={pending}>
            {invest.swapsPaused ? 'Unpause swaps' : 'Pause swaps'}
          </Button>
          <label className="block text-xs text-muted-foreground">
            Another wallet that can sign swaps
            <Input value={executor} onChange={(event) => setExecutor(event.target.value)} placeholder="0x" className="mt-1 bg-secondary/50 font-mono text-[12px]" />
          </label>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => changeExecutor(true)}>Allow</Button>
            <Button variant="secondary" disabled={pending} onClick={() => changeExecutor(false)}>Remove</Button>
          </div>
        </div>
      )}
    </section>
  );
}
