'use client';

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { isAddress, type Abi } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FundPhase4ABI } from '@/lib/contracts/fund-phase4-abi';
import { FundVaultPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { formatFundEth } from '@/lib/fund/model';
import { P3_STATUS, utcDate } from '@/lib/fund/phase3';
import { FUND_PHASE4, FUND_SHARE_ACCOUNT, P4_COPY, canCloseSeason, endTimeFromDays, optionalEth, phase4Live, signedPct } from '@/lib/fund/phase4';
import type { Phase3Detail } from '@/lib/fund/use-phase3';
import { usePhase4Fund, usePhase4Tx } from '@/lib/fund/use-phase4';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ContractLink } from '../../_components/phase3-ui';
import { Card, Row } from './phase3-panels';
import { CopyMandate, OfferToBuy, ShareWallet } from './phase4-actions';

export type P4Tx = ReturnType<typeof usePhase4Tx>;
const P4 = FundPhase4ABI as Abi;
const VAULT = FundVaultPhase3ABI as Abi;

/** Plain-language tip shown under a control. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-white/50">{children}</p>;
}

export function Nfa() {
  return <p className="text-[11px] text-white/40">{P4_COPY.nfa}</p>;
}

export function P4Button({ tx, id, label, disabled, onClick, primary }: { tx: P4Tx; id: string; label: string; disabled?: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <Button
      variant={primary ? 'default' : 'outline'}
      className={cn('w-full whitespace-normal', primary && 'bg-white text-black hover:bg-white/90')}
      disabled={disabled || tx.pending !== null || !phase4Live()}
      onClick={onClick}
    >
      {tx.pending === id ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
    </Button>
  );
}

export function ConnectHint() {
  return <div className="space-y-2"><Hint>Connect a wallet to use this.</Hint><ConnectButton /></div>;
}

export function Phase4Section({ fund, isManager, now }: { fund: Phase3Detail; isManager: boolean; now: number }) {
  const live = phase4Live();
  const tx = usePhase4Tx();
  return (
    <section id="phase4" className="space-y-4 border-t border-white/10 pt-5">
      <div>
        <h2 className="flex items-center gap-2 text-[18px] font-semibold text-white">
          Phase 4 add-ons
          <span className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80">Phase 4</span>
        </h2>
        <p className="mt-1 text-[13px] text-white/55">Extra tools that read this tokenized fund. The share stays the ownership claim. Leaving the tokenized fund still works the same way.</p>
      </div>
      {!live ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-5 text-[13px] text-white/60">{P4_COPY.notLive}</div>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <ReportCard fund={fund} tx={tx} now={now} />
            <CopyMandate fund={fund} tx={tx} />
            <OfferToBuy fund={fund} tx={tx} now={now} />
            <ShareWallet fund={fund} tx={tx} />
          </div>
          {isManager && <TradingAgent fund={fund} tx={tx} now={now} />}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {FUND_PHASE4 && <ContractLink label="FundPhase4" address={FUND_PHASE4} />}
        {FUND_SHARE_ACCOUNT && <ContractLink label="FundShareAccount" address={FUND_SHARE_ACCOUNT} />}
      </div>
      <p className="text-[12px] text-white/45">{P4_COPY.note}</p>
    </section>
  );
}

function ReportCard({ fund, tx, now }: { fund: Phase3Detail; tx: P4Tx; now: number }) {
  const { data, isLoading } = usePhase4Fund(fund.address, fund.vault);
  const card = data?.card ?? null;
  const investing = fund.status === P3_STATUS.Investing;
  const open = data?.openSeason ?? null;
  const closed = (data?.seasons ?? []).filter((s) => s.closed);
  const p4 = FUND_PHASE4 as `0x${string}`;
  return (
    <Card title="Report card">
      <Hint>{P4_COPY.cardTip}</Hint>
      <div className="mt-3">
        {isLoading ? (
          <p className="flex items-center gap-2 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Reading…</p>
        ) : !card ? (
          <div><p className="text-[14px] text-white">Not started yet</p><Hint>The live reading appears once the tokenized fund starts investing.</Hint></div>
        ) : (
          <>
            <Row label="Net value" tip="Everything the tokenized fund holds, valued in ETH." value={`${formatFundEth(card.navTotal)} ETH`} />
            <Row label="Net value per share" tip="Net value divided by the shares that exist now." value={`${formatFundEth(card.navPerShare)} ETH`} />
            <Row label="High-water mark" tip="The highest net value per share used for the performance fee." value={card.hwmPerShare > 0n ? `${formatFundEth(card.hwmPerShare)} ETH` : 'Not set yet'} />
            <Row label="Drop from the peak" tip="How far net value per share is below its highest recorded point." value={signedPct(-card.drawdownBps)} />
            <Row label="Trade count" tip="Trades the vault has made so far." value={card.tradeCount.toString()} />
          </>
        )}
      </div>
      <div className="mt-4 space-y-3 border-t border-white/5 pt-3">
        {!tx.account ? <ConnectHint /> : (
          <>
            <P4Button tx={tx} id="open" label="Start a card (sign 1 transaction)" disabled={!investing || !!data?.seasonOpen}
              onClick={() => tx.send({ key: 'open', address: p4, abi: P4, functionName: 'openSeason', args: [fund.address], working: 'Starting the card', success: 'Card started' })} />
            <Hint>{!investing ? 'Cards can start once the tokenized fund is investing.' : data?.seasonOpen ? 'A card is already open.' : 'Records the net value per share now as the start reading. Anyone can do this.'}</Hint>
            <P4Button tx={tx} id="poke" label="Update the drop (sign 1 transaction)" disabled={!data?.seasonOpen}
              onClick={() => tx.send({ key: 'poke', address: p4, abi: P4, functionName: 'pokeSeason', args: [fund.address], working: 'Recording a reading', success: 'Reading recorded' })} />
            <Hint>Records one more reading. The largest drop only counts readings like this one.</Hint>
            <P4Button tx={tx} id="close" label="Close the card (sign 1 transaction)" disabled={!open || !canCloseSeason(open.openedAt, now)}
              onClick={() => tx.send({ key: 'close', address: p4, abi: P4, functionName: 'closeSeason', args: [fund.address], working: 'Closing the card', success: 'Card closed' })} />
            <Hint>{open ? `Can close one day after it started: ${utcDate(open.openedAt + 86_400)}.` : 'Start a card first. It can close one day later.'}</Hint>
          </>
        )}
      </div>
      <div className="mt-4 border-t border-white/5 pt-3">
        <h3 className="text-[13px] font-medium text-white">Closed cards</h3>
        {closed.length === 0 ? <Hint>No closed cards yet.</Hint> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[12px]">
              <thead className="text-white/45">
                <tr><th className="py-1.5 font-normal">Closed (UTC)</th><th className="font-normal">Start</th><th className="font-normal">End</th><th className="font-normal">vs start</th><th className="font-normal">vs high-water mark</th><th className="font-normal">Largest recorded drop</th><th className="font-normal">Trades</th></tr>
              </thead>
              <tbody className="font-mono text-white/80">
                {closed.map((s) => (
                  <tr key={s.index} className="border-t border-white/5">
                    <td className="py-1.5 font-sans text-white/60">{utcDate(s.closedAt).replace(' UTC', '')}</td>
                    <td>{formatFundEth(s.navStart)}</td>
                    <td>{formatFundEth(s.navEnd)}</td>
                    <td>{signedPct(s.versusStartBps)}</td>
                    <td>{signedPct(s.versusHwmBps)}</td>
                    <td>{signedPct(-s.maxDrawdownBps)}</td>
                    <td>{(s.tradeEnd - s.tradeStart).toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Hint>Readings are in ETH per share. Changes are measured between recorded readings only.</Hint>
          </div>
        )}
      </div>
    </Card>
  );
}

function TradingAgent({ fund, tx, now }: { fund: Phase3Detail; tx: P4Tx; now: number }) {
  const { data } = usePhase4Fund(fund.address, fund.vault);
  const [agent, setAgent] = useState('');
  const [days, setDays] = useState('7');
  const [max, setMax] = useState('');
  const p4 = FUND_PHASE4 as `0x${string}`;
  const a = data?.agent ?? null;
  const gateOn = !!data?.vaultAllowsGate;
  const end = endTimeFromDays(days, now);
  const cap = optionalEth(max);
  const agentError = !agent.trim() ? 'Enter the agent address.' : !isAddress(agent.trim()) ? 'That is not a valid address.' : undefined;
  const error = agentError ?? end.error ?? cap.error;

  return (
    <Card title="Trading agent" subtitle="Only you see this, because your wallet manages this tokenized fund." className="border-white/25">
      <Hint>{P4_COPY.agentTip}</Hint>
      <div className="mt-3">
        <Row label="Agent" tip="The one address that may trade for this tokenized fund through the gate." value={a?.agent ? shortenAddress(a.agent) : 'None'} sub={a?.agent && !a.active ? 'Not active' : undefined} />
        <Row label="End time" tip="After this time the agent cannot trade. Anyone can then clear it." value={a?.agent ? utcDate(a.expiry) : '—'} />
        <Row label="Max trade size" tip="An extra limit per trade. 0 means only the tokenized fund's own trade cap applies." value={a?.agent ? (a.maxAmountIn === 0n ? '0 (tokenized fund cap only)' : formatFundEth(a.maxAmountIn)) : '—'} />
        <Row label="Gate can trade on the vault" tip="Whether the Phase 4 gate is still allowed to trade on this tokenized fund's vault." value={a?.gateIsExecutor ?? gateOn ? 'Yes' : 'No'} />
      </div>
      {!tx.account ? <ConnectHint /> : (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-[13px] font-medium text-white">Step 1. Let the gate trade on the vault</h3>
            <P4Button tx={tx} id="gate-on" primary label={gateOn ? 'Done: the gate can trade' : 'Allow the gate (sign 1 transaction)'} disabled={gateOn}
              onClick={() => tx.send({ key: 'gate-on', address: fund.vault, abi: VAULT, functionName: 'setExecutor', args: [p4, true], working: 'Allowing the gate', success: 'Gate allowed' })} />
            <Hint>Calls setExecutor on your vault with the Phase 4 address. The gate only forwards trades from the agent you name.</Hint>
            <h3 className="pt-2 text-[13px] font-medium text-white">Step 2. Name the agent</h3>
            <label className="block space-y-1">
              <span className="text-xs text-white/55">Agent address</span>
              <Input placeholder="0x…" value={agent} onChange={(e) => setAgent(e.target.value)} />
            </label>
            <Hint>The wallet that may trade. It cannot withdraw, pay fees, or move shares.</Hint>
            <label className="block space-y-1">
              <span className="text-xs text-white/55">Stops after (days from now)</span>
              <Input inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            <Hint>{end.end ? `Stops ${utcDate(end.end)}. At most 30 days out.` : end.error}</Hint>
            <label className="block space-y-1">
              <span className="text-xs text-white/55">Max trade size (optional)</span>
              <Input inputMode="decimal" placeholder="0" value={max} onChange={(e) => setMax(e.target.value)} />
            </label>
            <Hint>Counted in the sold token with 18 decimals, like ETH. Leave empty or 0 and the tokenized fund&apos;s own trade cap still applies.</Hint>
            {error && agent.trim() && <p className="text-[12px] text-white/70">{error}</p>}
            <P4Button tx={tx} id="arm" primary label="Name this agent (sign 1 transaction)" disabled={!gateOn || !!error}
              onClick={() => end.end && cap.wei !== null && tx.send({ key: 'arm', address: p4, abi: P4, functionName: 'arm', args: [fund.address, agent.trim(), BigInt(end.end), cap.wei], working: 'Naming the agent', success: 'Agent named' })} />
            <Hint>{gateOn ? 'One signature. You can remove the agent at any time.' : 'Do step 1 first.'}</Hint>
          </div>
          <div className="space-y-3">
            <h3 className="text-[13px] font-medium text-white">Remove or turn off</h3>
            <P4Button tx={tx} id="revoke" label="Remove agent (sign 1 transaction)" disabled={!a?.agent}
              onClick={() => tx.send({ key: 'revoke', address: p4, abi: P4, functionName: 'revoke', args: [fund.address], working: 'Removing the agent', success: 'Agent removed' })} />
            <Hint>Remove takes effect in that transaction. The agent cannot trade after it confirms.</Hint>
            <P4Button tx={tx} id="gate-off" label="Turn off the gate (sign 1 transaction)" disabled={!gateOn}
              onClick={() => tx.send({ key: 'gate-off', address: fund.vault, abi: VAULT, functionName: 'setExecutor', args: [p4, false], working: 'Turning off the gate', success: 'Gate turned off' })} />
            <Hint>Calls setExecutor on your vault with false. No agent can trade through the gate until you allow it again. Only you can do this.</Hint>
          </div>
        </div>
      )}
    </Card>
  );
}
