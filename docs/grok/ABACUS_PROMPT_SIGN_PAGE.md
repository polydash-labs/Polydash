Polypad now has an agent API v2 and a remote MCP server so people can use Polypad from a chat agent (Grok Bot). Build the signing page and wire the pieces below into the existing Polypad site. Do not change or move anything that already works (token launch, trading pages, funds, NFTs, /api/agents/v1).

1. Add the v2 API and MCP routes from GitHub (polydash-labs/Polydash, main, after the "Grok agent prepare API" pull request is merged):
- polypad/web/lib/agents-api/v2/** (do not copy the *.test.ts files or fork-harness.ts)
- polypad/web/app/api/agents/v2/[[...slug]]/route.ts
- polypad/web/app/api/mcp/route.ts
Keep the files as they are. They use viem only. Set a server-side environment variable POLYPAD_RPC_URL to the Robinhood Chain RPC the site already uses (never expose it to the browser, never log it). If the site's route files conflict with an existing /api/agents/v2 path, tell me before changing anything.

2. Build the page /sign (built for phones, black and white like the rest of Polypad). Read docs/grok/POLYPAD_SIGN_PAGE_SPEC.md in the repo and follow it exactly. Summary:
- The link carries intent only: /sign?v=1&a=<action>&<params>&f=<wallet>&ref=<ref>&c=<client>&h=<fingerprint>. Actions: buy, sell, nft-buy, nft-mint, fund-create, fund-mint, fund-redeem, token-launch. The param table is in the spec.
- Connect the wallet with the site's existing wallet connection. On phones use the existing deep-link wallets (lib/deep-link-wallets.ts) so the same URL reopens in the wallet app. No QR code. Switch or add Robinhood Chain (chain id 4663).
- Rebuild the transaction by calling POST /api/agents/v2/prepare/<action> with the connected wallet as from, using the mapping in the spec. Show the summary: headline, you pay, you receive at least, fees, slippage limit, the lines, warnings and risks (always visible, including "Not audited."), both fingerprints, and a collapsed Advanced block with raw to, value, chainId, data length. No editing of calldata.
- One primary button "Sign in wallet". Run the steps in order (approval, then the main call). Send each step exactly as the API returned it (to, data, value, gas) with eth_sendTransaction. Never ask for any other signature. Refuse if chainId is not 4663, if the API returns ok:false (show its message), or if a step's to is not one of the addresses the API returned.
- If the API returns confirm_large_required, show the amount with a checkbox "I confirm this amount" and resend with confirmLarge:true.
- After a hash, poll GET /api/agents/v2/tx/status?hash=<hash> every 3 seconds for 2 minutes. Show the plain result, an explorer link, and a "Copy a message for the chat" button ("Done: <hash>").
- Clear loading, empty, error, and expired states. Render all API text as plain text, never HTML. Links only to polypad.family and robinhoodchain.blockscout.com.

3. Attribution and measurement:
- Add a table AgentAction (id, createdAt, action, ref, client, wallet lowercase, txHash, status viewed/connected/sent/confirmed/failed, valueWei, fingerprint, matchedChat). The page writes rows through an internal rate-limited route. Validate ref to [a-z0-9_-]{1,24} and client to 1 to 64 characters.
- Add GET /api/agent-stats: aggregate counts by action and ref for 24 hours, 7 days, and 30 days, plus the number of unique wallets. Counts only, no addresses. Add an admin-only view with the rows.
- Add a small "via Grok" label (and "via agent" for other refs) wherever the site lists a trade, a mint, a fund creation, or a launch, when the transaction input ends with the ERC-8021 marker 80218021802180218021802180218021 and the comma-separated code before it starts with polypad (the string before the length byte is "polypad,<ref>"). Compute it from the transaction input when reading. Do not store it as a claim about the person.

Copy rules for every string you add: never use the words audited (except "Not audited."), safe, guaranteed, first, or best; no price or return claims; write "Robinhood Chain" in full. Do not add "Not financial advice".

Test the full flow on a phone-sized screen with a test wallet: open a buy link, connect, rebuild, sign, see the status. Test a sell with an approval step, a fund mint, an NFT purchase, and an expired or tampered link. Fix any errors and save the version as "Grok signing page". Don't change unrelated pages.
