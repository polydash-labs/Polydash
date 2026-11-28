import type { Metadata } from 'next';
import GlossaryBox from '@/components/glossary-box';
import { TrustShell } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';
import { ToolReference } from './_components/tool-reference';
import reference from '@/lib/agents-api/v2/tools-reference.json';

export const metadata: Metadata = trustMetadata({
  title: 'Agent API tool reference | Polypad',
  description: 'Every Polypad agent API tool: what it does, its inputs, a copy-paste example, and what can go wrong. Generated from the code the API serves, so it cannot drift.',
  path: '/docs/tools',
});

export default function ToolsPage() {
  return (
    <TrustShell
      title="Agent API — tool reference"
      intro={
        <>
          All 27 tools of the Polypad agent API, in one place. This page is generated from the same code the API
          serves, so it always matches what the server does. No signup, no API key, no approval — point your agent
          at the MCP endpoint and call these tools. Read tools only fetch data. Prepare tools return an unsigned
          transaction, a plain summary, and a signing link — nothing moves without a signature, and Polypad never
          holds your keys.
        </>
      }
    >
      <p className="text-sm leading-relaxed text-white/65">
        Examples use public placeholder addresses: a real token (Agent Swarm) and a real tokenized fund (the
        Polyfund) where an address is needed, and <span className="font-mono text-[13px] text-white">0x1111…1111</span> where
        your own wallet address goes. Replace the <span className="font-mono text-[13px] text-white">from</span> address
        with the wallet that will sign. Amounts are decimal strings in base units (wei for ETH). Full rules — rate
        limits, error codes, versioning — are on the <a href="/docs/rules" className="text-[#00E676] hover:underline">rules of the road</a> page.
        How a prepared action goes from the agent to a signature to a confirmed result — and back to the agent — is on the{' '}
        <a href="/docs/sign-loop" className="text-[#00E676] hover:underline">sign loop</a> page.
        Contracts are unaudited.
      </p>
      <div className="rounded-2xl border border-polydash-green/30 bg-polydash-green/[0.06] p-4">
        <p className="text-[14px] font-medium text-white">Try a read first — no signup, no wallet needed.</p>
        <p className="mt-1 text-[13px] leading-relaxed text-white/65">
          The <a href="/build" className="text-[#00E676] hover:underline">playground on /build</a> calls the live
          API from your browser. Start with a read (list the tools, get live stats), then try a prepare when you
          are ready.
        </p>
      </div>
      <GlossaryBox />
      <ToolReference tools={reference.tools} />
    </TrustShell>
  );
}
