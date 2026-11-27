'use client';

import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowDown, Loader2 } from 'lucide-react';
import { useAccount, useReadContract, useWriteContract, useSwitchChain, usePublicClient } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { parseEther, formatEther } from 'viem';
import type { LaunchToken } from '@/lib/token-types';
import { PHASE } from '@/lib/token-types';
import { PolydashLaunchABI, PolydashTokenABI } from '@/lib/contracts/abis';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
import { toast } from 'sonner';
import { OnrampInline, RelayBuyCard } from '@/components/onramp/buy-eth';
import { PrivySignInRow } from '@/components/privy/privy-auth';

function safeParse(v: string): bigint {
  try { const s = (v || '').trim(); return s ? parseEther(s) : BigInt(0); } catch { return BigInt(0); }
}
const fmt = (wei: bigint | undefined, max = 6) =>
  Number(formatEther(wei ?? BigInt(0))).toLocaleString('en-US', { maximumFractionDigits: max });

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(sec)}s` : `${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
}

export function TradePanel({ token }: { token: LaunchToken | null }) {
  const { isConnected, address: user, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [buyAmount, setBuyAmount] = useState('');
  const [sellAmount, setSellAmount] = useState('');
  const [commitAmount, setCommitAmount] = useState('');
  const [slippage, setSlippage] = useState('1');
  const [busy, setBusy] = useState<string | null>(null);

  const launch = (token?.launchAddress ?? '') as `0x${string}`;
  const tokenAddr = (token?.tokenAddress ?? '') as `0x${string}`;
  const phase = token?.phase ?? 0;
  const isPreLaunch = phase === PHASE.Pending;
  const isProcessing = phase === PHASE.Processing;
  const isGraduated = phase === PHASE.Graduated;
  const isTrading = phase === PHASE.Trading;
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const launchAt = token?.launchTime ?? 0;
  const windowOpen = isPreLaunch && now > 0 && now < launchAt;
  const canGoLive = isPreLaunch && now > 0 && now >= launchAt;
  const enabled = !!token && /^0x[0-9a-fA-F]{40}$/.test(launch);

  const ethIn = safeParse(buyAmount);
  const tokensIn = safeParse(sellAmount);
  const commitWei = safeParse(commitAmount);

  const { data: buyQuote } = useReadContract({
    address: launch, abi: PolydashLaunchABI, functionName: 'quoteBuy', args: [ethIn], chainId: robinhoodChain.id,
    query: { enabled: enabled && isTrading && ethIn > BigInt(0) },
  });
  const { data: sellQuote } = useReadContract({
    address: launch, abi: PolydashLaunchABI, functionName: 'quoteSell', args: [tokensIn], chainId: robinhoodChain.id,
    query: { enabled: enabled && isTrading && tokensIn > BigInt(0) },
  });
  const { data: balance, refetch: refetchBal } = useReadContract({
    address: tokenAddr, abi: PolydashTokenABI, functionName: 'balanceOf', args: [user ?? '0x0000000000000000000000000000000000000000'], chainId: robinhoodChain.id,
    query: { enabled: enabled && !!user },
  });
  const { data: myCommit, refetch: refetchCommit } = useReadContract({
    address: launch, abi: PolydashLaunchABI, functionName: 'commitments', args: [user ?? '0x0000000000000000000000000000000000000000'], chainId: robinhoodChain.id,
    query: { enabled: enabled && !!user },
  });

  const { data: myRefund, refetch: refetchRefund } = useReadContract({
    address: launch, abi: PolydashLaunchABI, functionName: 'refunds', args: [user ?? '0x0000000000000000000000000000000000000000'], chainId: robinhoodChain.id,
    query: { enabled: enabled && !!user },
  });

  const tokensOut = buyQuote?.[0];
  const ethOut = sellQuote?.[0];
  const slipBps = BigInt(Math.round(parseFloat(slippage) * 100));
  const withSlippage = (v: bigint) => (v * (BigInt(10000) - slipBps)) / BigInt(10000);

  const run = async (label: string, fn: () => Promise<`0x${string}`>) => {
    if (!publicClient) return;
    setBusy(label);
    const tid = toast.loading('Confirm the transaction in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await fn();
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(`${label} confirmed`, { id: tid, action: { label: 'View tx', onClick: () => window.open(getExplorerTxUrl(hash), '_blank') } });
      refetchBal(); refetchCommit(); refetchRefund();
      queryClient.invalidateQueries({ queryKey: ['launch'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['launches'] });
      return true;
    } catch (e: any) {
      console.error(`${label} failed`, e);
      const msg = e?.shortMessage ?? e?.message ?? 'Transaction failed';
      toast.error(msg.includes('User rejected') || msg.includes('denied') ? 'Transaction cancelled' : msg, { id: tid });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const handleBuy = async () => {
    if (!tokensOut || tokensOut === BigInt(0)) { toast.error('Could not get a price quote. Try again.'); return; }
    const ok = await run('Buy', () => writeContractAsync({
      address: launch, abi: PolydashLaunchABI, functionName: 'buy', args: [withSlippage(tokensOut)], value: ethIn, chainId: robinhoodChain.id,
    }));
    if (ok) setBuyAmount('');
  };

  const handleSell = async () => {
    if (!user || !publicClient) return;
    if ((balance ?? BigInt(0)) < tokensIn) { toast.error('Not enough tokens in your wallet.'); return; }
    if (!ethOut) { toast.error('Could not get a price quote. Try again.'); return; }
    const allowance = (await publicClient.readContract({ address: tokenAddr, abi: PolydashTokenABI, functionName: 'allowance', args: [user, launch] })) as bigint;
    if (allowance < tokensIn) {
      const approved = await run('Approval', () => writeContractAsync({
        address: tokenAddr, abi: PolydashTokenABI, functionName: 'approve', args: [launch, tokensIn], chainId: robinhoodChain.id,
      }));
      if (!approved) return;
    }
    const ok = await run('Sell', () => writeContractAsync({
      address: launch, abi: PolydashLaunchABI, functionName: 'sell', args: [tokensIn, withSlippage(ethOut)], chainId: robinhoodChain.id,
    }));
    if (ok) setSellAmount('');
  };

  const handleCommit = async () => {
    if (commitWei < parseEther('0.0001')) { toast.error('Minimum commitment is 0.0001 ETH.'); return; }
    const ok = await run('Commit', () => writeContractAsync({
      address: launch, abi: PolydashLaunchABI, functionName: 'commit', value: commitWei, chainId: robinhoodChain.id,
    }));
    if (ok) setCommitAmount('');
  };

  const handleUncommit = () => run('Withdraw commitment', () => writeContractAsync({
    address: launch, abi: PolydashLaunchABI, functionName: 'uncommit', chainId: robinhoodChain.id,
  }));

  const handleGoLive = () => run('Launch', () => writeContractAsync({
    address: launch, abi: PolydashLaunchABI, functionName: 'goLive', chainId: robinhoodChain.id,
  }));

  const handleProcessBatch = () => run('Process commitments', () => writeContractAsync({
    address: launch, abi: PolydashLaunchABI, functionName: 'processCommitmentBatch', args: [BigInt(200)], chainId: robinhoodChain.id,
  }));

  const handleWithdrawUnprocessed = () => run('Withdraw commitment', () => writeContractAsync({
    address: launch, abi: PolydashLaunchABI, functionName: 'withdrawUnprocessedCommitment', chainId: robinhoodChain.id,
  }));

  const handleClaimRefund = () => run('Refund', () => writeContractAsync({
    address: launch, abi: PolydashLaunchABI, functionName: 'claimRefund', chainId: robinhoodChain.id,
  }));

  const hasCommit = (myCommit ?? BigInt(0)) > BigInt(0);
  const hasRefund = (myRefund ?? BigInt(0)) > BigInt(0);
  const pendingBatches = Math.max(0, (token?.committers ?? 0) - (token?.commitmentCursor ?? 0));

  const connectBtn = (
    <ConnectButton.Custom>
      {({ openConnectModal }: any) => (
        <Button onClick={openConnectModal} className="w-full">Connect wallet</Button>
      )}
    </ConnectButton.Custom>
  );
  const notTradingMsg = phase === PHASE.Graduated
    ? 'This token has graduated. It now trades on Uniswap V4 — see DexScreener for the live chart.'
    : isPreLaunch || isProcessing ? 'Trading has not started yet. Use the Commit tab.' : 'Trading is not open right now.';

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <Tabs key={isPreLaunch || isProcessing ? 'pre' : 'live'} defaultValue={isPreLaunch || isProcessing ? 'commit' : 'buy'} className="w-full">
        <TabsList className="grid h-10 w-full grid-cols-3 rounded-full bg-white/[0.05] p-1">
          <TabsTrigger value="buy" className="rounded-full text-[13px] data-[state=active]:bg-polydash-green data-[state=active]:text-black">Buy</TabsTrigger>
          <TabsTrigger value="sell" className="rounded-full text-[13px] data-[state=active]:bg-[#FF5252] data-[state=active]:text-white">Sell</TabsTrigger>
          <TabsTrigger value="commit" className="rounded-full text-[13px] data-[state=active]:bg-white/15 data-[state=active]:text-white">Commit</TabsTrigger>
        </TabsList>

        {/* BUY */}
        <TabsContent value="buy" className="space-y-4 pt-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">You pay (ETH)</label>
            <Input type="number" placeholder="0.0" value={buyAmount}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBuyAmount(e?.target?.value ?? '')}
              className="font-mono bg-secondary/50" />
          </div>
          <div className="flex justify-center">
            <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">You receive (est., after fees)</label>
            <div className="bg-secondary/50 rounded-lg px-3 py-2.5 font-mono text-sm">
              {fmt(tokensOut, 2)} {token?.symbol ?? ''}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Slippage tolerance</label>
            <div className="flex gap-1.5">
              {['0.5', '1', '2', '5'].map((s) => (
                <button key={s} onClick={() => setSlippage(s)}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                    slippage === s ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'
                  }`}>
                  {s}%
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">If the price moves while your trade runs, this is the most it can move before the trade stops instead of giving you a bad price. 1% is the usual choice.</p>
          </div>
          {!isConnected ? (
            <div className="space-y-2">
              {connectBtn}
              <PrivySignInRow />
            </div>
          ) : !isTrading ? (
            <p className="text-xs text-center text-muted-foreground py-2">{notTradingMsg}</p>
          ) : (
            <Button onClick={handleBuy} className="w-full gap-2" disabled={ethIn <= BigInt(0) || !!busy}>
              {busy === 'Buy' && <Loader2 className="h-4 w-4 animate-spin" />}
              Buy {token?.symbol ?? 'Token'}
            </Button>
          )}
          {isConnected && isTrading && ethIn > BigInt(0) && (
            <RelayBuyCard totalNeededWei={ethIn + 1_000_000_000_000_000n} />
          )}
          <OnrampInline />
        </TabsContent>

        {/* SELL */}
        <TabsContent value="sell" className="space-y-4 pt-4">
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs text-muted-foreground">You sell ({token?.symbol ?? 'Token'})</label>
              {isConnected && (
                <button className="text-xs text-muted-foreground hover:text-primary font-mono"
                  onClick={() => setSellAmount(formatEther(balance ?? BigInt(0)))}>
                  Balance: {fmt(balance, 2)}
                </button>
              )}
            </div>
            <Input type="number" placeholder="0" value={sellAmount}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSellAmount(e?.target?.value ?? '')}
              className="font-mono bg-secondary/50" />
          </div>
          <div className="flex justify-center">
            <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">You receive (est., after fees)</label>
            <div className="bg-secondary/50 rounded-lg px-3 py-2.5 font-mono text-sm">{fmt(ethOut)} ETH</div>
          </div>
          {!isConnected ? connectBtn : !isTrading ? (
            <p className="text-xs text-center text-muted-foreground py-2">{notTradingMsg}</p>
          ) : (
            <Button onClick={handleSell} variant="secondary" className="w-full gap-2" disabled={tokensIn <= BigInt(0) || !!busy}>
              {(busy === 'Sell' || busy === 'Approval') && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy === 'Approval' ? 'Approving…' : `Sell ${token?.symbol ?? 'Token'}`}
            </Button>
          )}
        </TabsContent>

        {/* COMMIT */}
        <TabsContent value="commit" className="space-y-4 pt-4">
          {(isPreLaunch || isProcessing) && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-secondary/30 rounded-lg px-3 py-2">
                <div className="text-muted-foreground">Committed</div>
                <div className="font-mono text-foreground">{(token?.totalCommitted ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 })} ETH</div>
              </div>
              <div className="bg-secondary/30 rounded-lg px-3 py-2">
                <div className="text-muted-foreground">Committers</div>
                <div className="font-mono text-foreground">{token?.committers ?? 0}</div>
              </div>
            </div>
          )}

          {isPreLaunch && (
            <>
              {windowOpen ? (
                <div className="bg-secondary/30 rounded-lg px-3 py-2.5 text-xs flex items-center justify-between">
                  <span className="text-muted-foreground">Trading opens in</span>
                  <span className="font-mono text-foreground">{formatCountdown(launchAt - now)}</span>
                </div>
              ) : canGoLive ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">The commitment window has ended. Anyone can start trading now.</p>
                  {!isConnected ? connectBtn : (
                    <Button onClick={handleGoLive} className="w-full gap-2" disabled={!!busy}>
                      {busy === 'Launch' && <Loader2 className="h-4 w-4 animate-spin" />} Launch now
                    </Button>
                  )}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">Committed ETH buys at the opening price when trading starts. You can withdraw any time before then.</p>
              {isConnected && hasCommit && (
                <div className="flex items-center justify-between bg-secondary/30 rounded-lg px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Your commitment: <span className="font-mono text-foreground">{fmt(myCommit)} ETH</span></span>
                  <button onClick={handleUncommit} disabled={!!busy} className="text-destructive hover:underline">Withdraw</button>
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Commit (ETH, min 0.0001)</label>
                <Input type="number" placeholder="0.0" value={commitAmount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCommitAmount(e?.target?.value ?? '')}
                  className="font-mono bg-secondary/50" />
              </div>
              {!isConnected ? (canGoLive ? null : connectBtn) : (
                <Button onClick={handleCommit} variant={canGoLive ? 'secondary' : 'default'} className="w-full gap-2" disabled={commitWei <= BigInt(0) || !!busy}>
                  {busy === 'Commit' && <Loader2 className="h-4 w-4 animate-spin" />} Commit ETH
                </Button>
              )}
            </>
          )}

          {(isProcessing || (isGraduated && pendingBatches > 0)) && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Processing commitments: {pendingBatches} remaining. Anyone can process the next batch{isProcessing ? '; trading opens when all are done' : ''}.
              </p>
              {!isConnected ? connectBtn : (
                <Button onClick={handleProcessBatch} variant="secondary" className="w-full gap-2" disabled={!!busy || pendingBatches === 0}>
                  {busy === 'Process commitments' && <Loader2 className="h-4 w-4 animate-spin" />} Process next batch
                </Button>
              )}
            </div>
          )}

          {isGraduated && isConnected && hasCommit && (
            <div className="flex items-center justify-between bg-secondary/30 rounded-lg px-3 py-2 text-xs">
              <span className="text-muted-foreground">Unprocessed: <span className="font-mono text-foreground">{fmt(myCommit)} ETH</span></span>
              <button onClick={handleWithdrawUnprocessed} disabled={!!busy} className="text-primary hover:underline">Withdraw</button>
            </div>
          )}

          {isConnected && hasRefund && (
            <Button onClick={handleClaimRefund} variant="secondary" className="w-full gap-2" disabled={!!busy}>
              {busy === 'Refund' && <Loader2 className="h-4 w-4 animate-spin" />} Claim refund ({fmt(myRefund)} ETH)
            </Button>
          )}

          {(isTrading || (isGraduated && pendingBatches === 0 && !hasCommit)) && !hasRefund && (
            <p className="text-xs text-center text-muted-foreground py-4">The commitment phase is over.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
