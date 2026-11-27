'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { verifyReceipt, type VerificationResult } from '@/lib/receipts/verifier';
import type { AgentReceipt, AgentScorePostedReceipt, AllowlistExecutedReceipt } from '@/lib/receipts/types';
import { isAgentScorePostedReceipt } from '@/lib/receipts/types';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[13px]">
      <span className="text-white/50">{label}</span>
      <span className="text-right text-white/85">{children}</span>
    </div>
  );
}

function Addr({ address }: { address: string }) {
  return (
    <a
      className="font-mono text-[12px] text-polydash-green"
      href={getExplorerAddressUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {shortenAddress(address)}
    </a>
  );
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a
      className="font-mono text-[12px] text-polydash-green"
      href={getExplorerTxUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {shortenAddress(hash)}
    </a>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">{title}</h4>
      <div className="mt-2 grid gap-1.5">{children}</div>
    </div>
  );
}

/** Verifiable intent (Nov 24, 2026): the pre-captured authorization the
 * action executed under — intent → action → settlement in one record.
 * Mastercard's framing: "Payments aren't the hard part. Authority is." */
function IntentSection({ receipt }: { receipt: AgentReceipt }) {
  const intent = receipt.intent;
  if (!intent) {
    return (
      <Section title="Intent — what was allowed before it happened">
        <Field label="Authorization">
          <span className="text-white/50">This receipt predates the intent field (Nov 24, 2026) — the authorization it acted under isn&apos;t captured here.</span>
        </Field>
      </Section>
    );
  }
  return (
    <Section title="Intent — what was allowed before it happened">
      <Field label="Authorized by"><Addr address={intent.authorizedBy} /></Field>
      <Field label="What was allowed">{intent.authorization}</Field>
      {intent.bounds ? <Field label="Bounds">{intent.bounds}</Field> : null}
      <Field label="Authorization record">
        {intent.authorizationHashKind === 'transaction' ? (
          <TxLink hash={intent.authorizationHash} />
        ) : (
          <span className="font-mono text-[12px]">{shortenAddress(intent.authorizationHash)}</span>
        )}
        {' '}
        <span className="text-white/50">({intent.authorizationHashKind === 'transaction' ? 'the transaction that captured the authorization' : 'the hash binding the authorization to its inputs'})</span>
      </Field>
      {intent.authorizedAtIso ? <Field label="Authorized at">{intent.authorizedAtIso.replace('T', ' ').replace('.000Z', ' UTC')}</Field> : null}
      <Field label="Source">{intent.source}</Field>
    </Section>
  );
}

function VerdictChip({ result }: { result: VerificationResult }) {
  if (result.verdict === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-polydash-green/15 px-2.5 py-0.5 text-[11px] font-medium text-polydash-green">
        <ShieldCheck className="h-3.5 w-3.5" /> Verified · {result.checks.filter((c) => c.status === 'pass').length}/{result.checks.length} checks
      </span>
    );
  }
  if (result.verdict === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-[11px] font-medium text-red-400">
        <ShieldAlert className="h-3.5 w-3.5" /> Failed · {result.checks.filter((c) => c.status === 'pass').length}/{result.checks.length} checks
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-400">
      <ShieldAlert className="h-3.5 w-3.5" /> Incomplete · some checks could not run
    </span>
  );
}

