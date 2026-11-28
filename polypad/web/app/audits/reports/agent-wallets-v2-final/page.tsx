import type { Metadata } from 'next';
import Link from 'next/link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { TrustShell } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Agent Wallet v2 — Final Report (Phase 2) | Polypad',
  description:
    'Warden’s Phase 2 final report on Polypad’s agent-wallet v2 contracts (fix commit 7fbb817): H-01, M-01, and M-02 fixed and verified. 0 Critical, 0 High open; 6 Low, 5 Informational open. Green verdict.',
  path: '/audits/reports/agent-wallets-v2-final',
});

export const dynamic = 'force-static';

/**
 * Full Warden Phase 2 final report, rendered from the frozen report markdown
 * (content/audits/agent-wallets-v2-final.md — the Phase 2 re-review, Nov 22, 2026).
 * The markdown is our own report; the leading H1 is dropped because the
 * TrustShell title carries it.
 */
export default async function AgentWalletsV2FinalReportPage() {
  const md = readFileSync(join(process.cwd(), 'content/audits/agent-wallets-v2-final.md'), 'utf8');
  const body = md.replace(/^# .*\n/, '');
  const html = await marked.parse(body);

  return (
    <TrustShell
      title="Agent Wallet v2 — Final Report (Phase 2)"
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
            0 Critical · 0 High open · 6 Low · 5 Informational open. H-01, M-01, and M-02 fixed in commit{' '}
            <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">7fbb817</code> and verified fixed by
            Warden&apos;s own fresh tests (Phase 2, Nov 22, 2026).
          </span>
        </p>
        <p className="mt-2">
          The fix round also surfaced 1 new Low (L-06, duplicate policy tokens double-charge pulls) and 2 new Informational findings
          (I-04, I-05), all open and not verdict-blocking. One known residual is acknowledged: pulls of tokens with no cap set are not
          delta-tracked. Nothing is at risk today — every agent wallet currently holds zero funds, and the paymaster is unfunded and
          inactive. The fixed contracts are now <strong>deployed</strong> (Nov 22, 2026) — the live contracts are the fixed code at
          commit 9f43140.
        </p>
        <p className="mt-2">
          Scope: the four agent-wallet v2 contracts at fix commit{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">7fbb817</code> — SessionKeyModuleV2, Agent4337Module,
          Paymaster, WalletFactoryV2 — on Robinhood Chain. Original review at commit{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">639529b</code>.{' '}
          <Link href="/audits/reports/agent-wallets-v2" className="text-[#00E676] hover:underline">
            Read the Phase 1 report →
          </Link>
        </p>
        <p className="mt-2">
          Phase 3 re-review of fix round 2 (commit{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">0085896</code>): L-06 and I-04 verified fixed, I-05
          partially fixed, one new Informational (I-06). Green holds.{' '}
          <Link href="/audits/reports/agent-wallets-v2-phase3" className="text-[#00E676] hover:underline">
            Read the Phase 3 report →
          </Link>
        </p>
        <p className="mt-2">
          Phase 4 re-review of fix round 3 (commit{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">9f43140</code>): I-06 and I-05 verified fixed, no new
          findings. Green holds. The fixed contracts are now deployed.{' '}
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
