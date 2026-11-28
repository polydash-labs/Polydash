'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { formatUnits, type Abi } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FundVaultV2ABI } from '@/lib/contracts/fund-phase6-abi';
import { formatFundEth } from '@/lib/fund/model';
import { pct, utcDate } from '@/lib/fund/phase3';
import {
  POLYDASH_TOKEN, FUND_FACTORY_V2, FUND_PHASE5_V2, FUND_SWAP_FACET_V2, P6_COPY, POLYDASH_TWAP_FEED, PROPOSAL_KIND, PROPOSAL_STATUS, THESIS_LINES, UNIV4_ROUTER_ADAPTER,
  capOf, checkThesisUri, clampThesis, countdownLabel, ipfsToHttp, phase6TxError, trackRecord, type FundAsset, type ProposalView,
} from '@/lib/fund/phase6';
import { useFundAssets, useV2Holdings, useV2Proposals } from '@/lib/fund/use-phase6';
import type { Phase3Detail, usePhase3Tx } from '@/lib/fund/use-phase3';
import { shortenAddress } from '@/lib/format';
import { AssetPicker, allowlistNote } from '../../_components/asset-picker';
import { ContractLink, Tip } from '../../_components/phase3-ui';
import { Card } from './phase3-panels';
import { ProposalCountdown, ProposalForm, ProposalHistory } from './proposal-ui';
import { HoldingsCapTable, ManagerActionsHub } from './command-center';
import { useEthPrice } from '@/lib/hooks/use-launches';
import { AllowlistMenu } from '../../_components/allowlist-menu';

type Tx = ReturnType<typeof usePhase3Tx>;

