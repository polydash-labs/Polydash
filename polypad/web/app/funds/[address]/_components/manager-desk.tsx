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
  { key: 'buy', label: 'Buy a token' },
  { key: 'sell', label: 'Sell a token' },
  { key: 'wrap', label: 'Wrap ETH into WETH' },
  { key: 'unwrap', label: 'Unwrap WETH into ETH' },
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
        <h2 className="text-[15px] font-semibold">Manager tools (only shown to the manager and approved traders)</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/60">
          Trading is not available yet. Once the raise closes, you can start investing (sign 1 transaction) and then buy tokens from the approved list. The money always stays in the fund&apos;s vault.
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
      toast.success('Investing has started. You can now trade for the fund.', {
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
      <h2 className="text-[15px] font-semibold">Manager tools (only shown to the manager and approved traders)</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-white/60">
        The raise is closed. Start investing to let the fund buy tokens from the approved list of tokens the fund may buy (the allowlist). This does not send any of the fund&apos;s money to your wallet; it stays in the fund&apos;s vault.
      </p>
      <Button onClick={submit} disabled={pending} className="mt-4 gap-2">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Start investing (sign 1 transaction, no ETH sent)
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
      toast.loading('Waiting for confirmation…', { id: tid });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      await queryClient.invalidateQueries({ queryKey: ['fund'] });
      toast.success('Done. The change is confirmed.', {
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
      toast.error('This fund has no approved tokens to buy or sell. You can still wrap or unwrap ETH.');
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
      <h2 className="text-[15px] font-semibold">Manager tools (only shown to the manager and approved traders)</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-white/60">
        Trade for the fund. Every trade stays in the fund&apos;s vault and you sign each one in your wallet. Set the least the vault must get back (minimum) so a bad price makes the trade fail instead.
      </p>
      {paused && (
        <p className="mt-2 text-[13px] text-yellow-200/90">
          {invest.allowlistPaused
            ? 'The approved list of tokens the fund may buy (the allowlist) is paused, so trading is stopped for now.'
            : 'Trading is paused. Resume it below to trade again.'}
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
              Token (from the approved list)
              <select value={asset} onChange={(event) => setAsset(event.target.value as `0x${string}`)} className="mt-1 h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 text-sm text-white">
                {assets.length === 0 && <option value={invest.weth}>No approved tokens for this fund</option>}
                {assets.map((row) => <option key={row.asset} value={row.asset}>{row.symbol}</option>)}
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              {mode === 'buy' ? 'Pay with' : 'Receive'}
              <select value={quote} onChange={(event) => setQuote(event.target.value === 'weth' ? 'weth' : 'eth')} className="mt-1 h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 text-sm text-white">
                <option value="eth">ETH</option>
                <option value="weth">WETH</option>
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              Trading route (router)
              <select value={router} onChange={(event) => setRouter(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 font-mono text-sm text-white">
                {invest.routers.length === 0 && <option value="">No approved trading route yet</option>}
                {invest.routers.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </>
        )}
        <label className="block text-xs text-muted-foreground">
          {mode === 'sell' ? 'Amount to sell (token units)' : mode === 'unwrap' ? 'Amount (WETH)' : mode === 'wrap' ? 'Amount (ETH)' : `Amount to pay (${quote === 'weth' ? 'WETH' : 'ETH'})`}
          <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
        </label>
        {(mode === 'buy' || mode === 'sell') && (
          <label className="block text-xs text-muted-foreground">
            {mode === 'buy' ? 'Least the vault must get back (minimum, token units)' : `Least the vault must get back (minimum, ${quote === 'weth' ? 'WETH' : 'ETH'})`}
            <Input value={minimum} onChange={(event) => setMinimum(event.target.value)} inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
          </label>
        )}
      </div>
      {(mode === 'buy' || mode === 'sell') && (
        <button type="button" className="mt-3 text-[12px] text-white/60 underline-offset-2 hover:text-white hover:underline" onClick={() => setAdvanced((open) => !open)}>
          {advanced ? 'Hide extra route data' : 'Advanced: add extra route data'}
        </button>
      )}
      {advanced && (mode === 'buy' || mode === 'sell') && (
        <label className="mt-2 block text-xs text-muted-foreground">
          Extra data for the trading route (hex, starts with 0x; leave empty if unsure)
          <Input value={dataText} onChange={(event) => setDataText(event.target.value)} placeholder="0x" className="mt-1 bg-secondary/50 font-mono text-[12px]" />
        </label>
      )}
      <Button onClick={submitSwap} disabled={pending || paused} className="mt-4 gap-2">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {mode === 'wrap' ? 'Wrap ETH (sign 1 transaction, money stays in the vault)' : mode === 'unwrap' ? 'Unwrap WETH (sign 1 transaction, money stays in the vault)' : mode === 'sell' ? 'Sell (sign 1 transaction, money stays in the vault)' : 'Buy (sign 1 transaction, money stays in the vault)'}
      </Button>
      {isManager && (
        <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
          <Button variant="secondary" onClick={() => send('setSwapsPaused', [!invest.swapsPaused])} disabled={pending}>
            {invest.swapsPaused ? 'Resume trading (sign 1 transaction)' : 'Pause trading (sign 1 transaction)'}
          </Button>
          <label className="block text-xs text-muted-foreground">
            Let another wallet trade for this fund (wallet address)
            <Input value={executor} onChange={(event) => setExecutor(event.target.value)} placeholder="0x" className="mt-1 bg-secondary/50 font-mono text-[12px]" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => changeExecutor(true)}>Allow this wallet (sign 1 transaction)</Button>
            <Button variant="secondary" disabled={pending} onClick={() => changeExecutor(false)}>Remove this wallet (sign 1 transaction)</Button>
          </div>
        </div>
      )}
    </section>
  );
}
