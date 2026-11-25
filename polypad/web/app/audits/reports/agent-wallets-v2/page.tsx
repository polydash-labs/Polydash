import type { Metadata } from 'next';
import Link from 'next/link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { TrustShell } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Agent Wallet v2 — Internal Review | Polypad',
  description:
    'Warden’s Internal Review of Polypad’s own agent-wallet v2 contracts (commit 639529b): 0 Critical, 1 High, 2 Medium, 5 Low, 3 Informational — H-01, M-01, and M-02 fixed and verified in Warden’s Phase 2 final report. Full findings, proof of concept, and fixes.',
  path: '/audits/reports/agent-wallets-v2',
});

export const dynamic = 'force-static';

/**
 * Full Warden report, rendered from the frozen report markdown
 * (content/audits/agent-wallets-v2.md — the Phase 1 report, Nov 22, 2026).
 * The markdown is our own report; the leading H1 is dropped because the
 * TrustShell title carries it. Disclosure banner and plain-language summary
 * are part of the report body and render verbatim.
 */
export default async function AgentWalletsV2ReportPage() {
  const md = readFileSync(join(process.cwd(), 'content/audits/agent-wallets-v2.md'), 'utf8');
  const body = md.replace(/^# .*\n/, '');
  const html = await marked.parse(body);

  return (
    <TrustShell
      title="Agent Wallet v2 — Internal Review"
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
          <strong className="text-white">Green — no critical or high findings open.</strong>
          <span>
            Phase 1 findings (Nov 22, 2026): 0 Critical · 1 High · 2 Medium · 5 Low · 3 Informational. H-01, M-01, and M-02 were fixed
            in commit <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">7fbb817</code> and verified fixed by
            Warden&apos;s Phase 2 re-review.{' '}
            <Link href="/audits/reports/agent-wallets-v2-final" className="text-[#00E676] hover:underline">
              Read the final report →
            </Link>
          </span>
        </p>
        <p className="mt-2">
          This is the frozen Phase 1 report — the findings as first found, all Open at the time. Nothing is at risk today — every agent
          wallet currently holds zero funds, and the paymaster is unfunded and inactive. The fixed contracts have since been deployed
          (Nov 22, 2026) — see the{' '}
          <Link href="/audits/reports/agent-wallets-v2-phase4" className="text-[#00E676] hover:underline">
            Phase 4 report
          </Link>{' '}
          for the live addresses.
        </p>
        <p className="mt-2">
          Scope: the four agent-wallet v2 contracts at commit{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">639529b</code> — SessionKeyModuleV2, Agent4337Module,
          Paymaster, WalletFactoryV2 — on Robinhood Chain.
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