function useSecondTicker(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Phase6Section({ fund, isManager, tx, ethUsd: ethUsdProp, v3 }: { fund: Phase3Detail; isManager: boolean; tx: Tx; ethUsd?: number | null; v3?: boolean }) {
  const now = useSecondTicker();
  const proposals = useV2Proposals(fund.vault);
  const holdings = useV2Holdings(fund.vault, fund.vaultEth);
  const assets = useFundAssets(true);
  const ownEthUsd = useEthPrice().data;
  const ethUsd = ethUsdProp ?? ownEthUsd;
  // V3 pages (Polyfund and other Strategy #6–#9 funds) show the strategy
  // asset's own cap first; the 30% default for newly proposed assets is a
  // separate line so both figures are visible (round 1 filtered the 30%
  // line out here entirely, leaving only the 80%).
  const guardrails = v3
    ? [
        `At most ${pct(fund.maxPositionBps)} of the tokenized fund in POLYDASH (this Strategy's own per-asset cap)`,
        'A newly proposed asset is capped at 30% of the tokenized fund by default.',
        ...P6_COPY.guardrails.filter((g) => !/30%/.test(g)),
      ]
    : P6_COPY.guardrails;
  const symbols = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assets.data?.assets ?? []) m.set(a.address.toLowerCase(), a.symbol);
    for (const h of holdings.data ?? []) if (h.asset !== 'ETH') m.set(h.asset.toLowerCase(), h.symbol);
    return m;
  }, [assets.data, holdings.data]);
  const name = (a: string) => symbols.get(a.toLowerCase()) ?? shortenAddress(a);
  const { inFund, waiting } = useMemo(() => {
    const inSet = new Set<string>();
    const wait = new Map<string, number>();
    for (const h of holdings.data ?? []) if (h.asset !== 'ETH') inSet.add(h.asset.toLowerCase());
    for (const p of proposals.data?.list ?? []) {
      if (p.kind !== 0) continue;
      if (p.status === 1) inSet.add(p.asset.toLowerCase());
      if (p.status === 0) wait.set(p.asset.toLowerCase(), p.readyAt);
    }
    return { inFund: inSet, waiting: wait };
  }, [holdings.data, proposals.data]);

  const list = proposals.data?.list ?? [];
  const pending = list.filter((p) => p.status === 0);
  const past = list.filter((p) => p.status !== 0);
  const thesis = list.find((p) => p.kind === 0 && p.status !== 2 && (p.reason || p.thesisUri));
  const record = trackRecord(list);

  return (
    <section id="tokenized-fund-assets" className="space-y-5 border-t border-white/10 pt-5">
      <div>
        <h2 className="text-[17px] font-semibold text-white">Manager plan and assets</h2>
        <p className="mt-0.5 text-[12px] text-white/45">What this Tokenized Fund holds, what the manager wants to add, and the rules that limit it.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Manager's thesis" subtitle="Why the manager picked these assets, in their own words.">
          {proposals.isLoading ? <Loading /> : thesis ? (
            <div className="space-y-2">
              <p className="line-clamp-3 whitespace-pre-line text-[14px] leading-relaxed text-white/85">{thesis.reason || 'No summary was written.'}</p>
              {ipfsToHttp(thesis.thesisUri) && (
                <a href={ipfsToHttp(thesis.thesisUri)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-white/70 underline-offset-4 hover:text-white hover:underline">
                  Read the full write-up (IPFS) <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <p className="text-[11px] text-white/40">From proposal #{thesis.id} ({name(thesis.asset)}).</p>
            </div>
          ) : <Empty text="The manager has not written a thesis yet. It appears here with their first asset proposal." />}
        </Card>

        <Card title="Guardrails" subtitle="Rules the tokenized fund contract enforces.">
          <ul className="space-y-2 text-[13px] leading-relaxed text-white/75">
            {guardrails.map((g) => <li key={g} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/50" />{g}</li>)}
          </ul>
        </Card>
      </div>

      <Card title="Waiting proposals" subtitle="New assets wait 2 days in public before the manager can add them. You can leave the tokenized fund during the wait.">
        {proposals.isLoading ? <Loading /> : pending.length === 0 ? <Empty text="No proposals are waiting right now." /> : (
          <div className="space-y-3">
            {pending.map((p) => (
              <PendingRow key={p.id} p={p} label={name(p.asset)} now={now} isManager={isManager} tx={tx} vault={fund.vault} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <HoldingsCapTable
          loading={holdings.isLoading}
          error={holdings.isError}
          ethUsd={ethUsd}
          cashEth={fund.spendableEth}
          rows={(holdings.data ?? []).filter((h) => h.asset !== 'ETH' && h.balance > 0n).map((h) => {
            const a = (h.asset as string).toLowerCase();
            const prop = list.find((p) => p.kind === 0 && p.status === 1 && p.asset.toLowerCase() === a);
            const tmpl = a === POLYDASH_TOKEN;
            return { key: a, symbol: h.symbol, valueEth: h.valueEth, bps: h.bps, capBps: tmpl ? 8000 : capOf(prop?.capBps ?? 0), capNote: tmpl ? 'Strategy asset cap' : prop ? 'Set in its proposal' : 'Default cap' };
          })}
        />

        <Card title="Proposal history and track record" subtitle="Every proposal this manager has made for this tokenized fund.">
          <div className="mb-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
            <Mini label="Proposed" value={record.total} />
            <Mini label="Added" value={record.added} />
            <Mini label="Cancelled" value={record.cancelled} />
            <Mini label="Trades made" value={proposals.data?.tradeCount ?? 0} />
          </div>
          <ProposalHistory list={list.slice(0, 30)} now={now} nameOf={name} title={isManager ? 'Your proposals' : 'Manager proposals'} weightOf={(a) => holdings.data?.find((h) => h.asset !== 'ETH' && h.asset.toLowerCase() === a.toLowerCase())?.bps ?? null} />
        </Card>
      </div>

      <AllowlistMenu title="Tokens a manager can invest in (approved list, read live)" />
      {isManager && <ProposeAssets fund={fund} tx={tx} inFund={inFund} waiting={waiting} />}

      <div className="flex flex-wrap gap-2">
        {!v3 && <ContractLink label="Tokenized Fund factory (V2)" address={FUND_FACTORY_V2} />}
        {!v3 && <ContractLink label="Swap module (V2)" address={FUND_SWAP_FACET_V2} />}
        <ContractLink label="Uniswap V4 router adapter" address={UNIV4_ROUTER_ADAPTER} />
        <ContractLink label="POLYDASH price feed (TWAP)" address={POLYDASH_TWAP_FEED} />
        {!v3 && <ContractLink label="FundPhase5" address={FUND_PHASE5_V2} />}
      </div>
      <p className="text-[12px] text-white/45">{P6_COPY.nfa}</p>
    </section>
  );
}

function PendingRow({ p, label, now, isManager, tx, vault }: { p: ProposalView; label: string; now: number; isManager: boolean; tx: Tx; vault: `0x${string}` }) {
  const left = now ? p.readyAt - now : 0;
  const ready = !!now && left <= 0;
  const add = p.kind === 0;
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] text-white">#{p.id} {add ? 'Add' : 'Remove'} <span className="font-semibold">{label}</span></p>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80" suppressHydrationWarning>{ready ? 'Executable' : 'Waiting'}</span>
      </div>
      <div className="mt-2"><ProposalCountdown readyAt={p.readyAt} now={now} /></div>
      <p className="mt-1 text-[12px] text-white/55">
        {add ? <>Proposed share of the tokenized fund: at most <span className="text-white">{pct(capOf(p.capBps))}</span>. </> : null}
      </p>
      {p.reason && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[12px] text-white/60">{p.reason}</p>}
      {isManager && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" disabled={!ready || !!tx.pending} onClick={() => tx.send({
            key: `exec-${p.id}`, address: vault, abi: FundVaultV2ABI as unknown as Abi, functionName: add ? 'executeAsset' : 'executeRemoval', args: [BigInt(p.id)],
            success: add ? `${label} added to the tokenized fund` : `${label} removed from the tokenized fund`, working: 'Updating the tokenized fund', mapError: phase6TxError,
          })}>
            {tx.pending === `exec-${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {add ? 'Add to tokenized fund' : 'Remove from tokenized fund'} (sign 1 transaction)
          </Button>
          <Button size="sm" variant="outline" disabled={!!tx.pending} onClick={() => tx.send({
            key: `cancel-${p.id}`, address: vault, abi: FundVaultV2ABI as unknown as Abi, functionName: 'cancelProposal', args: [BigInt(p.id)],
            success: 'Proposal cancelled', working: 'Cancelling', mapError: phase6TxError,
          })}>
            Cancel proposal (sign 1 transaction)
          </Button>
        </div>
      )}
    </div>
  );
}

function ProposeAssets({ fund, tx, inFund, waiting }: { fund: Phase3Detail; tx: Tx; inFund: Set<string>; waiting: Map<string, number> }) {
  const [picked, setPicked] = useState<FundAsset | null>(null);
  const submit = async (d: { capBps: number; reason: string; uri: string }) => {
    if (!picked) return;
    const r = await tx.send({
      key: 'propose', address: fund.vault, abi: FundVaultV2ABI as unknown as Abi, functionName: 'proposeAsset',
      args: [picked.address as `0x${string}`, BigInt(d.capBps), d.reason, d.uri],
      success: `${picked.symbol} proposed. The 2-day wait has started.`, working: 'Sending the proposal', mapError: phase6TxError,
    });
    if (r) setPicked(null);
  };

  return (
    <ManagerActionsHub>
      <Card title="Propose an asset" subtitle={P6_COPY.proposeTip}>
        <div className="space-y-4">
          <AssetPicker excluded={[fund.address]} inFund={inFund} waiting={waiting} pickedAddress={picked?.address} onPick={setPicked} />
          {picked && (
            <ProposalForm
              key={picked.address}
              picked={{ symbol: picked.symbol, name: picked.name, note: picked.allowed ? undefined : `${allowlistNote(picked)} You can propose it now; it can only be added once it is on the approved list.` }}
              aumEth={fund.nav ?? fund.vaultEth}
              spendableEth={fund.spendableEth}
              tradeCapBps={fund.maxTradeBps}
              onSubmit={submit}
              pending={tx.pending === 'propose'}
              onClose={() => setPicked(null)}
            />
          )}
          <p className="text-[11px] text-white/40">{P6_COPY.nfa} Execute ready proposals from the Waiting proposals list above.</p>
        </div>
      </Card>
    </ManagerActionsHub>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-white/5 px-2 py-1.5"><p className="text-white/45">{label}</p><p className="text-[14px] font-semibold text-white">{value}</p></div>;
}
function Loading() {
  return <p className="flex items-center gap-2 text-[12px] text-white/45"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>;
}
function Empty({ text }: { text: string }) {
  return <p className="text-[13px] text-white/45">{text}</p>;
}
