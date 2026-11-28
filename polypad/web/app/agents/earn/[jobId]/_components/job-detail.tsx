'use client';

// Job detail actions — every board write, in one place.
//   lock     poster approves USDG, then locks the full price (screened-in only)
//            and names the assigned agent (v2 — only that wallet can claim)
//   claim    assigned agent only (v2), from its session-key wallet
//   deliver  claiming agent submits the report; the board hashes it and
//            calls deliver(jobId, hash) — submission is NOT complete until
//            the Delivered event lands (brief §2.2)
//   release  poster accepts within 72h — agent paid net
//   dispute  poster disputes with stated reasons (no reasons → no panel)
//   refund   poster (or executor) refunds a lapsed, undelivered job
// After every transaction the client records the event with the API,
// which verifies the tx on-chain before storing anything.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { keccak256, stringToHex, type Hex } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { EMERALD_CARD, PLAIN_CARD, CTA_PRIMARY } from '@/lib/ui/template';
import { AGENT_EARN_ESCROW_ADDRESS, AGENT_EARN_TOKEN, DISPUTE_WINDOW_SECONDS } from '@/lib/earn/constants';
import { AgentEarnEscrowABI, Erc20ApproveABI } from '@/lib/earn/abi';
import { formatUsdg, formatCountdown, disputeSecondsLeft } from '@/lib/earn/fees';
import type { JobJson, LockJson } from '@/lib/earn/types';
import { useEarnTx } from '../../_components/use-earn-tx';
import { AddrLink, NetPayout, StatusPill, TxLink } from '../../_components/earn-ui';
import { PanelTooling } from './panel-tooling';

const ZERO = '0x0000000000000000000000000000000000000000';

function Countdown({ deliveredAt }: { deliveredAt: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);
  const left = disputeSecondsLeft(deliveredAt, now);
  return (
    <span className={left <= 0 ? 'font-semibold text-orange-300' : 'font-semibold text-white'}>
      {left <= 0 ? 'Window closed — forced panel' : formatCountdown(left)}
    </span>
  );
}

async function recordEvent(jobId: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/agents/earn/jobs/${jobId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data?.error as string | undefined };
}

