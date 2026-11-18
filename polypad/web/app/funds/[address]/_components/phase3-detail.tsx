'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatEther, type Abi } from 'viem';
import { useAccount } from 'wagmi';
import { TokenAvatar } from '@/components/token-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { FundNFTPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { formatFundEth, ratioPercent } from '@/lib/fund/model';
import {
  FUND_FACTORY_PHASE3,
  P3_STATUS,
  STRATEGY_TEMPLATE,
  brakeActive,
  drawdownBps,
  p3StatusText,
  pct,
  templateName,
  utcDate,
} from '@/lib/fund/phase3';
import { usePhase3Fund, usePhase3Tx, type Phase3Detail as Detail } from '@/lib/fund/use-phase3';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BuyEthButton } from '@/components/onramp/buy-eth';
import { ContractLink, P3Badge, P3Label, P3Note } from '../../_components/phase3-ui';
import { Card, DistributionsCard, HolderActions, ManagerView, Row } from './phase3-panels';
import { Phase4Section } from './phase4-section';
import { Phase5Section } from './phase5-section';
import { Phase6Section } from './phase6-section';
import { FUND_FACTORY_V2, GLOSS, TEMPLATE2, ipfsToHttp } from '@/lib/fund/phase6';
import { useFundLedger } from '@/lib/fund/use-fund-ledger';
import { FUND_FACTORY_V3, LP_MANDATE_LINES, LP_MANDATE_TEXT, isLpTemplate } from '@/lib/fund/phase7';
import { SafeDate } from '@/components/safe-format';
import { V3Section } from './v3-section';
import { useEthPrice } from '@/lib/hooks/use-launches';
import { FundHealthStrip, HoldingsCapTable, LedgerCards, ManagerActionsHub, MandateCard, RiskMonitor } from './command-center';
import { AgentScoreBadge } from '@/components/agent-score-badge';

const FUND_PLACEHOLDER_LOGO = '/polydash-mark-white.png';

function soldExplain(sold: bigint, manager: bigint): string {
  const s = (n: bigint) => `${n.toString()} ${n === 1n ? 'share' : 'shares'}`;
  const tail = 'No trades yet — the first buy comes after the raise fills.';
  if (manager > 0n && sold === manager) return `${s(sold)} sold — the manager's locked stake. ${tail}`;
  if (manager > 0n) return `${s(sold)} sold — ${s(manager)} of them the manager's locked stake, the rest bought by investors. ${tail}`;
  return `${s(sold)} sold. ${tail}`;
}