function useReceiptVerification(receipt: AgentReceipt) {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runVerify() {
    setVerifying(true);
    setError(null);
    try {
      setResult(await verifyReceipt(receipt));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  return { result, verifying, error, runVerify };
}

type VerificationState = ReturnType<typeof useReceiptVerification>;

function VerifyFooter({ state, file }: { state: VerificationState; file: string }) {
  const { result, verifying, error, runVerify } = state;
  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={runVerify} disabled={verifying} size="sm">
          {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {verifying ? 'Verifying on-chain…' : result ? 'Verify again' : 'Verify on-chain'}
        </Button>
        <Link
          href={`/receipts/${file}`}
          className="text-[13px] text-polydash-green hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Raw receipt JSON ↗
        </Link>
      </div>

      {error ? <p className="mt-3 text-[13px] text-red-400">Verification could not run: {error}</p> : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3">
          <p className="text-[12px] text-white/50">
            Checked {new Date(result.checkedAt).toLocaleString()} via public RPC · {result.checks.filter((c) => c.status === 'pass').length}/{result.checks.length} checks passed
          </p>
          <div className="mt-2 grid gap-1">
            {result.checks.map((c) => (
              <div key={c.id} className="flex items-start gap-2 text-[13px]">
                {c.status === 'pass' ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-polydash-green" />
                ) : c.status === 'fail' ? (
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                ) : (
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                )}
                <span className={cn(c.status === 'fail' ? 'text-red-300' : 'text-white/80')}>
                  <span className="font-mono text-[11px] text-white/40">{c.section} · </span>
                  {c.label}
                  {c.status === 'fail' && c.actual ? <span className="block pl-0 font-mono text-[11px] text-white/50">got: {c.actual}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ReceiptCard({ receipt, file }: { receipt: AgentReceipt; file: string }) {
  return isAgentScorePostedReceipt(receipt) ? (
    <ScoreReceiptCard receipt={receipt} file={file} />
  ) : (
    <AllowlistReceiptCard receipt={receipt} file={file} />
  );
}

function ScoreReceiptCard({ receipt, file }: { receipt: AgentScorePostedReceipt; file: string }) {
  const state = useReceiptVerification(receipt);
  const { result } = state;
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <CardHeader title={`Score posted · ${receipt.identity.name} (agent ${receipt.identity.agentId})`} receipt={receipt} result={result} />
      <Section title="Identity — who acted">
        <Field label="Agent">#{receipt.identity.agentId} · {receipt.identity.name}</Field>
        <Field label="Wallet"><Addr address={receipt.identity.wallet} /></Field>
        <Field label="Registration bond">1,000 POLYDASH · registered {receipt.identity.registeredAtIso?.slice(0, 10) ?? ''}</Field>
        <Field label="Status">{receipt.identity.active ? 'Active' : 'Inactive'}</Field>
      </Section>
      <IntentSection receipt={receipt} />
      <Section title="Authority — under what power">
        <Field label="Rule">{receipt.authority.rule}</Field>
        <Field label="Registered updater"><Addr address={receipt.authority.updater} /></Field>
      </Section>
      <Section title="Approval — what was checked before it settled">
        <Field label="Rule">{receipt.approval.rule}</Field>
        <Field label="Components">
          perf {receipt.approval.components.performance} · hist {receipt.approval.components.history} · act {receipt.approval.components.activity} · stake {receipt.approval.components.stake} · conduct {receipt.approval.components.conduct}
        </Field>
        <Field label="Score from formula">{receipt.approval.weightedScore}</Field>
        <Field label="Inputs hash"><span className="font-mono text-[12px]">{shortenAddress(receipt.approval.inputsHash)}</span></Field>
      </Section>
      <Section title="Settlement — how it landed">
        <Field label="Score posted">{receipt.settlement.score} · band {receipt.settlement.bandName ?? receipt.settlement.band}</Field>
        <Field label="Transaction"><TxLink hash={receipt.settlement.transactionHash} /></Field>
        <Field label="Block">#{receipt.settlement.blockNumber} · {receipt.settlement.blockTimestampIso?.replace('T', ' ').replace('.000Z', ' UTC') ?? ''}</Field>
        <Field label="Event">{receipt.settlement.event}</Field>
      </Section>
      <VerifyFooter state={state} file={file} />
    </article>
  );
}

function AllowlistReceiptCard({ receipt, file }: { receipt: AllowlistExecutedReceipt; file: string }) {
  const state = useReceiptVerification(receipt);
  const { result } = state;
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <CardHeader title={`Allowlist executed · proposal ${receipt.approval.proposalId} (${receipt.approval.assetSymbol ?? 'asset'})`} receipt={receipt} result={result} />
      <Section title="Identity — who acted">
        <Field label="Executor"><Addr address={receipt.identity.executor} /></Field>
        <Field label="Note">{receipt.identity.executorNote}</Field>
      </Section>
      <IntentSection receipt={receipt} />
      <Section title="Authority — under what power">
        <Field label="Rule">{receipt.authority.rule}</Field>
      </Section>
      <Section title="Approval — what was checked before it settled">
        <Field label="Proposal">#{receipt.approval.proposalId} · {receipt.approval.assetSymbol} <Addr address={receipt.approval.target} /></Field>
        <Field label="Price feed"><Addr address={receipt.approval.feed} /></Field>
        <Field label="Price band">{receipt.approval.minPriceX18} – {receipt.approval.maxPriceX18} (×10¹⁸) · fresh within {receipt.approval.maxStaleSeconds}s</Field>
        <Field label="Proposed by"><Addr address={receipt.approval.proposedBy} /> · <TxLink hash={receipt.approval.proposeTransactionHash} /></Field>
        <Field label="Public wait">proposed {receipt.approval.proposedAtIso?.replace('T', ' ').replace('.000Z', ' UTC') ?? ''} · ready {receipt.approval.readyAtIso?.replace('T', ' ').replace('.000Z', ' UTC') ?? ''} · {receipt.approval.delaySeconds}s delay</Field>
        <Field label="Wait elapsed at execution">{receipt.approval.waitElapsedSeconds}s after readyAt</Field>
      </Section>
      <Section title="Settlement — how it landed">
        <Field label="Transaction"><TxLink hash={receipt.settlement.transactionHash} /></Field>
        <Field label="Block">#{receipt.settlement.blockNumber} · {receipt.settlement.blockTimestampIso?.replace('T', ' ').replace('.000Z', ' UTC') ?? ''}</Field>
        <Field label="Result">Executed · asset allowlisted · feed stored</Field>
        <Field label="Events">{receipt.settlement.events.join(' · ')}</Field>
      </Section>
      <VerifyFooter state={state} file={file} />
    </article>
  );
}

function CardHeader({ title, receipt, result }: { title: string; receipt: AgentReceipt; result: VerificationResult | null }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-[16px] font-semibold">{title}</h3>
        <p className="mt-0.5 text-[12px] text-white/50">{receipt.action.description}</p>
        <p className="mt-1 font-mono text-[11px] text-white/40">{receipt.receiptId}</p>
      </div>
      {result ? <VerdictChip result={result} /> : null}
    </div>
  );
}

export interface ReceiptItem {
  receipt: AgentReceipt;
  file: string;
}

export function ReceiptsDirectory({ items }: { items: ReceiptItem[] }) {
  return (
    <div className="mx-auto max-w-container px-5 pb-16 pt-6 sm:px-8 sm:pt-8">
      <h1 className="text-2xl font-semibold sm:text-3xl">Agent action receipts</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-white/60">
        Every agent action on Polypad leaves a public receipt: the intent it acted under,
        who it is, what authority it acted under, what was approved, and how it settled —
        intent → action → settlement in one record. Anyone can re-check each receipt
        against Robinhood Chain with the Verify button — no account, no key, only public data.
        As Mastercard put it: &ldquo;Payments aren&apos;t the hard part. Authority is.&rdquo;
      </p>
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
        <h2 className="text-[13px] font-medium text-white">What a receipt proves — and what it does not</h2>
        <dl className="mt-2 space-y-2 text-[13px] leading-relaxed">
          <div>
            <dt className="inline font-semibold text-white">Proves: </dt>
            <dd className="inline text-white/70">
              That the action happened, that the actor held the authority the contract requires, that the approval step ran, and that the settlement landed on-chain — each fact re-readable by a third party.
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold text-white">Does not prove: </dt>
            <dd className="inline text-white/70">
              Anything about future behavior, and it promises nothing about reimbursement, compensation, or cover if something goes wrong. A receipt is a record, not a guarantee.
            </dd>
          </div>
        </dl>
      </div>
      {items.length === 0 ? (
        <p className="mt-8 text-[14px] text-white/60">No receipts published yet.</p>
      ) : (
        <div className="mt-8 grid gap-4">
          {items.map(({ receipt, file }) => (
            <ReceiptCard key={receipt.receiptId} receipt={receipt} file={file} />
          ))}
        </div>
      )}
      <p className="mt-8 text-[13px] leading-relaxed text-white/50">
        Format <span className="font-mono">polypad.agent-receipt/1</span> ·{' '}
        <Link href="/receipts/index.json" className="text-polydash-green hover:underline" target="_blank" rel="noopener noreferrer">
          Receipt index (JSON)
        </Link>{' '}
        ·{' '}
        <a href="https://github.com/polydash-labs/Polydash/blob/main/docs/agent-receipts.md" className="text-polydash-green hover:underline" target="_blank" rel="noopener noreferrer">
          Format spec
        </a>{' '}
        · Verify from your own terminal:{' '}
        <span className="font-mono text-[12px] text-white/70">npx tsx scripts/verify-receipt.ts public/receipts/&lt;receipt&gt;.json</span>
      </p>
    </div>
  );
}
