import type { Metadata } from 'next';
import Link from 'next/link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { TrustShell } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Agent Wallet v2 — Phase 4 Report | Polypad',
  description:
    'Warden’s Phase 4 re-review of the agent-wallet v2 fix round 3 (commit 9f43140): I-06 and I-05 fixed and verified, no new findings. Green holds. The fixed contracts are now deployed.',
  path: '/audits/reports/agent-wallets-v2-phase4',
});

export const dynamic = 'force-static';

/**
 * Full Warden Phase 4 report, rendered from the frozen report markdown
 * (content/audits/agent-wallets-v2-phase4.md — the Phase 4 re-review, Nov 22, 2026).
 * The markdown is our own report; the leading H1 is dropped because the
 * TrustShell title carries it.
 */
export default async function AgentWalletsV2Phase4ReportPage() {
  const md = readFileSync(join(process.cwd(), 'content/audits/agent-wallets-v2-phase4.md'), 'utf8');
  const body = md.replace(/^# .*\n/, '');
  const html = await marked.parse(body);

  return (
    <TrustShell
      title="Agent Wallet v2 — Phase 4 Report"
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
            0 Critical · 0 High open · 5 Low · 3 Informational open. I-06 and I-05 fixed in commit{' '}
            <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">9f43140</code> and verified fixed by
            Warden&apos;s own fresh tests (Phase 4, Nov 22, 2026).
          </span>
        </p>
        <p className="mt-2">
          I-06 is fixed: rotation now preserves the new key&apos;s own cap values. I-05 is fully fixed: the paymaster docs now state
          both failure modes — cold first validation fails AA33, warm fails AA36 — re-measured live. No new findings. The fixed contracts
          are now <strong>deployed</strong> on Robinhood Chain (Nov 22, 2026, Sourcify exact_match): SessionKeyModuleV2{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">0xB8A927dfd18D87f5a041706b14424CBBA59Db270</code>, Agent4337Module{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">0x49F49C72FE7B3A7EE418c5936Bd84af2dB57c8E5</code>, Paymaster{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">0x03db6aaf03CAb9B4DA5fc27BF3C20fAC333e86EA</code>, WalletFactoryV2{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">0x944E225D5f53c25aa4C019CFD9B42f0a40b9AC22</code>.
        </p>
        <p className="mt-2">
          Known post-deploy note: the new paymaster only sponsors wallets the new factory knows, so a wallet created by the old factory
          (including the migrated v2 wallet) would be rejected for sponsored transactions until a contract-level fix lands. Do not fund
          the paymaster until that is resolved.
        </p>
        <p className="mt-2">
          Scope: re-review of fix round 3 at commit{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]">9f43140</code> — SessionKeyModuleV2, Agent4337Module,
          Paymaster, WalletFactoryV2 — on Robinhood Chain.{' '}
          <Link href="/audits/reports/agent-wallets-v2-phase3" className="text-[#00E676] hover:underline">
            Read the Phase 3 report →
          </Link>{' '}
          ·{' '}
          <Link href="/audits/reports/agent-wallets-v2-final" className="text-[#00E676] hover:underline">
            Read the Phase 2 final report →
          </Link>{' '}
          ·{' '}
          <Link href="/audits/reports/agent-wallets-v2" className="text-[#00E676] hover:underline">
            Read the Phase 1 report →
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
