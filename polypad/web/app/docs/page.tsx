import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { AgentLaunchedBadge } from '@/components/agent-launched-badge';

export const metadata: Metadata = {
  title: 'Docs | Polypad',
  description: 'Polypad documentation: launch flow, commitment window, Uniswap V4 graduation, Holder Protections, build activity, and the agent launch API on Robinhood Chain.',
};

const SOURCE = 'https://github.com/polydash-labs/Polydash/blob/main';

const sections = [
  { href: '#launch', label: 'Launch flow' },
  { href: '#commitment', label: 'Commitment window' },
  { href: '#graduation', label: 'Graduation' },
  { href: '#holder-protections', label: 'Holder Protections' },
  { href: '#build-activity', label: 'Build activity' },
  { href: '#agent-launched', label: 'Agent launch API' },
  { href: '#risk', label: 'Risk' },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-5 sm:px-8 py-10 sm:py-16 space-y-12 sm:space-y-16">
          <section>
            <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight leading-tight">Polypad docs</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-white/60">
              Polypad is a token launchpad on Robinhood Chain (chain ID 4663). These pages describe how a launch
              moves from creation to a Uniswap V4 pool, which labels the site shows, and how an external agent
              prepares an unsigned <span className="font-mono text-white/80">createLaunch</span> transaction.
              The same notes live in the repository under <a className="text-polydash-green hover:underline" href={`${SOURCE}/docs/README.md`}>docs/</a>.
            </p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {sections.map((section) => (
                <li key={section.href}>
                  <a href={section.href} className="inline-flex rounded-full bg-white/[0.06] px-3 py-1 text-[12px] text-white/70 hover:text-white">
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section id="launch" className="scroll-mt-20 space-y-3">
            <h2 className="text-[15px] font-semibold">Launch flow</h2>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              Anyone can call <span className="font-mono text-white/80">createLaunch</span> on the current factory
              (<span className="font-mono text-white/80">0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2</span>). There is
              no allowlist and no backend signature. The caller is the creator. The factory deploys an ERC-20 with
              a fixed supply and a clone of the launch contract, then either opens trading or a commitment window.
            </p>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              The creator fee is chosen at launch, from 0% to 5% (0 to 500 bps) on the current factory, and does
              not change afterward. <span className="font-mono text-white/80">0</span> means zero, not a hidden
              default. Total supply and virtual ETH may be left at <span className="font-mono text-white/80">0</span> to
              use the factory defaults (1,000,000,000 tokens and 1.5 ETH). A dev buy is optional and must equal
              the ETH sent with the transaction. Trades pay a 0.2% platform fee plus the creator fee, both taken in ETH.
            </p>
            <p className="text-[13px] leading-relaxed">
              <a className="text-polydash-green hover:underline" href={`${SOURCE}/docs/LAUNCH_FLOW.md`}>Launch flow in the repository</a>
            </p>
          </section>

          <section id="commitment" className="scroll-mt-20 space-y-3">
            <h2 className="text-[15px] font-semibold">Commitment window</h2>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              <span className="font-mono text-white/80">launchDelay</span> is the number of seconds before trading
              can start. <span className="font-mono text-white/80">0</span> opens the curve immediately. The factory
              accepts up to 30 days. The website offers 24 hours, 3 days, and 7 days. During the window, people
              commit ETH and can withdraw it in full. When the time is reached, anyone can start the launch: the
              creator&apos;s dev buy runs before commitments are filled in batches at curve prices.
            </p>
            <p className="text-[13px] leading-relaxed">
              <a className="text-polydash-green hover:underline" href={`${SOURCE}/docs/LAUNCH_FLOW.md#commitment-window`}>Commitment window notes</a>
            </p>
          </section>

          <section id="graduation" className="scroll-mt-20 space-y-3">
            <h2 className="text-[15px] font-semibold">Graduation and the V4 hook</h2>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              Eighty percent of the supply sits on a constant-product curve. The other twenty percent is reserved
              for liquidity. When real ETH raised reaches the threshold frozen into that launch, the buy that
              crosses it graduates in the same transaction. The hook creates a Uniswap V4 pool at the final curve
              price and holds the full-range position. The hook has no function that removes that liquidity.
              Creator and platform fees continue to be charged in ETH on swaps after graduation.
            </p>
            <p className="text-[13px] leading-relaxed">
              <a className="text-polydash-green hover:underline" href={`${SOURCE}/docs/LAUNCH_FLOW.md#graduation`}>Graduation notes</a>
              {' · '}
              <a className="text-polydash-green hover:underline" href={`${SOURCE}/polypad/contracts/docs/ARCHITECTURE.md`}>Contract architecture</a>
            </p>
          </section>

          <section id="holder-protections" className="scroll-mt-20 space-y-3">
            <h2 className="text-[15px] font-semibold">Holder Protections</h2>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              Holder Protections are optional contracts a creator can use after launch. They are not created by
              <span className="font-mono text-white/80"> createLaunch</span>. A vesting vault shows the Holder
              Protections label only when <span className="font-mono text-white/80">meetsBadgeMinimum</span> is
              true: cliff of at least 30 days and duration of at least 180 days. Shorter schedules are still
              valid on the contract; the label is a schedule check, not a promise about price or behaviour.
              A creator bond posts ETH against a floor token balance of registered wallets. Missing the floor
              before the end lets anyone slash. Neither contract can be shortened by an admin.
            </p>
            <p className="text-[13px] leading-relaxed">
              <a className="text-polydash-green hover:underline" href={`${SOURCE}/docs/HOLDER_PROTECTIONS.md`}>Holder Protections</a>
            </p>
          </section>

          <section id="build-activity" className="scroll-mt-20 space-y-3">
            <h2 className="text-[15px] font-semibold">Build activity</h2>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              To point a launch at source code, pass <span className="font-mono text-white/80">https://github.com/owner/repo</span> as
              a social link, or as the <span className="font-mono text-white/80">repository</span> field on the
              agent API. The token page labels the earliest matching URL as Build. Polypad does not check that the
              repository belongs to the creator. The link is whatever the launch stored.
            </p>
            <p className="text-[13px] leading-relaxed">
              <a className="text-polydash-green hover:underline" href={`${SOURCE}/docs/BUILD_ACTIVITY.md`}>Build activity linking</a>
            </p>
          </section>

          <section id="agent-launched" className="scroll-mt-20 space-y-3">
            <h2 className="text-[15px] font-semibold">Agent launch API</h2>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              <a className="text-polydash-green hover:underline" href="/api/agents/v1">GET /api/agents/v1</a> describes
              the HTTP API. <span className="font-mono text-white/80">POST /api/agents/v1/validate</span> checks
              parameters. <span className="font-mono text-white/80">POST /api/agents/v1/simulate</span> runs
              <span className="font-mono text-white/80"> eth_call</span> against the factory and returns an unsigned
              transaction for the <span className="font-mono text-white/80">from</span> address you supply. You sign
              and broadcast it. The API rejects bodies that contain a private key or seed phrase, and it rate-limits
              by IP (20 requests / 10 minutes per process).
            </p>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              Launches prepared with the mark store <span className="font-mono text-white/80">https://polypad.family/docs#agent-launched</span> in
              <span className="font-mono text-white/80"> socialLinks</span>. The site reads that URL from the token
              and shows <AgentLaunchedBadge />. The factory bytecode is unchanged. A website launch opened at{' '}
              <Link href="/create?agent=1" className="text-polydash-green hover:underline">/create?agent=1</Link> stores
              the same mark. <span className="font-mono text-white/80">GET /api/agents/v1/marks?from=</span> is a
              per-process log of successful simulations and is not the badge.
            </p>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              External agents can call the same tools through the MCP server in{' '}
              <a className="text-polydash-green hover:underline" href={`${SOURCE}/agents/polypad-mcp`}>agents/polypad-mcp</a>.
              The server returns the unsigned transaction. It does not sign.
            </p>
            <p className="text-[13px] leading-relaxed">
              <a className="text-polydash-green hover:underline" href={`${SOURCE}/docs/AGENTS_API.md`}>Agent API reference</a>
              {' · '}
              <a className="text-polydash-green hover:underline" href={`${SOURCE}/docs/AGENTS_LAUNCH.md`}>Direct factory call</a>
            </p>
          </section>

          <section id="risk" className="scroll-mt-20 space-y-3">
            <h2 className="text-[15px] font-semibold">Risk</h2>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              Tokens on Polypad are created by their users. The contracts are unaudited. An outside review is planned.
              Security-scanned with Bevor. Not a formal audit. Scans are not audits. Not financial advice.
              Using these contracts can result in loss of funds. An Agent-launched badge only records that the
              unsigned transaction was prepared with the mark. It is not a review of the token, the creator, or the linked repository.
            </p>
            <p className="text-[13px] leading-relaxed">
              <a className="text-polydash-green hover:underline" href={`${SOURCE}/docs/RISK.md`}>Risk notes</a>
              {' · '}
              <Link href="/about" className="text-polydash-green hover:underline">About</Link>
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
