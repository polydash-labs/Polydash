// Job receipt rendering — intent → action → settlement, same shape as
// the /agents/receipts directory. On-chain facts (lock, amounts, fee,
// settlement tx) come from the escrow; the paper trail (brief hash,
// screening, dispute reasons, ballots) comes from the board row. A panel
// outcome without the individual ballots is incomplete — the component
// says so plainly when ballots are missing.

import Link from 'next/link';
import type { JobReceipt } from '@/lib/earn/receipt';
import { EMERALD_CARD, PLAIN_CARD } from '@/lib/ui/template';
import { AddrLink, TxLink } from '../../_components/earn-ui';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[13px]">
      <span className="text-white/50">{label}</span>
      <span className="text-right text-white/85">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">{title}</h4>
      <div className="mt-2 grid gap-1.5">{children}</div>
    </div>
  );
}

export function JobReceiptView({ receipt }: { receipt: JobReceipt }) {
  const { intent, action, settlement } = receipt;
  return (
    <div id="receipt" className={EMERALD_CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] font-semibold">Receipt — {receipt.receiptFormat}</p>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
          {receipt.status}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/50">
        Public and permanent. Check every transaction against Robinhood Chain — the receipt records
        what happened, it is not a guarantee, reimbursement, or insurance promise.
      </p>

      <Section title="Intent — what was agreed before it happened">
        <Field label="Poster"><AddrLink address={intent.poster} /></Field>
        <Field label="Price">{intent.price} (USDG)</Field>
        <Field label="Deadline">{new Date(intent.deadlineIso).toLocaleString()}</Field>
        <Field label="Brief hash"><span className="font-mono text-[11px] text-emerald-300 break-all">{intent.briefHash}</span></Field>
        <Field label="Screening">{intent.screening.decision}{intent.screening.reason ? ` — ${intent.screening.reason}` : ''}</Field>
        {intent.lockTxHash ? <Field label="Lock tx"><TxLink hash={intent.lockTxHash} /></Field> : null}
        {intent.agent.wallet ? (
          <Field label="Claiming agent">
            <span>
              {intent.agent.agentId ? <Link className="text-emerald-300 hover:underline" href={intent.agent.identityUrl ?? '#'}>Agent #{intent.agent.agentId}</Link> : 'Agent'}{' '}
              <AddrLink address={intent.agent.wallet} />
            </span>
          </Field>
        ) : null}
        {intent.claimTxHash ? <Field label="Claim tx"><TxLink hash={intent.claimTxHash} /></Field> : null}
        {intent.sessionKeyAtClaim ? (
          <Field label="Session key at claim">
            <span className="font-mono text-[11px] break-all">{JSON.stringify(intent.sessionKeyAtClaim)}</span>
          </Field>
        ) : null}
      </Section>

      <Section title="Action — what happened">
        {action.deliverableHash ? (
          <>
            <Field label="Deliverable hash"><span className="font-mono text-[11px] text-emerald-300 break-all">{action.deliverableHash}</span></Field>
            <Field label="Submitted">{action.submittedAt ? new Date(action.submittedAt).toLocaleString() : '—'}{action.submittedOnTime === true ? ' (on time)' : action.submittedOnTime === false ? ' (late)' : ''}</Field>
            {action.deliveredEventTxHash ? <Field label="Delivered tx"><TxLink hash={action.deliveredEventTxHash} /></Field> : null}
          </>
        ) : (
          <Field label="Deliverable"><span className="text-white/50">Nothing delivered yet.</span></Field>
        )}
        {action.dispute ? (
          <Field label="Dispute">
            <span className="block max-w-md whitespace-pre-wrap text-right">{action.dispute.reasons}</span>
          </Field>
        ) : null}
        {action.panel ? (
          <>
            <Field label="Panel">
              <span>
                {action.panel.members.map((m) => `#${m.agentId}`).join(', ') || '—'}
                {action.panel.seed ? <span className="text-white/50"> · seed {action.panel.seed.slice(0, 12)}…</span> : ''}
              </span>
            </Field>
            {action.panel.ballots.length > 0 ? (
              action.panel.ballots.map((b) => (
                <Field key={b.agentId} label={`Ballot — Agent #${b.agentId} ${b.name}`}>
                  <span>
                    <span className="font-semibold text-emerald-300">{b.vote}{b.vote === 'PayPart' ? ` (${(b.splitBps ?? 0) / 100}%)` : ''}</span>
                    {b.reason ? <span className="block text-white/55">{b.reason}</span> : null}
                  </span>
                </Field>
              ))
            ) : (
              <Field label="Ballots"><span className="text-orange-300">No ballots recorded yet — a panel outcome without ballots is incomplete.</span></Field>
            )}
          </>
        ) : null}
        {action.lapses.length > 0 ? (
          <Field label="Lapses"><span>{action.lapses.length} recorded — see the timeline below.</span></Field>
        ) : null}
      </Section>

      <Section title="Settlement — how the money moved">
        <Field label="Outcome">{settlement.outcomeName}</Field>
        <Field label="Price">{settlement.price}</Field>
        <Field label="Fee">{settlement.fee ?? '—'}{settlement.feeBpsAtLock !== null ? ` (${settlement.feeBpsAtLock / 100}% at lock time)` : ''}</Field>
        <Field label="Net to agent">{settlement.netToAgent ?? '—'}</Field>
        <Field label="Returned to poster">{settlement.posterRefund ?? '—'}</Field>
        {settlement.txHash ? <Field label="Settlement tx"><TxLink hash={settlement.txHash} /></Field> : null}
        {settlement.settledAt ? <Field label="Settled">{new Date(settlement.settledAt).toLocaleString()}</Field> : null}
      </Section>

      {receipt.timeline.length > 0 ? (
        <Section title="Timeline">
          {receipt.timeline.map((t, i) => (
            <Field key={`${t.type}-${i}`} label={t.type}>
              <span>
                {new Date(t.at).toLocaleString()}
                {t.txHash ? <> · <TxLink hash={t.txHash} /></> : null}
                {t.note ? <span className="block text-white/55">{t.note}</span> : null}
              </span>
            </Field>
          ))}
        </Section>
      ) : null}

      <p className="mt-5 text-[12px] leading-relaxed text-white/40">{receipt.disclaimer}</p>
      <p className="mt-1 text-[12px] text-white/40">
        Escrow: <AddrLink address={receipt.escrow} /> · Job id:{' '}
        <span className="font-mono text-[11px] break-all">{receipt.jobId}</span>
      </p>
    </div>
  );
}
