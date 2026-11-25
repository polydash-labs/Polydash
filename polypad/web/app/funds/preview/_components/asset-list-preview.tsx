'use client';

import { useMemo, useState } from 'react';
import { POLYDASH_TOKEN, P6_COPY, TEMPLATE2, ipfsToHttp, type FundAsset, type ProposalView } from '@/lib/fund/phase6';
import type { FundLedger } from '@/lib/fund/use-fund-ledger';
import { AssetPicker } from '../../_components/asset-picker';
import { FundHealthStrip, HoldingsCapTable, LedgerCards, ManagerActionsHub, MandateCard, RiskMonitor, useSecondTicker } from '../../[address]/_components/command-center';
import { ProposalCountdown, ProposalForm, ProposalHistory } from '../../[address]/_components/proposal-ui';

const SAMPLE_READY_AT = 1794496667; // Nov 12 2026, 15:17:47 UTC — sample only
const EMPTY_LEDGER: FundLedger = { holders: 0, trades: [], distributions: [], fees: [], feesWithdrawn: 0n, brakeEvents: 0 };
const SAMPLE: ProposalView[] = [{ id: 0, asset: POLYDASH_TOKEN as `0x${string}`, capBps: 8000, reason: 'Strategy asset of the Polydash Growth Tokenized Fund.\nSample entry for this preview.', thesisUri: TEMPLATE2.mandateUri, readyAt: SAMPLE_READY_AT, status: 0, kind: 0 }];

/**
 * Read-only demo of the V2 tokenized fund manager command center with the Polydash Growth Tokenized Fund's
 * expected state before its first buy. No wallet, no transactions, submitting is turned off.
 */
export function AssetListPreview() {
  const [picked, setPicked] = useState<FundAsset | null>(null);
  const inFund = useMemo(() => new Set([POLYDASH_TOKEN]), []);
  const waiting = useMemo(() => new Map<string, number>(), []);
  const now = useSecondTicker();
  return (
    <div className="space-y-5">
      <div>
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100">Preview only — no proposal is created and no wallet is needed</p>
        <h1 className="mt-3 text-[22px] font-semibold text-white">Tokenized fund command center</h1>
        <p className="mt-1 max-w-3xl text-[13px] text-white/55">
          The manager screen of a V2 tokenized fund, shown with the expected state of the {TEMPLATE2.name} (Strategy #2) before its first buy. Its strategy asset is POLYDASH. {P6_COPY.proposeTip}
        </p>
      </div>
      <FundHealthStrip navPerShare={null} hwm={0n} aumEth={null} ethUsd={null} holders={0} sold={0n} max={10000n} launched={false} />
      <div className="grid gap-5 lg:grid-cols-2">
        <HoldingsCapTable rows={[]} ethUsd={null} />
        <RiskMonitor drawdownBps={0} brakeBps={2000} deviationBps={500} tradeCapBps={1000} assetCapBps={3000} />
      </div>
      <div className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10">
        <h2 className="mb-2 text-[14px] font-semibold text-white">Sample waiting proposal</h2>
        <ProposalCountdown readyAt={SAMPLE_READY_AT} now={now} />
      </div>
      <MandateCard title="Rules of this tokenized fund (mandate)" uri={TEMPLATE2.mandateUri} httpUrl={ipfsToHttp(TEMPLATE2.mandateUri)} lines={TEMPLATE2.lines} />
      <ManagerActionsHub preview>
        <AssetPicker excluded={[]} inFund={inFund} waiting={waiting} pickedAddress={picked?.address} onPick={setPicked} />
        {picked && (
          <ProposalForm picked={{ symbol: picked.symbol, name: picked.name }} aumEth={null} spendableEth={null} tradeCapBps={1000} previewNote="Submitting is turned off in this preview" onClose={() => setPicked(null)} />
        )}
        <ProposalHistory list={SAMPLE} now={now} nameOf={() => 'POLYDASH'} title="Your proposals (sample)" />
      </ManagerActionsHub>
      <LedgerCards ledger={EMPTY_LEDGER} loading={false} feeBps={500} earned={0n} payable={0n} ethUsd={null} symbolOf={() => 'token'} />
      <p className="text-[11px] text-white/40">{P6_COPY.nfa}</p>
    </div>
  );
}
