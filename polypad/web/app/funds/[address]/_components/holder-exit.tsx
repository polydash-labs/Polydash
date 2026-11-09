'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseAbi } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FundNFTInvestABI, FundVaultInvestABI } from '@/lib/contracts/fund-abi';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
import { formatFundEth, formatTokenAmount, fundTxError } from '@/lib/fund/model';
import type { FundInvestView } from '@/lib/fund/invest';

const TRANSFER_EVENT = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

export type HolderExitFund = {
  address: `0x${string}`;
  vault: `0x${string}`;
  /** Raw vault status: 0 Raising, 1 RaisingClosed, 2 Investing, 3 Failed. */
  vaultStatus: number;
  totalMinted: bigint;
  balance: bigint;
  invest: FundInvestView | null;
};

/**
 * Refund / Exit / Claim owed for Phase 2 funds. Phase 1 NFTs have no refund or exit,
 * so this panel renders nothing for them. Token IDs come from the fund's Transfer log;
 * if that read fails, the holder can paste IDs by hand.
 */
export function HolderExit({ fund, account }: { fund: HolderExitFund; account?: `0x${string}` }) {
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [owned, setOwned] = useState<bigint[] | null>(null);
  const [scanFailed, setScanFailed] = useState(false);
  const [manual, setManual] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<'refund' | 'exit' | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [owed, setOwed] = useState<{ asset: `0x${string}`; symbol: string; decimals: number; amount: bigint }[]>([]);

  const invest = fund.invest;
  const isFailed = fund.vaultStatus === 3;
  const isExitable = fund.vaultStatus === 1 || fund.vaultStatus === 2;

  const loadOwned = useCallback(async () => {
    if (!publicClient || !account || !invest) return;
    setScanFailed(false);
    try {
      const logs = await publicClient.getLogs({
        address: fund.address,
        event: TRANSFER_EVENT[0],
        fromBlock: 'earliest',
        toBlock: 'latest',
      });
      const held = new Set<bigint>();
      const me = account.toLowerCase();
      for (const log of logs) {
        const { from, to, tokenId } = log.args as { from: string; to: string; tokenId: bigint };
        if (to.toLowerCase() === me) held.add(tokenId);
        if (from.toLowerCase() === me) held.delete(tokenId);
      }
      setOwned([...held].sort((a, b) => (a < b ? -1 : 1)));
    } catch {
      setScanFailed(true);
      setOwned([]);
    }
  }, [publicClient, account, invest, fund.address]);

  const loadOwed = useCallback(async () => {
    if (!publicClient || !account || !invest) return;
    const assets = [invest.weth, ...invest.assets];
    const rows = await publicClient.multicall({
      contracts: assets.map((asset) => ({
        address: fund.vault,
        abi: FundVaultInvestABI,
        functionName: 'tokenOwed' as const,
        args: [account, asset] as const,
      })),
      allowFailure: true,
    });
    const found: { asset: `0x${string}`; symbol: string; decimals: number; amount: bigint }[] = [];
    rows.forEach((row, index) => {
      const amount = row.status === 'success' && typeof row.result === 'bigint' ? row.result : 0n;
      if (amount > 0n) {
        const asset = assets[index] as `0x${string}`;
        const holding = invest.holdings.find((h) => h.asset.toLowerCase() === asset.toLowerCase());
        found.push({ asset, symbol: holding?.symbol ?? `${asset.slice(0, 6)}…${asset.slice(-4)}`, decimals: holding?.decimals ?? 18, amount });
      }
    });
    setOwed(found);
  }, [publicClient, account, invest, fund.vault]);

  useEffect(() => {
    void loadOwned();
    void loadOwed();
  }, [loadOwned, loadOwed]);

  const manualIds = useMemo(() => {
    const ids = manual.split(',').map((part) => part.trim()).filter(Boolean);
    const parsed: bigint[] = [];
    for (const part of ids) {
      if (!/^\d+$/.test(part)) return null;
      parsed.push(BigInt(part));
    }
    return [...new Set(parsed)];
  }, [manual]);

  const ids = manual.trim() ? manualIds ?? [] : owned ?? [];
  const selectedIds = ids.filter((id) => selected.has(id.toString()));
  const allSelected = ids.length > 0 && selectedIds.length === ids.length;

  const toggle = (id: bigint) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = id.toString();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(ids.map((id) => id.toString())));
  };

  const run = async (kind: 'refund' | 'exit') => {
    if (!publicClient || selectedIds.length === 0) return;
    setActing(kind);
    const tid = toast.loading(kind === 'refund' ? 'Confirm the refund in your wallet…' : 'Confirm the exit in your wallet…');
    try {
      const activeChainId = await publicClient.getChainId();
      if (activeChainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await writeContractAsync({
        address: fund.address,
        abi: FundNFTInvestABI,
        functionName: kind,
        chainId: robinhoodChain.id,
        args: [selectedIds],
      });
      toast.loading(kind === 'refund' ? 'Refunding on Robinhood Chain…' : 'Exiting on Robinhood Chain…', { id: tid });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      await queryClient.invalidateQueries({ queryKey: ['fund'] });
      await queryClient.invalidateQueries({ queryKey: ['funds'] });
      setSelected(new Set());
      void loadOwned();
      void loadOwed();
      toast.success(kind === 'refund' ? 'Refunded' : 'Exited', {
        id: tid,
        action: { label: 'View tx', onClick: () => window.open(getExplorerTxUrl(hash), '_blank') },
      });
    } catch (error) {
      const message = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage ?? error.message : 'Transaction failed';
      toast.error(fundTxError(message), { id: tid });
    } finally {
      setActing(null);
    }
  };

  const claim = async (asset: `0x${string}`) => {
    if (!publicClient) return;
    setClaiming(asset);
    const tid = toast.loading('Confirm the claim in your wallet…');
    try {
      const activeChainId = await publicClient.getChainId();
      if (activeChainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await writeContractAsync({
        address: fund.vault,
        abi: FundVaultInvestABI,
        functionName: 'claimOwed',
        chainId: robinhoodChain.id,
        args: [asset],
      });
      toast.loading('Claiming on Robinhood Chain…', { id: tid });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      await queryClient.invalidateQueries({ queryKey: ['fund'] });
      void loadOwed();
      toast.success('Claimed', {
        id: tid,
        action: { label: 'View tx', onClick: () => window.open(getExplorerTxUrl(hash), '_blank') },
      });
    } catch (error) {
      const message = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage ?? error.message : 'Transaction failed';
      toast.error(fundTxError(message), { id: tid });
    } finally {
      setClaiming(null);
    }
  };

  if (!invest) return null;

  const estimate = selectedIds.length > 0 && fund.totalMinted > 0n
    ? isFailed
      ? (invest.spendableEth * BigInt(selectedIds.length)) / fund.totalMinted
      : invest.navKnown
        ? invest.navPerNft * BigInt(selectedIds.length)
        : null
    : null;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">Your NFTs</h2>
      {!account && <p className="mt-2 text-[13px] text-white/60">Connect a wallet to see your NFTs and your refund or exit.</p>}
      {account && fund.balance === 0n && (
        <p className="mt-2 text-[13px] text-white/60">You hold none of these NFTs.</p>
      )}
      {account && fund.balance > 0n && (
        <>
          {owned === null && !scanFailed && (
            <p className="mt-2 flex items-center gap-2 text-[13px] text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" /> Finding your NFTs…
            </p>
          )}
          {scanFailed && (
            <p className="mt-2 text-[12px] leading-relaxed text-yellow-200/90">
              The Transfer log could not be read, so your NFTs are not listed. Paste their IDs below instead.
            </p>
          )}
          {ids.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={toggleAll} className="text-[12px] text-polydash-green hover:underline">
                {allSelected ? 'Deselect all' : `Select all (${ids.length})`}
              </button>
              <ul className="mt-2 flex flex-wrap gap-2">
                {ids.map((id) => (
                  <li key={id.toString()}>
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      className={`rounded-full border px-3 py-1 font-mono text-[12px] ${selected.has(id.toString()) ? 'border-primary/60 bg-primary/10 text-white' : 'border-white/10 bg-white/[0.03] text-white/60'}`}
                    >
                      #{id.toString()}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="mt-3 block text-xs text-muted-foreground">
            Or paste NFT IDs, comma separated
            <Input
              value={manual}
              onChange={(event) => setManual(event.target.value.replace(/[^0-9,]/g, ''))}
              placeholder="1, 2, 3"
              className="mt-1 max-w-[320px] bg-secondary/50 font-mono"
            />
          </label>
          {manual.trim() && manualIds === null && (
            <p className="mt-1 text-[12px] text-red-300">Use numbers separated by commas.</p>
          )}
          {fund.vaultStatus === 0 && (
            <p className="mt-3 text-[12px] leading-relaxed text-white/55">
              The raise is still open. A refund opens if the raise fails after its deadline; an exit opens after a successful close.
            </p>
          )}
          {isFailed && (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] leading-relaxed text-white/60">
                This raise failed. Burning NFTs returns a share of the spendable ETH. The protocol fee and any entry fee are not returned.
              </p>
              <Button onClick={() => void run('refund')} disabled={acting !== null || selectedIds.length === 0}>
                {acting === 'refund' && <Loader2 className="h-4 w-4 animate-spin" />}
                Refund {selectedIds.length > 0 ? `${selectedIds.length} NFT${selectedIds.length === 1 ? '' : 's'}` : 'NFTs'}
              </Button>
              {estimate !== null && <p className="text-[12px] text-white/50">About {formatFundEth(estimate)} ETH. Rounding dust goes to the last units.</p>}
            </div>
          )}
          {isExitable && (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] leading-relaxed text-white/60">
                Burning NFTs returns a pro-rata share of the vault: ETH, WETH, and mandate tokens. If a token transfer cannot complete, that share is reserved for you to claim below instead.
              </p>
              <Button onClick={() => void run('exit')} disabled={acting !== null || selectedIds.length === 0}>
                {acting === 'exit' && <Loader2 className="h-4 w-4 animate-spin" />}
                Exit {selectedIds.length > 0 ? `${selectedIds.length} NFT${selectedIds.length === 1 ? '' : 's'}` : 'NFTs'}
              </Button>
              {estimate !== null && <p className="text-[12px] text-white/50">About {formatFundEth(estimate)} ETH at the current NAV per NFT. A failed feed makes this blank.</p>}
              {estimate === null && !invest.navKnown && (
                <p className="text-[12px] text-yellow-200/90">NAV is unavailable — a price feed cannot be used. The exit still pays your share of the vault; the estimate is blank.</p>
              )}
            </div>
          )}
          {owed.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-white/5 pt-3">
              <p className="text-[12px] font-medium text-white/80">Reserved for you from an earlier exit</p>
              {owed.map((row) => (
                <div key={row.asset} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-white/60">
                    {row.symbol}: <span className="font-mono text-white/80">{formatTokenAmount(row.amount, row.decimals)}</span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => void claim(row.asset)} disabled={claiming !== null}>
                    {claiming === row.asset && <Loader2 className="h-4 w-4 animate-spin" />}
                    Claim
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
