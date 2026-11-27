import type { Metadata } from 'next';
import { TrustShell, TrustSection, ExtLink } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Case studies | Polypad',
  description: 'What agents actually did with the Polypad agent API: Forge launching Agent Swarm on its own, and the API working live in Grok and Muse. Real numbers only.',
  path: '/docs/case-studies',
});

const EXPLORER = 'https://robinhoodchain.blockscout.com';
const TOKEN = '0x3Da9244DDE38284017fD15e45d1Fdf66D3617B4B';
const LAUNCH = '0x2B0b4151cA57546BD968718b1ba256b288e51CA9';
const POOL = '0x52F39a9c65868Ff868436972caD303F99200f56E';
const LAUNCH_TX = '0x8e960bcb756c9bce265e1da1d6a83c478abe715e40ccc9d2c8c52f386afc3c34';

export default function CaseStudiesPage() {
  return (
    <TrustShell
      title="Case studies"
      intro={
        <>
          What agents actually did with the Polypad agent API — with the transaction hashes, so any of it can be
          checked on-chain. Real numbers only: if a number is not verified, it is not on this page.
        </>
      }
    >
      <TrustSection title="Forge launches Agent Swarm — no human in the loop">
        <p>
          On November 16, 2026, Forge — Polypad&apos;s autonomous daily launcher — launched its first token, Agent
          Swarm (SWARM), and created a staking pool for it in the same run. No human touched the launch. Forge
          picked the name from that day&apos;s trending meta on X, wrote the token, and ran it through the same
          agent API any developer can use.
        </p>
        <p className="mt-3">
          <strong>What it cost:</strong> a 0.001 ETH buy at launch returned 526,586 SWARM on the bonding curve,
          and those tokens became the staking reward. Gas for the whole run was about 0.000086 ETH. Total cost:
          about 0.00109 ETH.
        </p>
        <ul className="mt-3 space-y-1.5">
          <li><strong>Token:</strong> <ExtLink href={`${EXPLORER}/address/${TOKEN}`}>{TOKEN}</ExtLink> — 1 billion supply.</li>
          <li><strong>Launch contract:</strong> <ExtLink href={`${EXPLORER}/address/${LAUNCH}`}>{LAUNCH}</ExtLink></li>
          <li><strong>Launch transaction:</strong> <ExtLink href={`${EXPLORER}/tx/${LAUNCH_TX}`}>{LAUNCH_TX}</ExtLink></li>
          <li><strong>Staking pool:</strong> <ExtLink href={`${EXPLORER}/address/${POOL}`}>{POOL}</ExtLink> — 90 days, 1% claim fee, 526,586 SWARM in rewards.</li>
        </ul>
        <p className="mt-3">
          <strong>How it ran:</strong> Forge scanned X for the day&apos;s meta, then called the agent API&apos;s{' '}
          <span className="font-mono text-[13px]">polypad_prepare_token_launch</span>, which built the exact
          unsigned launch transaction. Forge signed it with its own dedicated launcher wallet and sent it — the API
          never holds keys, so the agent signs for itself. The launch carried the 0.001 ETH buy, which bought the
          staking reward. Then Forge created the staking pool directly on the staking factory: there is no MCP tool
          for staking pools yet, so that one step calls the contract, not the API. The token&apos;s name, symbol,
          and description never mention Forge — the token stands on its own, named for the meta — and the
          description states plainly that an AI agent launched it on Polypad.
        </p>
        <p className="mt-3">
          <strong>Why it matters:</strong> the whole loop — prepare through the API, sign with the agent&apos;s own
          wallet, confirm on-chain — ran end to end with no human in the middle, for about a thousandth of an ETH.
          That is the same loop the <a href="/docs/sign-loop" className="text-[#00E676] hover:underline">sign loop</a> page
          documents, and the same launch tool the{' '}
          <a href="/docs/langchain" className="text-[#00E676] hover:underline">LangChain</a> and{' '}
          <a href="/docs/vercel-ai-sdk" className="text-[#00E676] hover:underline">Vercel AI SDK</a> guides use.
        </p>
      </TrustSection>

      <TrustSection title="Works in Grok">
        <p>
          The Polypad agent API was verified live in Grok on November 15, 2026: the MCP server connected, Grok
          listed the 21 tools, and prepare calls returned signing links the same way they do in any other client.
          An agent in Grok can trade, launch a token, join a tokenized fund, or buy an NFT from chat — and the user
          signs every action in their own wallet on <span className="font-mono text-[13px]">polypad.family/sign</span>.
          No API key, no signup.
        </p>
      </TrustSection>

      <TrustSection title="Works in Muse">
        <p>
          The Polypad connector for Muse was built and verified live on November 15, 2026, the same day: the MCP
          server connected, the 21 tools were listed, and prepare calls returned the same unsigned transactions and
          signing links. Anyone can add Polypad to Muse today as a custom connector by pasting the MCP link (
          <span className="font-mono text-[13px]">https://polypad.family/api/mcp</span>) — no review needed for that
          path. The directory listing is a separate step Jon files himself at muse.ai/platform.
        </p>
      </TrustSection>

      <TrustSection title="What is not here">
        <p>
          There is no Polyfund case study on this page. The Polyfund is live, but it was not created through the
          agent API, and this page does not claim otherwise. A case study goes up only when the path it describes
          is verified.
        </p>
        <p className="mt-3">
          Contracts are unaudited. The Safe Harbor terms are published; on-chain registration is in progress. See
          the <a href="/security" className="text-[#00E676] hover:underline">security page</a> for the full picture.
        </p>
      </TrustSection>
    </TrustShell>
  );
}
