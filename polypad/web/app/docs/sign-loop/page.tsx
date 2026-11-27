import type { Metadata } from 'next';
import GlossaryBox from '@/components/glossary-box';
import { TrustShell, TrustSection } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Prepare → sign → confirm: the sign loop | Polypad',
  description: 'How a prepared transaction goes from an agent to a signature to a confirmed result — and how the agent gets the answer back. Plain language, no signup.',
  path: '/docs/sign-loop',
});

const MCP_CALL = `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "polypad_prepare_fund_mint",
    "arguments": {
      "from": "<YOUR_FUNDED_WALLET_ADDRESS>",
      "fund": "0x7c1d31629ac68aebe83f230edbc7eacfc26285ef",
      "quantity": 1,
      "returnUrl": "https://example.com/agent/done"
    }
  }
}`;

const STATUS_CALL = `curl "https://polypad.family/api/agents/v2/tx/status?hash=0x<tx-hash>"`;

export default function SignLoopPage() {
  return (
    <TrustShell
      title="Prepare → sign → confirm: the sign loop"
      intro={
        <>
          An agent action is not done when the transaction is prepared, and it is not done when it is signed.
          It is done when the agent knows the result. The sign loop is the whole round trip — prepare, sign,
          confirm — with the confirmation owned by Polypad, not by the user telling the agent “I think it
          worked.” No signup, no API key, no approval.
        </>
      }
    >
      <GlossaryBox />
      <TrustSection title="The loop in three steps">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <strong>Prepare.</strong> The agent calls a <span className="font-mono text-[13px]">polypad_prepare_*</span> tool
            with the wallet that will sign — as a <span className="font-mono text-[13px]">walletToken</span> from
            a single connect (see below), or as the <span className="font-mono text-[13px]">from</span> address
            on that call. The API simulates the transaction on-chain first. If it would fail, there is no signing link — the agent gets
            an error and the reason instead. If it passes, the agent gets the unsigned transaction, a plain summary,
            and a one-tap signing link to <span className="font-mono text-[13px]">polypad.family/sign</span>.
          </li>
          <li>
            <strong>Sign.</strong> The user opens the link, connects their wallet, and checks the plain summary
            on the page — what they pay, the minimum they receive, the fees — against what the agent said in the
            chat. The page also shows a short fingerprint code for the action, made from the transaction itself
            (where it sends, what it does, the amount, the chain), so any change to the action changes the code;
            if the code on the page matches the code the agent showed in the chat, the action on the page is the
            same one the agent described. If the codes differ, the action on the page is not the one the agent
            described — stop and ask the agent for a fresh link. Then the user signs in their own wallet.
            Polypad never holds keys and never signs. Before showing the summary, the signing page asks the API
            to prepare the same action again for the connected wallet — a fresh on-chain simulation — so a link
            prepared for one wallet cannot be signed by another. Because the simulation is fresh, the amounts on
            the page can differ from the chat&apos;s numbers if prices or balances moved since the agent prepared
            it; trust the page&apos;s summary, not the chat&apos;s.
          </li>
          <li>
            <strong>Confirm.</strong> After the transaction is sent, the signing page watches it: it calls{' '}
            <span className="font-mono text-[13px]">polypad_get_tx_status</span> every few seconds until Robinhood
            Chain confirms it (or it fails), and shows the result in plain words — what was bought, what tokenized fund was
            created — with an explorer link. An agent can do the same check itself from the API; see below.
          </li>
        </ol>
      </TrustSection>

      <TrustSection title="The way back: returnUrl">
        <p>
          A prepare call takes an optional <span className="font-mono text-[13px]">returnUrl</span> — an https://
          link back to the agent&apos;s own flow, such as its confirmation page. When it is given, the signing
          page shows a <strong>“Back to the agent”</strong> button once the transaction confirms (or fails). The
          button goes to the return link with two values added: <span className="font-mono text-[13px]">tx</span>{' '}
          (the transaction hash) and <span className="font-mono text-[13px]">status</span>{' '}
          (<span className="font-mono text-[13px]">confirmed</span> or <span className="font-mono text-[13px]">failed</span>),
          so the agent can pick up where it left off without asking the user anything.
        </p>
        <p className="mt-3">
          The return link has to be an https:// address, at most 2,048 characters. Anything else is ignored — the
          action still works, it just has no way back. The page never sends the user anywhere on its own; the
          button is always a tap, and the return link is shown on the page so the user can see where it goes.
          The same is true after connecting a wallet (below): the way back is always a button the user taps,
          never an automatic redirect.
          Without a <span className="font-mono text-[13px]">returnUrl</span>, the page still shows the confirmation
          and a button to copy a short “Done: 0x…” message back into the chat.
        </p>
        <p className="mt-3">
          Every prepare tool takes <span className="font-mono text-[13px]">returnUrl</span> — buy, sell, NFT buy and
          mint, tokenized fund create, mint and redeem, and token launch. The field is listed in the{' '}
          <a href="/docs/tools" className="text-[#00E676] hover:underline">tool reference</a>, and the signing
          link carries it as the <span className="font-mono text-[13px]">r</span> parameter.
        </p>
      </TrustSection>

      <TrustSection title="Checking the result yourself">
        <p>
          The agent does not have to wait for the user to come back. After any prepare call, it can ask for the
          transaction&apos;s status with <span className="font-mono text-[13px]">polypad_get_tx_status</span> (or the
          matching REST call) and poll every few seconds until the answer is{' '}
          <span className="font-mono text-[13px]">confirmed</span> or <span className="font-mono text-[13px]">failed</span>.
          The answer is plain words — what happened, not just a receipt — plus the explorer link.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{STATUS_CALL}</pre>
        <p className="mt-3">
          While the transaction is still travelling, the answer is{' '}
          <span className="font-mono text-[13px]">pending</span>. If the hash is unknown — it was never sent — the
          answer is a 404 (<span className="font-mono text-[13px]">tx_not_found</span>). A mined transaction that
          failed on-chain still answers <span className="font-mono text-[13px]">failed</span>, with the note that
          only gas was spent.
        </p>
      </TrustSection>

      <TrustSection title="A full example">
        <p>
          An agent mints 1 share of the Polyfund (a tokenized fund, 0.01 ETH a share) for a wallet, and wants the
          user sent back to its own confirmation page afterwards:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{MCP_CALL}</pre>
        <p className="mt-3">
          Replace <span className="font-mono text-[13px]">&lt;YOUR_FUNDED_WALLET_ADDRESS&gt;</span> with your
          own funded wallet address — the prepare step checks that wallet&apos;s balance, so the example fails
          with an empty wallet. The reply includes <span className="font-mono text-[13px]">signing.url</span> (the signing link, already
          carrying the return link) and <span className="font-mono text-[13px]">signing.returnUrl</span> (the return
          link echoed back). The agent shows the summary, shares the link, and the user signs. The signing page
          then confirms the mint and offers the way back.
        </p>
      </TrustSection>

      <TrustSection title="Which wallet signs? Connect once">
        <p>
          The agent passes the signing wallet once — not on every call. The user opens{' '}
          <span className="font-mono text-[13px]">polypad.family/sign?connect=1</span>, connects their wallet,
          and signs one short message (not a transaction, no funds move). The page gives them a token, good for
          90 days. The agent stores it — as <span className="font-mono text-[13px]">POLYPAD_WALLET_TOKEN</span>{' '}
          in the SDKs — and passes it as <span className="font-mono text-[13px]">walletToken</span> instead of a
          wallet address on every prepare call. The server recovers the wallet from the signature, checks it
          matches the wallet named in the token and that the token has not expired, and uses that wallet. When
          the agent passes a <span className="font-mono text-[13px]">returnUrl</span> to the connect page, the
          page shows a <strong>“Back to the agent”</strong> button that takes the user back to it with{' '}
          <span className="font-mono text-[13px]">?walletToken=...</span>{' '}
          and <span className="font-mono text-[13px]">?wallet=...</span> added. Like the button after a signing,
          it only goes when tapped — the page never sends the user anywhere on its own.
        </p>
        <p className="mt-3">
          The token is self-contained — the wallet address, the expiry, and the signature, encoded as text — so
          Polypad stores nothing about it. The trade-off is honest: a token cannot be revoked from the server.
          It stops working when it expires, or when the holder deletes it. Treat it like a password for that
          one wallet and never paste it in a public chat — and do not share the return link the connect page
          gives you, because the token travels in that link&apos;s address. If the token or the link leaks,
          delete the token and connect again for a fresh one. The token alone cannot move funds: it only tells
          the API which wallet to prepare actions for, and every prepared action still needs the user&apos;s
          signature in their own wallet before anything is sent.
        </p>
        <p className="mt-3">
          Per-call <span className="font-mono text-[13px]">from</span> still works as the fallback: a call with
          no token still needs the wallet address, exactly as before. A call with both must agree — a token and
          a different address is refused. The SDKs (<a href="/docs/sdks" className="text-[#00E676] hover:underline">TypeScript and Python</a>)
          use the token model throughout: connect once, then no address on any call.
        </p>
      </TrustSection>

      <TrustSection title="Limits that touch the loop">
        <p>
          Prepared actions are limited to 30 per minute per IP address, and 12 per minute per wallet. One action
          is at most 25 ETH; above 1 ETH the user confirms the amount first. A signing link expires after 20
          minutes — after that, the agent prepares the action again with current amounts. The full list is on the{' '}
          <a href="/docs/rules" className="text-[#00E676] hover:underline">rules of the road</a> page.
        </p>
        <p className="mt-3">
          Contracts are unaudited. The Safe Harbor terms are published; on-chain registration is in progress. See
          the <a href="/security" className="text-[#00E676] hover:underline">security page</a> for the full picture.
        </p>
      </TrustSection>
    </TrustShell>
  );
}
