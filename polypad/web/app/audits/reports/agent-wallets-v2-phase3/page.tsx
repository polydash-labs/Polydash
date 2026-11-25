import type { Metadata } from 'next';
import Link from 'next/link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { TrustShell } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Agent Wallet v2 — Phase 3 Report | Polypad',
  description:
    'Warden’s Phase 3 re-review of the agent-wallet v2 fix round 2 (commit 0085896): L-06 and I-04 fixed and verified, I-05 partially fixed, one new Informational (I-06). Green holds.',
  path: '/audits/reports/agent-wallets-v2-phase3',
});

export const dynamic = 'force-static';

/**
 * Full Warden Phase 3 report, rendered from the frozen report markdown
 * (content/audits/agent-wallets-v2-phase3.md — the Phase 3 re-review, Nov 22, 2026).
 * The markdown is our own report; the leading H1 is dropped because the
 * TrustShell title carries it.
 */
export default async function AgentWalletsV2Phase3ReportPage() {
  const md = readFileSync(join(process.cwd(), 'content/audits/agent-wallets-v2-phase3.md'), 'utf8');
  const body = md.replace(/^# .*\n/, '');
  const html = await marked.parse(body);

  return (
    <TrustShell
      title="Agent Wallet v2 — Phase 3 Report"
      intro={
        <>
          <strong>Internal Review</strong> — Warden reviewed Polypad&apos;s own contracts. This is first-party review by Polypad&apos;s
          in-house agent audit team. It is <strong>not</strong> an independent third-party audit.
        </>
      }
    >
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-white/75 sm:px-5">
        <p className="flex flex-wrap items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#00E676]" />
          <strong className="text-white">Green holds — no critical or high findings open.</strong>
          <span>
            0 Critical · 0 High open · 5 Low · 6 Informational open. L-06 and I-04 fixed in commit{' '}
            <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">0085896</code> and verified fixed by
            Warden&apos;s own fresh tests (Phase 3, Nov 22, 2026).
          </span>
        </p>
        <p className="mt-2">
          I-05 is only partially fixed: the NatSpec now says 50k fails with AA36, but Warden&apos;s live re-measurement splits by storage
          warmth — cold first validation fails AA33, warm fails AA36. Doc-only; the 80k guidance is correct and verified. New Informational
          I-06 (open): rotation overwrites the new key&apos;s own cap values with the old key&apos;s. The fixed contracts are now{' '}
          <strong>deployed</strong> (Nov 22, 2026) — the live contracts are the fixed code at commit 9f43140.
        </p>
        <p className="mt-2">
          Scope: re-review of fix round 2 at commit{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">0085896</code> — SessionKeyModuleV2, Agent4337Module,
          Paymaster, WalletFactoryV2 — on Robinhood Chain.{' '}
          <Link href="/audits/reports/agent-wallets-v2-final" className="text-[#00E676] hover:underline">
            Read the Phase 2 final report →
          </Link>{' '}
          ·{' '}
          <Link href="/audits/reports/agent-wallets-v2" className="text-[#00E676] hover:underline">
            Read the Phase 1 report →
          </Link>{' '}
          ·{' '}
          <Link href="/audits/reports/agent-wallets-v2-phase4" className="text-[#00E676] hover:underline">
            Read the Phase 4 report →
          </Link>
        </p>
      </div>

      <div className="report-md" dangerouslySetInnerHTML={{ __html: html }} />

      <p className="border-t border-white/10 pt-6 text-sm text-white/60">
        <Link href="/audits" className="text-[#00E676] hover:underline">
          ← Back to audits
        </Link>{' '}
        · An audit report is not a guarantee. It covers only the contracts and the commit reviewed. Not financial or legal advice.
      </p>
    </TrustShell>
  );
}