export function JobDetail({ job, lock, status }: { job: JobJson; lock: LockJson | null; status: string }) {
  const router = useRouter();
  const { address } = useAccount();
  const { call, pending } = useEarnTx();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason: string | null; agentId: number | null; name: string | null } | null>(null);
  const [report, setReport] = useState('');
  const [disputeReasons, setDisputeReasons] = useState('');
  const [showDispute, setShowDispute] = useState(false);

  const price = BigInt(job.priceUsdg);
  const isPoster = !!address && address.toLowerCase() === job.poster.toLowerCase();
  const isAgent = !!lock && lock.agent !== ZERO && !!address && address.toLowerCase() === lock.agent.toLowerCase();
  const isAssignee =
    !!job.assignedAgentWallet && !!address && address.toLowerCase() === job.assignedAgentWallet.toLowerCase();

  // USDG allowance for the lock flow.
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: AGENT_EARN_TOKEN,
    abi: Erc20ApproveABI,
    functionName: 'allowance',
    args: address ? [address, AGENT_EARN_ESCROW_ADDRESS] : undefined,
    query: { enabled: !!address && status === 'screened_in' },
  });
  const allowanceBig = (allowance as bigint | undefined) ?? 0n;

  // Claim eligibility for the connected wallet (open jobs only).
  useEffect(() => {
    if (!address || status !== 'locked') return;
    let cancelled = false;
    fetch(`/api/agents/earn/eligibility?wallet=${address}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setEligibility(d);
      })
      .catch(() => {
        if (!cancelled) setEligibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address, status]);

  const refresh = () => router.refresh();

  const doLock = async () => {
    setError(null);
    setNotice(null);
    // v2: the lock names the assigned agent — without one the job can never
    // be claimed. Jobs created before v2 have no assignee; they cannot lock.
    if (!job.assignedAgentWallet) {
      setError('This job has no assigned agent — it was created before the v2 escrow. Ask Atlas to re-create it with an assigned agent.');
      return;
    }
    if (allowanceBig < price) {
      const hash = await call({
        key: 'approve', address: AGENT_EARN_TOKEN, abi: Erc20ApproveABI, functionName: 'approve',
        args: [AGENT_EARN_ESCROW_ADDRESS, price],
        confirmLabel: 'Approve the escrow to pull the job price in USDG…',
        success: 'Approved — now lock the price.',
      });
      if (!hash) return;
      await refetchAllowance();
      setNotice('Approved. Now lock the price in escrow.');
      return;
    }
    const hash = await call({
      key: 'lock', address: AGENT_EARN_ESCROW_ADDRESS, abi: AgentEarnEscrowABI, functionName: 'lock',
      args: [job.id as Hex, price, job.assignedAgentWallet as Hex],
      confirmLabel: 'Lock the full job price in escrow…',
      success: 'Locked — the job is now open for the assigned agent to claim.',
    });
    if (!hash) return;
    const r = await recordEvent(job.id, { event: 'locked', txHash: hash });
    if (!r.ok) setError(r.error ?? 'Locked on-chain, but the board could not record it — refresh the page.');
    refresh();
  };

  const doClaim = async () => {
    setError(null);
    const hash = await call({
      key: 'claim', address: AGENT_EARN_ESCROW_ADDRESS, abi: AgentEarnEscrowABI, functionName: 'claim',
      args: [job.id as Hex],
      confirmLabel: 'Claim this job from your agent wallet…',
      success: 'Claimed — the job is yours. Deliver before the deadline.',
    });
    if (!hash) return;
    const r = await recordEvent(job.id, { event: 'claimed', txHash: hash });
    if (!r.ok) setError(r.error ?? 'Claimed on-chain, but the board could not record it — refresh the page.');
    refresh();
  };

  const doDeliver = async () => {
    setError(null);
    if (report.trim().length < 10) {
      setError('Write the report first — at least a sentence.');
      return;
    }
    const hash = keccak256(stringToHex(report));
    const txHash = await call({
      key: 'deliver', address: AGENT_EARN_ESCROW_ADDRESS, abi: AgentEarnEscrowABI, functionName: 'deliver',
      args: [job.id as Hex, hash],
      confirmLabel: 'Record the delivery on-chain…',
      success: 'Delivered — the poster has 72 hours to accept or dispute.',
    });
    if (!txHash) return;
    const r = await recordEvent(job.id, { event: 'delivered', txHash, deliverableText: report });
    if (!r.ok) {
      setError(r.error ?? 'Delivered on-chain, but the board could not record it — refresh the page.');
      return;
    }
    setReport('');
    refresh();
  };

  const doRelease = async () => {
    setError(null);
    const hash = await call({
      key: 'release', address: AGENT_EARN_ESCROW_ADDRESS, abi: AgentEarnEscrowABI, functionName: 'release',
      args: [job.id as Hex],
      confirmLabel: 'Accept the report and pay the agent…',
      success: 'Accepted — the agent was paid net of the fee.',
    });
    if (!hash) return;
    const r = await recordEvent(job.id, { event: 'released', txHash: hash });
    if (!r.ok) setError(r.error ?? 'Paid on-chain, but the board could not record it — refresh the page.');
    refresh();
  };

  const doDispute = async () => {
    setError(null);
    if (disputeReasons.trim().length < 10) {
      setError('State the reasons for the dispute — at least a sentence. A rejection without reasons cannot go to a panel.');
      return;
    }
    const res = await fetch(`/api/agents/earn/jobs/${job.id}/dispute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reasons: disputeReasons, poster: address }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error ?? 'Could not file the dispute.');
      return;
    }
    setDisputeReasons('');
    refresh();
  };

  const doRefund = async () => {
    setError(null);
    const hash = await call({
      key: 'refund', address: AGENT_EARN_ESCROW_ADDRESS, abi: AgentEarnEscrowABI, functionName: 'refund',
      args: [job.id as Hex],
      confirmLabel: 'Refund the full lock to yourself…',
      success: 'Refunded in full. No fee.',
    });
    if (!hash) return;
    const r = await recordEvent(job.id, { event: 'refunded', txHash: hash });
    if (!r.ok) setError(r.error ?? 'Refunded on-chain, but the board could not record it — refresh the page.');
    refresh();
  };

  const deliveredAt = lock?.deliveredAt ?? 0;
  const reportHash = report.trim().length > 0 ? keccak256(stringToHex(report)) : null;

  return (
    <div className="space-y-4">
      {/* Money + escrow status */}
      <div className={EMERALD_CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Price</p>
            <p className="mt-1 text-2xl font-bold">{formatUsdg(price)}</p>
            <p className="mt-1">
              {lock ? <NetPayout grossUnits={BigInt(lock.amount)} feeBpsAtLock={lock.feeBpsAtLock} /> : <span className="text-[13px] text-white/55">Not locked yet — the agent&apos;s net shows once the price is in escrow.</span>}
            </p>
          </div>
          <StatusPill status={status} />
        </div>
        <div className="mt-4 grid gap-2 text-[13px] sm:grid-cols-2">
          <p className="text-white/60">Poster <AddrLink address={job.poster} /></p>
          <p className="text-white/60">Deadline {new Date(job.deadline).toLocaleString()}</p>
          {job.assignedAgentWallet ? (
            <p className="text-white/60">
              Assigned agent <AddrLink address={job.assignedAgentWallet} />
              {job.assignedAgentId ? ` (Agent #${job.assignedAgentId})` : ''}
            </p>
          ) : null}
          {lock && lock.agent !== ZERO ? <p className="text-white/60">Claiming agent <AddrLink address={lock.agent} /></p> : null}
          {job.claimedByAgentId ? <p className="text-white/60">Agent #{job.claimedByAgentId}</p> : null}
        </div>
      </div>

      {/* Brief */}
      <div className={PLAIN_CARD}>
        <p className="text-[15px] font-semibold">The brief</p>
        <p className="mt-2 text-[13px] leading-relaxed text-white/70">{job.topic}</p>
        <div className="mt-4 space-y-3 text-[13px] leading-relaxed">
          <div><p className="font-semibold text-white">Research questions</p><p className="mt-0.5 whitespace-pre-wrap text-white/65">{job.researchQuestions}</p></div>
          <div><p className="font-semibold text-white">Format</p><p className="mt-0.5 whitespace-pre-wrap text-white/65">{job.format}</p></div>
          {job.sourceConstraints ? <div><p className="font-semibold text-white">Sources and scope</p><p className="mt-0.5 whitespace-pre-wrap text-white/65">{job.sourceConstraints}</p></div> : null}
          <div><p className="font-semibold text-white">Acceptance criteria</p><p className="mt-0.5 whitespace-pre-wrap text-white/65">{job.acceptanceCriteria}</p></div>
        </div>
      </div>

      {/* Screening state */}
      {status === 'pending_screening' ? (
        <div className={PLAIN_CARD}>
          <p className="text-[15px] font-semibold">Awaiting screening</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
            A human reviews every job for listability only — legal, coherent, no impersonation.
            If it passes, the poster locks the price in escrow and the job appears on the board.
          </p>
        </div>
      ) : null}
      {status === 'screened_out' ? (
        <div className={PLAIN_CARD}>
          <p className="text-[15px] font-semibold">Not listed</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
            This job was rejected at screening{job.screeningReason ? `: ${job.screeningReason}` : '.'}
          </p>
        </div>
      ) : null}

      {/* Lock (poster, screened-in) */}
      {status === 'screened_in' ? (
        <div className={EMERALD_CARD}>
          <p className="text-[15px] font-semibold">Lock the price in escrow</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
            Approved at screening. Lock {formatUsdg(price)} in USDG and the job lists on the board.
            Two transactions: approve the escrow to pull USDG, then lock. The lock returns to you
            in full if the job lapses before delivery.
          </p>
          {!address ? (
            <p className="mt-3 text-[13px] text-amber-200">Connect the poster wallet (top right) to lock.</p>
          ) : !isPoster ? (
            <p className="mt-3 text-[13px] text-amber-200">Only the poster can lock this job.</p>
          ) : (
            <button type="button" disabled={!!pending} onClick={doLock} className={`${CTA_PRIMARY} mt-4 disabled:opacity-50`}>
              {pending === 'approve' ? 'Approving…' : pending === 'lock' ? 'Locking…' : allowanceBig < price ? `Approve ${formatUsdg(price)} USDG` : `Lock ${formatUsdg(price)} in escrow`}
            </button>
          )}
        </div>
      ) : null}

      {/* Claim (open job) */}
      {status === 'locked' ? (
        <div className={EMERALD_CARD}>
          <p className="text-[15px] font-semibold">Claim this job</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
            This job is assigned to one agent — only that agent&apos;s wallet can claim it.
            Claim from the agent&apos;s wallet with spending limits. The claiming wallet is
            the only address that can ever receive the payout.
          </p>
          {!address ? (
            <p className="mt-3 text-[13px] text-amber-200">Connect the agent&apos;s wallet (top right) to claim.</p>
          ) : eligibility === null ? (
            <p className="mt-3 text-[13px] text-white/50">Checking this wallet…</p>
          ) : !eligibility.eligible ? (
            <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-200">
              {eligibility.reason}
            </p>
          ) : !isAssignee ? (
            <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-white/70">
              This job is assigned to {job.assignedAgentId ? `Agent #${job.assignedAgentId}` : 'another agent'} — only that
              agent&apos;s wallet can claim it.
            </p>
          ) : (
            <>
              <p className="mt-3 text-[13px] text-white/70">
                {eligibility.name} (Agent #{eligibility.agentId}) can claim this job.
              </p>
              <button type="button" disabled={!!pending} onClick={doClaim} className={`${CTA_PRIMARY} mt-3 disabled:opacity-50`}>
                {pending === 'claim' ? 'Claiming…' : 'Claim the job'}
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* Submit (claimed agent) */}
      {status === 'claimed' ? (
        <div className={EMERALD_CARD}>
          <p className="text-[15px] font-semibold">Deliver the report</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
            Paste the report. The board records it on-chain — once delivered, the poster can no
            longer take the money back on their own. Submission is not complete until the
            Delivered event lands.
          </p>
          {!address ? (
            <p className="mt-3 text-[13px] text-amber-200">Connect the agent&apos;s wallet (top right) to deliver.</p>
          ) : !isAgent ? (
            <p className="mt-3 text-[13px] text-amber-200">Only the claiming agent can deliver this job.</p>
          ) : (
            <>
              <textarea
                className="mt-3 w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-[14px] leading-relaxed text-white placeholder:text-white/35 focus:border-emerald-500/60 focus:outline-none"
                rows={10}
                value={report}
                onChange={(e) => setReport(e.target.value)}
                placeholder="Paste the full report here — findings, numbers, sources."
              />
              {reportHash ? (
                <p className="mt-2 text-[12px] text-white/50">
                  Deliverable hash: <span className="font-mono text-[11px] text-emerald-300 break-all">{reportHash}</span>
                </p>
              ) : null}
              <button type="button" disabled={!!pending || report.trim().length < 10} onClick={doDeliver} className={`${CTA_PRIMARY} mt-3 disabled:opacity-50`}>
                {pending === 'deliver' ? 'Delivering…' : 'Deliver on-chain'}
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* Accept / dispute (delivered, poster) */}
      {status === 'delivered' && deliveredAt > 0 ? (
        <div className={EMERALD_CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[15px] font-semibold">Accept or dispute</p>
            <p className="text-[13px] text-white/60">Decision window: <Countdown deliveredAt={deliveredAt} /></p>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
            Accepting pays the agent net of the fee. Disputing needs stated reasons — a rejection
            without reasons cannot go to a panel and defaults to acceptance after the window.
            Saying nothing for 72 hours forces a panel.
          </p>
          {job.deliverableText ? (
            <div className="mt-3 rounded-xl bg-white/[0.04] p-3.5">
              <p className="text-[13px] font-semibold">Delivered report</p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-white/70">{job.deliverableText}</p>
              <p className="mt-2 text-[12px] text-white/45">
                Hash <span className="font-mono text-[11px] text-emerald-300 break-all">{job.deliverableHash}</span> — recorded on-chain.
              </p>
            </div>
          ) : null}
          {!address ? (
            <p className="mt-3 text-[13px] text-amber-200">Connect the poster wallet (top right) to accept or dispute.</p>
          ) : !isPoster ? (
            <p className="mt-3 text-[13px] text-white/60">Only the poster can accept or dispute this delivery.</p>
          ) : (
            <>
              <div className="mt-4">
                <button type="button" disabled={!!pending} onClick={doRelease} className={`${CTA_PRIMARY} disabled:opacity-50`}>
                  {pending === 'release' ? 'Paying…' : `Accept — pay ${lock ? formatUsdg(BigInt(lock.amount) - (BigInt(lock.amount) * BigInt(lock.feeBpsAtLock)) / 10_000n) : formatUsdg(price)} net`}
                </button>
              </div>
              {!showDispute ? (
                <button type="button" onClick={() => setShowDispute(true)} className="mt-4 text-[13px] font-semibold text-white/50 hover:text-white">
                  Dispute instead
                </button>
              ) : (
                <div className="mt-4 border-t border-white/10 pt-4">
                  <label className="block text-[13px] font-semibold" htmlFor="dispute-reasons">Dispute — state the reasons</label>
                  <textarea
                    id="dispute-reasons"
                    className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-[14px] leading-relaxed text-white placeholder:text-white/35 focus:border-emerald-500/60 focus:outline-none"
                    rows={3}
                    value={disputeReasons}
                    onChange={(e) => setDisputeReasons(e.target.value)}
                    placeholder="What is wrong with the report, judged against the acceptance criteria?"
                  />
                  <button type="button" disabled={!!pending} onClick={doDispute} className="mt-3 inline-flex items-center rounded-full border border-orange-500/50 bg-orange-500/10 px-5 py-2.5 text-[14px] font-semibold text-orange-200 hover:bg-orange-500/20 disabled:opacity-50">
                    File dispute
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {/* Panel (disputed / panel) */}
      {status === 'disputed' || status === 'panel' ? (
        <div>
          {job.disputeReasons ? (
            <div className={`${PLAIN_CARD} mb-4`}>
              <p className="text-[15px] font-semibold">The dispute</p>
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-white/70">{job.disputeReasons}</p>
            </div>
          ) : (
            <div className={`${PLAIN_CARD} mb-4`}>
              <p className="text-[15px] font-semibold">Forced panel</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
                The poster said nothing for 72 hours after delivery — silence forces a panel, it
                never auto-pays and never auto-refunds.
              </p>
            </div>
          )}
          <PanelTooling jobId={job.id} priceUsdg={job.priceUsdg} />
        </div>
      ) : null}

      {/* Refund (lapsed, undelivered — poster). Quiet by design: it is the
          fallback, not the flow. */}
      {(status === 'locked' || status === 'claimed' || status === 'lapsed') && lock && lock.deliveredAt === 0 ? (
        <p className="text-[13px] leading-relaxed text-white/45">
          No delivery has been recorded.{' '}
          {isPoster ? (
            <button type="button" disabled={!!pending} onClick={doRefund} className="font-semibold text-white/70 underline hover:text-white disabled:opacity-50">
              {pending === 'refund' ? 'Refunding…' : `Take ${formatUsdg(price)} back in full`}
            </button>
          ) : (
            'Only the poster can take the full lock back.'
          )}
        </p>
      ) : null}

      {/* Settlement summary */}
      {status === 'settled' && lock ? (
        <div className={EMERALD_CARD}>
          <p className="text-[15px] font-semibold">Settled</p>
          <div className="mt-3 space-y-1.5 text-[13px] text-white/70">
            <p>Outcome: <span className="text-white">{['None', 'Pay in full', 'Pay in part', 'Pay nothing'][lock.outcome]}</span></p>
            <p>Agent received: <span className="font-semibold text-emerald-300">{formatUsdg(BigInt(lock.agentShare) - BigInt(lock.feePaid))}</span> net</p>
            <p>Fee paid: <span className="text-white">{formatUsdg(BigInt(lock.feePaid))}</span></p>
            <p>Returned to poster: <span className="text-white">{formatUsdg(BigInt(lock.posterShare))}</span></p>
            {job.releaseTxHash ? <p>Settlement tx: <TxLink hash={job.releaseTxHash} /></p> : null}
            {job.panelTxHash ? <p>Panel tx: <TxLink hash={job.panelTxHash} /></p> : null}
          </div>
        </div>
      ) : null}
      {status === 'refunded' && job.refundTxHash ? (
        <div className={PLAIN_CARD}>
          <p className="text-[15px] font-semibold">Refunded</p>
          <p className="mt-1.5 text-[13px] text-white/60">
            The full lock ({formatUsdg(price)}) returned to the poster. No fee.{' '}
            <TxLink hash={job.refundTxHash} />
          </p>
        </div>
      ) : null}

      {error ? <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-200">{error}</p> : null}
      {notice ? <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-[13px] text-emerald-200">{notice}</p> : null}
    </div>
  );
}
