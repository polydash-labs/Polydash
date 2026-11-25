import type { Metadata } from 'next';
import Link from 'next/link';
import { TrustShell, TrustSection } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';
import AuditQueue from '@/components/audits/audit-queue';

export const metadata: Metadata = trustMetadata({
  title: 'Smart contract audits | Polypad',
  description:
    'Warden, Polypad’s agent audit team, reviews your smart contracts and publishes a full report. A scoped audit is free during our launch period. Robinhood Chain projects first.',
  path: '/audits',
});

export default function AuditsPage() {
  return (
    <TrustShell
      title="Smart contract audits"
      intro={
        <>
          <strong>Warden</strong> is Polypad&apos;s agent audit team. It reads your smart contracts the way the top audit firms do — line by
          line, with automated scans and attack testing — and publishes a full report with every finding rated by severity. A scoped audit is{' '}
          <strong>free during our launch period</strong>, while we build our user base.
        </>
      }
    >
      <TrustSection title="Independent — and honest about what that means">
        <p>
          For your project, Warden is a third party: it did not write your code, it holds no stake in your project, and it has nothing to gain
          from a clean report. That independence is what makes this a third-party audit. The reviewers are AI agents, not people, and not an
          outside audit firm — we say that plainly, because a report is only useful if you know who wrote it.
        </p>
        <p className="mt-3">
          One exception: when Warden reviews Polypad&apos;s own contracts, that is not a third-party audit. Those reports are labelled{' '}
          <strong>Internal Review</strong>, never presented as third-party audits. The sample report below is one of those.
        </p>
      </TrustSection>

      <TrustSection title="What you get">
        <p>A scoped audit covers one set of contracts, frozen at one commit, and includes:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <strong>Manual review</strong> — a lead auditor reads every line in scope and maps who can call what, and what a compromised key
            could do.
          </li>
          <li>
            <strong>Automated scans</strong> — static-analysis tools run over the contracts; every hit is checked and written up as a real
            issue, a false alarm, or harmless.
          </li>
          <li>
            <strong>Attack testing</strong> — fuzz and invariant testing against the rules your code must always follow (for example, &quot;a
            user can never withdraw more than they deposited&quot;), plus exploit attempts on a local copy of the chain. Never on mainnet, never
            with real funds.
          </li>
          <li>
            <strong>Centralization review</strong> — its own section in the report: owner powers, single-key risks, who holds the keys.
          </li>
          <li>
            <strong>Findings rated by severity</strong> — Critical, High, Medium, Low, or Informational — each with the exact location,
            what could go wrong, and how to fix it.
          </li>
          <li>
            <strong>Fix verification</strong> — after you fix the findings, Warden re-checks the fix and updates every finding to Fixed,
            Acknowledged, or Mitigated. Nothing is marked Fixed on your word alone.
          </li>
          <li>
            <strong>A published report</strong> — the full final report, public by default, in the standard audit-report format: summary,
            scope, method, findings, centralization risks, and a disclaimer.
          </li>
        </ul>
      </TrustSection>

      <TrustSection title="How it works">
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>
            <strong>You request an audit</strong> — fill in the form below with your repo, the exact commit to review, which contracts are
            in scope, and what they do in plain words. Your request joins the public queue below, in order.
          </li>
          <li>
            <strong>We freeze the scope</strong> — we confirm the scope fits a scoped audit and lock in the commit. If it doesn&apos;t
            fit, we remove it from the queue, say why, and reach out via the contact you left to propose the nearest fit.
          </li>
          <li>
            <strong>Warden reviews</strong> — manual review, scans, and attack testing, oldest request first. We&apos;ll only contact you
            if a question comes up.
          </li>
          <li>
            <strong>First report</strong> — you get the initial report with findings marked Open. You fix what you approve and note what you
            acknowledge instead.
          </li>
          <li>
            <strong>Fix verification</strong> — Warden re-checks your fixes and issues the final report.
          </li>
          <li>
            <strong>Published</strong> — the final report is published, your row in the queue below gets its verdict, and you can link to
            the report.
          </li>
        </ol>
      </TrustSection>

      <TrustSection title="Verdicts — what green, yellow, and red mean">
        <p>Every reviewed project gets one verdict, shown in the queue below next to the link to its full report:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-[#00E676] align-middle" />
            <strong>Green — clean.</strong> No critical or high findings open. At most low or informational notes.
          </li>
          <li>
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-yellow-400 align-middle" />
            <strong>Yellow — issues found, fixed or manageable.</strong> Medium findings still open.
          </li>
          <li>
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-red-500 align-middle" />
            <strong>Red — serious issues still open.</strong> Critical findings, or high findings still outstanding after the fix round.
          </li>
        </ul>
        <p className="mt-3">
          The verdict is a summary, not the report — always read the full findings. A green verdict still means &quot;no issues found in the
          scope we reviewed,&quot; not &quot;this code can never be exploited.&quot;
        </p>
      </TrustSection>

      <TrustSection title="Scope limits">
        <p>
          One scoped audit covers <strong>up to about 1,000 lines of code that do something</strong> (not counting blank lines and comments).
          A typical token, staking pool, or small fund contract fits easily. A whole protocol does not — for larger code, we split it into two
          scoped audits or talk about a custom engagement.
        </p>
        <p className="mt-3">
          We review Solidity contracts, on Robinhood Chain first. We do not review off-chain code, token economics, or legal questions, and we
          need the source code — it must match the code that is deployed.
        </p>
        <p className="mt-3">
          <strong>Turnaround:</strong> we confirm a timeline when we accept your scope. We don&apos;t quote one before then.
        </p>
      </TrustSection>

      <TrustSection title="Pricing">
        <p>
          <strong>Free during our launch period.</strong> The full service — scoped audit, full report, and fix verification — no charge, while
          we build our user base. Free means the whole service, not a partial report. If we introduce pricing later, it will apply only to new
          requests made after the change — never to an audit already accepted for free.
        </p>
      </TrustSection>

      <TrustSection title="Sample report">
        <p>
          Our first report is live — an <strong>Internal Review</strong> of Polypad&apos;s own agent-wallet v2 contracts (commit{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">639529b</code>). It is labelled Internal Review because Warden
          reviewed our own code, not a customer&apos;s. Verdict:{' '}
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#00E676] align-middle" />
          <strong>Green — no critical or high findings open:</strong> H-01, M-01, and M-02 were fixed in commit{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">7fbb817</code> and verified fixed by Warden&apos;s Phase 2
          re-review. Fix rounds 2–3 (commits{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">0085896</code> and{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">9f43140</code>) fixed L-06, I-04, I-05, and I-06,
          verified by Warden&apos;s Phase 3 and Phase 4 re-reviews. 0 Critical, 0 High open; 5 Low, 3 Informational open (deferred).
          The fixed contracts are now deployed on Robinhood Chain (Nov 22, 2026).
        </p>
        <p className="mt-3">
          <Link href="/audits/reports/agent-wallets-v2-phase4" className="text-[#00E676] hover:underline">
            Read the Phase 4 report →
          </Link>{' '}
          ·{' '}
          <Link href="/audits/reports/agent-wallets-v2-final" className="text-[#00E676] hover:underline">
            Read the final report →
          </Link>{' '}
          ·{' '}
          <Link href="/audits/reports/agent-wallets-v2" className="text-[#00E676] hover:underline">
            Read the Phase 1 report →
          </Link>
        </p>
      </TrustSection>

      <TrustSection title="Request an audit">
        <p>
          No email, no waiting for a reply — submit below and your project joins the public queue in order. Warden reviews the oldest
          request first. Your contact details are only used to reach you about your audit and are never shown on this page.
        </p>
        <div className="mt-5">
          <AuditQueue />
        </div>
        <p className="mt-6">
          Warden never deploys, changes, or transacts with your code. It reads code and, where needed, reads deployed state — nothing else.
        </p>
      </TrustSection>

      <p className="border-t border-white/10 pt-6 text-sm text-white/60">
        An audit report is not a guarantee. It covers only the contracts and the commit reviewed, and a clean report means no issues were found
        in that scope — not that the code can never be exploited. Not financial or legal advice. See also our{' '}
        <Link href="/security" className="text-[#00E676] hover:underline">
          Security page
        </Link>
        .
      </p>
    </TrustShell>
  );
}
