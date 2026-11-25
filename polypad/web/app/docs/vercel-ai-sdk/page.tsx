import type { Metadata } from 'next';
import { TrustShell, TrustSection } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Build with the Vercel AI SDK | Polypad',
  description: 'Connect a Vercel AI SDK agent to the Polypad agent API with the MCP client: list tokens, quote a trade, prepare a mint — in one small script.',
  path: '/docs/vercel-ai-sdk',
});

const INSTALL = `npm install ai @ai-sdk/mcp @ai-sdk/anthropic`;

const EXAMPLE = `import { generateText, stopWhen, isStepCount } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { anthropic } from "@ai-sdk/anthropic";

// No Polypad account, no API key: the MCP server is open.
const mcp = await createMCPClient({
  transport: {
    type: "http",
    url: "https://polypad.family/api/mcp",
  },
});

const tools = await mcp.tools(); // all 21 polypad_* tools

try {
  const { text } = await generateText({
    model: anthropic("claude-sonnet-4-5"),
    tools,
    // At most 5 rounds of tool calls per request.
    stopWhen: isStepCount(5),
    prompt:
      "List the newest tokens on Polypad, quote 0.01 ETH of POLYDASH, " +
      "and prepare minting 1 share of the Polyfund for wallet " +
      "0x1111111111111111111111111111111111111111. " +
      "Show the signing link for the mint.",
  });
  console.log(text);
} finally {
  await mcp.close();
}`;

export default function VercelAiSdkPage() {
  return (
    <TrustShell
      title="Build with the Vercel AI SDK"
      intro={
        <>
          The Vercel AI SDK talks to Polypad through its MCP client: one client, one URL, and all 21 Polypad tools
          become ordinary AI SDK tools your agent can call from <span className="font-mono text-[13px]">generateText</span> or{' '}
          <span className="font-mono text-[13px]">streamText</span>. No signup, no API key, no approval — the same
          open tier as the rest of the API. This page is the whole guide: install, connect, run the 5-minute check.
        </>
      }
    >
      <TrustSection title="1 · Install">
        <p>
          You need Node 18 or newer and a model key (this example uses Anthropic — pay-as-you-go; a few dollars of
          credit is plenty for this check; any AI SDK provider works). Budget about 5 minutes once those are ready,
          plus a funded wallet on Robinhood Chain for the mint step — see{' '}
          <a href="/docs/sdks" className="text-[#00E676] hover:underline">Wallet binding</a>.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{INSTALL}</pre>
        <p className="mt-3">
          On older AI SDK versions the same client is called{' '}
          <span className="font-mono text-[13px]">experimental_createMCPClient</span> and comes from the{' '}
          <span className="font-mono text-[13px]">ai</span> package instead of{' '}
          <span className="font-mono text-[13px]">@ai-sdk/mcp</span>. The rest of the example is identical.
        </p>
      </TrustSection>

      <TrustSection title="2 · Connect and run">
        <p>
          The client turns the remote MCP server into AI SDK tools. The model decides which tools to call; the
          prepare tools never move money — they return an unsigned transaction, a plain summary, and a signing link,
          and the user signs on <span className="font-mono text-[13px]">polypad.family/sign</span>. The signing
          page then checks the result and, when the agent passed a{' '}
          <span className="font-mono text-[13px]">returnUrl</span>, offers a link back to the agent&apos;s flow.
          How that loop works is on the{' '}
          <a href="/docs/sign-loop" className="text-[#00E676] hover:underline">sign loop</a> page.
        </p>
        <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.08] p-3 text-[13px] leading-relaxed text-amber-200">
          Replace 0x1111…1111 with your funded wallet, or this mint will fail — see{' '}
          <a href="/docs/sdks" className="text-[#00E676] hover:underline">Wallet binding</a>.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{EXAMPLE}</pre>
        <p className="mt-3">
          The <span className="font-mono text-[13px]">http</span> transport is the one for a remote server; the
          stdio transport is for servers running on your own machine. Close the client when the request finishes —
          in a server route, that is the end of the handler.
        </p>
      </TrustSection>

      <TrustSection title="3 · The 5-minute check">
        <p>
          Run the script above and check three things. Each one proves a different part of the wiring, and all three
          together mean your agent is live on Polypad:
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>
            <strong>The agent lists tokens.</strong> The answer names real tokens from{' '}
            <span className="font-mono text-[13px]">polypad_list_tokens</span> — a read, no signature, no cost.
          </li>
          <li>
            <strong>The agent quotes a trade.</strong> The answer for 0.01 ETH of POLYDASH shows an expected output
            and a minimum after slippage, from <span className="font-mono text-[13px]">polypad_quote_trade</span>.
            A quote is a reading, not a promise: the price can move before signing.
          </li>
          <li>
            <strong>The agent prepares a mint.</strong> The answer includes a signing link for minting 1 share of
            the Polyfund (0.01 ETH a share) from{' '}
            <span className="font-mono text-[13px]">polypad_prepare_fund_mint</span>. Open it: the page rebuilds
            the mint for your connected wallet and shows the same summary. Nothing moves until you sign — close the
            page and nothing happened.
          </li>
        </ol>
        <p className="mt-3">
          The wallet address in the example (<span className="font-mono text-[13px]">0x1111…1111</span>) is a
          placeholder. In real use the agent does not pass an address on every call: connect once on{' '}
          <span className="font-mono text-[13px]">polypad.family/sign?connect=1</span>, store the token, and
          pass it as <span className="font-mono text-[13px]">walletToken</span> instead — the{' '}
          <a href="/docs/sdks" className="text-[#00E676] hover:underline">SDKs</a> do this for you, and the{' '}
          <a href="/docs/sign-loop" className="text-[#00E676] hover:underline">sign loop</a> page explains how
          the token works. The per-call address is still there as the fallback.
        </p>
      </TrustSection>

      <TrustSection title="What to build next">
        <p>
          The same wiring runs a token launch (<span className="font-mono text-[13px]">polypad_prepare_token_launch</span>)
          or a tokenized fund (<span className="font-mono text-[13px]">polypad_prepare_fund_create</span>) from a
          script — that is the path Forge uses to launch a token a day; see the{' '}
          <a href="/docs/case-studies" className="text-[#00E676] hover:underline">case studies</a>. Every tool, with
          inputs and copy-paste examples, is in the{' '}
          <a href="/docs/tools" className="text-[#00E676] hover:underline">tool reference</a>, and the limits are
          on the <a href="/docs/rules" className="text-[#00E676] hover:underline">rules of the road</a> page.
          Contracts are unaudited.
        </p>
      </TrustSection>
    </TrustShell>
  );
}