export function Phase3Detail({ address, focusMint, v2, v3 }: { address: string; focusMint?: boolean; v2?: boolean; v3?: boolean }) {
  const { address: account } = useAccount();
  const { data: fund, isLoading, isError, refetch } = usePhase3Fund(address, account);
  const tx = usePhase3Tx();
  const ledger = useFundLedger(fund?.address, fund?.vault);
  const ethUsd = useEthPrice().data;
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!focusMint || !fund) return;
    document.getElementById('mint')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusMint, fund]);

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-container items-center justify-center gap-2 px-5 py-20 text-[13px] text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading tokenized fund…
      </div>
    );
  }
  if (isError) {
    return (
      <Missing title="Could not load this tokenized fund right now. Robinhood Chain may be busy.">
        <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">Try again</Button>
      </Missing>
    );
  }
  if (!fund) return <Missing title="No Polypad tokenized fund was found at this address" />;

  const isManager = !!account && fund.manager.toLowerCase() === account.toLowerCase();
  const status = p3StatusText(fund.status, fund.publicOpen);
  const progress = ratioPercent(fund.raised, fund.raiseCap);
  const launched = fund.status === P3_STATUS.Investing && (ledger.data?.trades.length ?? 0) > 0;
  const drop = fund.navPerNft === null ? 0 : drawdownBps(fund.peakNavPerNft, fund.navPerNft);
  const tradeCount = ledger.data ? ledger.data.trades.length : ledger.isError ? 0 : null;
  const soldNote = !launched && fund.totalMinted > 0n && (tradeCount ?? 0) === 0 ? soldExplain(fund.totalMinted, fund.managerMinted) : undefined;
  const heldHint = `${fund.outstanding.toString()} ${fund.outstanding === 1n ? 'share' : 'shares'} held now`;

  return (
    <div className="mx-auto max-w-container space-y-5 px-5 py-6 sm:px-8 sm:py-10">
      <Link href="/funds" className="inline-flex items-center gap-1.5 text-[13px] text-white/50 hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" /> Tokenized Funds
      </Link>

      <div className="flex min-w-0 items-center gap-3">
        <TokenAvatar name={fund.name} symbol={fund.symbol} imageUri={fund.imageUri || FUND_PLACEHOLDER_LOGO} size="lg" className={fund.imageUri ? undefined : 'bg-black ring-1 ring-white/20 [&>img]:object-contain [&>img]:p-2'} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-tight sm:text-[28px]">{fund.name}</h1>
            <span className="font-mono text-[13px] text-white/45">{fund.symbol}</span>
            {v2 ? <span className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80">{v3 ? 'Tokenized Fund V3' : 'Tokenized Fund V2'}</span> : <P3Badge />}
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/80">{status.label}</span>
          </div>
          <p className="mt-1 text-[13px] text-white/50">{status.explain}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-white/40">Manager {shortenAddress(fund.manager)}{isManager ? ' (you)' : ''} <AgentScoreBadge address={fund.manager} /></p>
        </div>
      </div>

      <BuyEthButton />

      <FundHealthStrip navPerShare={fund.navPerNft} hwm={fund.hwmPerNft} aumEth={fund.nav ?? fund.vaultEth} ethUsd={ethUsd} holders={ledger.data ? ledger.data.holders : null} holdersFallback={ledger.isError ? 'Not available' : undefined} sold={fund.totalMinted} max={fund.maxSupply} launched={launched} soldNote={soldNote} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Raised" value={`${formatFundEth(fund.raised)} ETH`} hint={`Goal ${formatFundEth(fund.raiseCap)} ETH`} />
        <Stat label="Share price" value={`${formatFundEth(fund.mintPrice)} ETH`} hint={heldHint} />
        <Stat label="ETH in the vault" value={`${formatFundEth(fund.vaultEth)} ETH`} hint={`${formatFundEth(fund.spendableEth)} ETH free to use`} />
        <Stat label="Trades made" value={tradeCount === null ? '…' : tradeCount === 0 ? 'None yet' : String(tradeCount)} hint={launched ? 'Investing' : 'First buy comes after the raise fills'} />
      </div>
      {fund.status === P3_STATUS.Raising && (
        <div className="space-y-1">
          <Progress value={progress} className="h-2" />
          <p className="text-[12px] text-white/45">{progress.toFixed(1)}% of the goal. Raise ends <SafeDate date={fund.raiseDeadline * 1000} options={{ dateStyle: 'medium' }} localize /> (your local time).</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {!v2 && <HoldingsCapTable rows={[]} cashEth={fund.spendableEth} ethUsd={ethUsd} loading={ledger.isLoading} />}
          <RiskMonitor drawdownBps={drop} brakeBps={fund.maxDrawdownBps} deviationBps={fund.maxDeviationBps} tradeCapBps={fund.maxTradeBps} assetCapBps={fund.maxPositionBps} brakeEvents={ledger.data?.brakeEvents} />
          <ProtectionsPanel fund={fund} />
          <MandateCard title="Strategy rules" uri={fund.mandateUri} httpUrl={ipfsToHttp(fund.mandateUri)} lines={fund.templateId === 2 ? TEMPLATE2.lines : isLpTemplate(fund.templateId) ? LP_MANDATE_LINES : undefined} fallbackText={fund.templateId === 6 ? LP_MANDATE_TEXT : undefined} hash={fund.mandateHash} tip="The rules this tokenized fund must follow, shown inline." />
          <NavHistory fund={fund} />
        </div>
        <div className="space-y-5">
          <h2 className="text-[13px] font-medium uppercase tracking-wide text-white/50">Investor actions</h2>
          <BuyCard fund={fund} isManager={isManager} tx={tx} now={now} />
          <DistributionsCard fund={fund} tx={tx} />
          <HolderActions fund={fund} tx={tx} now={now} />
        </div>
      </div>

      <LedgerCards ledger={ledger.data} loading={ledger.isLoading} feeBps={fund.hwmFeeBps} earned={fund.performanceFeeAccrued} payable={fund.claimablePerformanceFee} ethUsd={ethUsd} symbolOf={(a) => shortenAddress(a)} />

      {isManager && <ManagerActionsHub><ManagerView fund={fund} tx={tx} now={now} /></ManagerActionsHub>}

      {v2 && <Phase6Section fund={fund} isManager={isManager} tx={tx} ethUsd={ethUsd} v3={v3} />}
      {v3 && <V3Section fund={fund} isManager={isManager} tx={tx} />}

      <Phase4Section fund={fund} isManager={isManager} now={now} />
      {!v2 && <Phase5Section fund={fund} isManager={isManager} now={now} />}

      <footer className="space-y-3 border-t border-white/10 pt-5">
        <div className="flex flex-wrap gap-2">
          <ContractLink label="Tokenized fund shares" address={fund.address} />
          <ContractLink label="Vault" address={fund.vault} />
          <ContractLink label="Tokenized fund factory" address={v3 ? FUND_FACTORY_V3 : v2 ? FUND_FACTORY_V2 : FUND_FACTORY_PHASE3} />
          <ContractLink label="Strategies" address={STRATEGY_TEMPLATE} />
        </div>
        <P3Note />
      </footer>
    </div>
  );
}

type Tx = ReturnType<typeof usePhase3Tx>;

function ProtectionsPanel({ fund }: { fund: Detail }) {
  const drop = fund.navPerNft === null ? 0 : drawdownBps(fund.peakNavPerNft, fund.navPerNft);
  const brake = brakeActive(fund.maxDrawdownBps, drop);
  const skinShown = fund.managerMinted < fund.skinRequired ? fund.managerMinted : fund.skinRequired;
  return (
    <Card title="Tokenized Fund Protections" subtitle="Rules written into the tokenized fund contract. Nobody can change them after launch.">
      <Row
        label="Strategy locked"
        tip="The tokenized fund follows one strategy, chosen at launch. It sets which tokens can be bought and the trade size limits, and it cannot be swapped later."
        value={templateName(fund.templateId)}
        sub={<>{ipfsToHttp(fund.mandateUri) ? <a href={ipfsToHttp(fund.mandateUri)} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">Read the strategy rules</a> : `Rules fingerprint (mandate hash) ${shortenAddress(fund.mandateHash)}`}<span className="block">{GLOSS.strategy}</span></>}
      />
      <Row
        label="Performance fee"
        tip="The manager is paid this share of gains only when the value per share goes above its previous highest point (the high-water mark)."
        value={fund.hwmFeeBps ? pct(fund.hwmFeeBps) : 'None'}
        sub={<>{`Current high-water mark: ${fund.hwmPerNft > 0n ? `${formatFundEth(fund.hwmPerNft)} ETH per share` : 'set when investing starts'}`}<span className="block">{GLOSS.perfFee}</span></>}
      />
      <Row
        label="Manager stake locked"
        tip="The manager must buy part of the tokenized fund with their own ETH. Those shares cannot be transferred to another wallet until the unlock date."
        value={`${skinShown.toString()} of ${fund.skinRequired.toString()} shares`}
        sub={<>{fund.skinUnlockTime ? `Unlocks ${utcDate(fund.skinUnlockTime)}` : fund.managerMinted >= fund.skinRequired ? 'Locked' : 'Not bought yet'}<span className="block">{GLOSS.skin}</span></>}
      />
      <Row
        label="Drawdown brake"
        tip="If the value per share drops this far below its highest point, the tokenized fund stops making new buys until it recovers. Selling stays possible."
        value={fund.maxDrawdownBps === 0 ? 'Off' : brake ? 'Active: new buys paused' : 'Inactive'}
        sub={<>{fund.maxDrawdownBps === 0 ? 'This strategy has no brake.' : `Triggers at a ${pct(fund.maxDrawdownBps)} drop. Current drop: ${pct(drop)}.`}<span className="block">{GLOSS.brake}</span></>}
        strong={brake}
      />
    </Card>
  );
}

function NavHistory({ fund }: { fund: Detail }) {
  const log = fund.navLog;
  return (
    <Card title="Value history (NAV log)" subtitle="Each point is written on Robinhood Chain when someone records the tokenized fund value.">
      {fund.navLogError ? (
        <p className="py-6 text-center text-[13px] text-white/55">Could not read the value history right now. It will retry shortly.</p>
      ) : log.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-white/55">No value records yet. They start once the tokenized fund begins investing.</p>
      ) : (
        <>
          <NavChart points={log.map((p) => Number(formatEther(p.navPerNft)))} />
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-black text-white/45">
                <tr><th className="py-1.5 font-normal">Date (UTC)</th><th className="font-normal">Per share</th><th className="hidden font-normal sm:table-cell">High-water mark</th><th className="font-normal">Drop</th></tr>
              </thead>
              <tbody className="font-mono text-white/80">
                {log.slice(-20).reverse().map((p) => (
                  <tr key={`${p.tx}-${p.timestamp}`} className="border-t border-white/5">
                    <td className="py-1.5 font-sans text-white/60">{utcDate(p.timestamp).replace(' UTC', '')}</td>
                    <td>{formatFundEth(p.navPerNft)}</td>
                    <td className="hidden sm:table-cell">{formatFundEth(p.hwmPerNft)}</td>
                    <td>{pct(p.drawdownBps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function NavChart({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="text-[12px] text-white/45">One record so far. The chart appears after the next one.</p>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 600;
  const h = 160;
  const d = points.map((v, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 8 - ((v - min) / span) * (h - 16)).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label="Value per share over time">
        <polyline points={d} fill="none" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[11px] text-white/40">
        <span>Low {min.toFixed(6)} ETH</span><span>High {max.toFixed(6)} ETH</span>
      </div>
    </div>
  );
}

function BuyCard({ fund, isManager, tx, now }: { fund: Detail; isManager: boolean; tx: Tx; now: number }) {
  const { isConnected } = useAccount();
  const remaining = fund.maxSupply > fund.totalMinted ? fund.maxSupply - fund.totalMinted : 0n;
  const skinLeft = fund.skinRequired > fund.managerMinted ? fund.skinRequired - fund.managerMinted : 0n;
  const [qtyText, setQtyText] = useState('1');
  const qty = /^\d+$/.test(qtyText.trim()) ? BigInt(qtyText.trim()) : 0n;
  const cost = qty * fund.mintPrice;
  const open = fund.status === P3_STATUS.Raising && remaining > 0n && (!now || now <= fund.raiseDeadline);
  const blocked = !fund.publicOpen && !isManager;
  const error = qty < 1n ? 'Enter at least 1 share.' : qty > remaining ? `Only ${remaining.toString()} shares are left.` : undefined;

  return (
    <div id="mint">
      <Card title="Buy shares" subtitle={open ? `${formatFundEth(fund.mintPrice)} ETH per share. ${remaining.toString()} left.` : 'The raise is not open.'}>
        {!open ? (
          <p className="text-[13px] text-white/55">New shares can only be bought while the tokenized fund is open for investments.</p>
        ) : blocked ? (
          <p className="text-[13px] text-white/55">The manager must buy their own required shares before anyone else can join.</p>
        ) : !isConnected ? (
          <ConnectButton />
        ) : (
          <div className="space-y-3">
            {isManager && skinLeft > 0n && (
              <p className="rounded-lg bg-white/[0.06] p-3 text-[12px] text-white/75">Lock your stake: buy {skinLeft.toString()} more share{skinLeft === 1n ? '' : 's'} to open the tokenized fund to everyone.</p>
            )}
            <label className="block">
              <P3Label label="How many shares" tip="Each share is one tokenized fund token. You pay the share price for each one in ETH." />
              <Input inputMode="numeric" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
            </label>
            {error ? <p className="text-[12px] text-white/60">{error}</p> : <p className="text-[12px] text-white/55">You pay {formatFundEth(cost)} ETH. The entry fee ({pct(fund.entryFeeBps)}) and the {pct(fund.protocolFeeBps)} protocol fee come out of this amount.</p>}
            <Button
              className="w-full bg-white text-black hover:bg-white/90"
              disabled={!!error || tx.pending !== null}
              onClick={() => tx.send({ key: 'mint', address: fund.address, abi: FundNFTPhase3ABI as Abi, functionName: 'mint', args: [qty], value: cost, working: 'Buying shares', success: 'Shares bought' })}
            >
              {tx.pending === 'mint' ? <Loader2 className="h-4 w-4 animate-spin" /> : `Pay ${formatFundEth(cost)} ETH (sign 1 transaction)`}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[12px] text-white/45">{label}</p>
      <p className="mt-1 break-all font-mono text-[15px] text-white">{value}</p>
      <p className="mt-1 text-[11px] text-white/40">{hint}</p>
    </div>
  );
}

function Missing({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className={cn('mx-auto max-w-container px-5 py-20 text-center')}>
      <p className="text-white/70">{title}</p>
      {children}
      <div><Link href="/funds" className="mt-3 inline-block text-[13px] text-white/60 underline">Back to tokenized funds</Link></div>
    </div>
  );
}
