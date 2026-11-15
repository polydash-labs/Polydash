# Polypad signing page: `/sign`

Status: specification. The page is not built or deployed by this change. It is a Polypad site page (hosted on Abacus), so it goes in as an Abacus prompt: [ABACUS_PROMPT_SIGN_PAGE.md](ABACUS_PROMPT_SIGN_PAGE.md).

## Purpose

A chat agent prepares an action through the v2 API and hands the person one link. The link opens a Polypad page that shows what will happen in plain words and asks the person's own wallet to sign. One tap on a phone, no copying calldata, no QR code.

Non-custodial rules:

* The link carries **intent** (an action and its parameters), never calldata, never a key.
* The page rebuilds the transaction through `POST /api/agents/v2/prepare/<action>` with the **connected wallet** as `from`. What the person signs is what the page just built and showed.
* The page never signs with any wallet it controls. There is no server-side signer.

## URL

```text
https://polypad.family/sign?v=1&a=<action>&<params>&f=<wallet>&ref=<ref>&c=<client>&h=<fingerprint>
```

| Param | Meaning |
| --- | --- |
| `v` | Link version. Must be `1`. |
| `a` | Action: `buy`, `sell`, `nft-buy`, `nft-mint`, `fund-create`, `fund-mint`, `fund-redeem`, `token-launch`. |
| `f` | The wallet the chat prepared the action for. Informational. The page uses the connected wallet. |
| `ref` | Attribution tag, `[a-z0-9_-]{1,24}`. Defaults to `grok`. |
| `c` | Client name from `X-Polypad-Client`, optional. |
| `h` | Fingerprint of the main transaction: 12 hex characters. |

### Parameters per action

| Action | Link params | Rebuild call and body |
| --- | --- | --- |
| `buy` | `t` launch address, `amt` wei, `sl` slippage bps | `prepare/buy` `{ token: t, amountWei: amt, slippageBps: sl, from, ref }` |
| `sell` | `t`, `amt` token base units **or** `pct` 1 to 100, `sl` | `prepare/sell` `{ token: t, amount: amt` or `percentOfBalance: pct, slippageBps: sl, from, ref }` |
| `nft-buy` | `l` listing id | `prepare/nft-buy` `{ listingId: l, from, ref }` |
| `nft-mint` | `col` collection, `q` quantity | `prepare/nft-buy` `{ collection: col, quantity: q, from, ref }` |
| `fund-create` | `fx` factory id, `tpl`, `n` name, `s` symbol, `mp` mint price wei, `rc` raise cap wei, `ef` entry fee bps, `sk` min skin bps, `rd` raise duration seconds, `img`, `bu` | `prepare/fund-create` `{ factory: fx, templateId: tpl, name: n, symbol: s, mintPriceWei: mp, raiseCapWei: rc, entryFeeBps: ef, minSkinBps: sk, raiseDurationSeconds: rd, imageUri: img, baseURI: bu, from, ref }` |
| `fund-mint` | `fund`, `q` | `prepare/fund-mint` `{ fund, quantity: q, from, ref }` |
| `fund-redeem` | `fund`, `ids` comma-separated | `prepare/fund-redeem` `{ fund, ids: ids.split(","), from, ref }` |
| `token-launch` | `p` base64url of the JSON launch fields | `prepare/token-launch` `{ ...JSON.parse(base64url(p)), from, ref }` |

Unknown actions, unknown params, a bad `v`, or malformed values show a plain error and nothing else. Every value is validated again by the API. The page does not trust the link.

### Fingerprint `h`

`keccak256(to || selector || value || chainId)`, the leading 12 hex characters, over the main transaction. It leaves out the minimum-out amount and the deadline, which move with the market, so the chat and the page show the same code unless the action itself differs (a different contract, function, or ETH amount). The page shows both codes. A mismatch is not an error by itself (the connected wallet may differ, or the action may have changed state), but the page shows it in words: "This differs from what the chat showed."

## Page flow

1. **Parse** the link. Show a short loading state.
2. **Connect** a wallet with the site's existing wallet connection. On a phone, offer the deep-link wallets (MetaMask, Coinbase Wallet, Trust Wallet, Phantom) from `lib/deep-link-wallets.ts`, which reopen this same URL inside the wallet's browser. No QR code step.
3. **Switch chain** to Robinhood Chain (4663) if needed. Offer to add it.
4. **Rebuild** through the API with the connected address as `from`. Show the summary:
   * Headline.
   * `youPay` and `youReceiveAtLeast`, fees, slippage limit, and the list of `lines`.
   * `warnings` and `risks`, always visible, including "Not audited."
   * Both fingerprints.
   * A collapsed "Advanced" block with the raw `to`, `value`, `chainId`, and data length per step. No editing.
5. **Confirm and sign.** One primary button: "Sign in wallet". If the action has several steps (approval, then the main call), show them as a numbered list and run them in order. Each step is a normal `eth_sendTransaction` with `to`, `data`, `value`, and `gas` taken verbatim from the API response. The page never changes calldata, never adds a spender, and never asks for a signature other than a transaction.
6. **Refuse** to proceed if `chainId` is not 4663, if the API returns `ok: false`, or if a step's `to` is not one of the addresses the API returned for that action. Show the API's message.
7. **Follow up.** After a hash, poll `GET /api/agents/v2/tx/status?hash=` every 3 seconds up to 2 minutes. Show the plain result, the explorer link, and a "Copy a message for the chat" button ("Done: <hash>"), so the person can tell the chat agent and ask for the status.
8. **Large amounts.** If the API answers `confirm_large_required`, show the amount and a checkbox "I confirm this amount", then resend with `confirmLarge: true`.

Copy rules for every string on the page: never "audited" except "Not audited.", never "safe", "guaranteed", "first", or "best"; no price or return claims; "Robinhood Chain" in full. Render all API text as plain text, never as HTML.

## Attribution and measurement

A table `AgentAction` records page activity so traction is measurable:

| Column | Notes |
| --- | --- |
| `id`, `createdAt` | |
| `action` | From `a`. |
| `ref`, `client` | From `ref` and `c`. |
| `wallet` | Connected address, lowercase, only after the person connects. |
| `txHash`, `status` | `viewed`, `connected`, `sent`, `confirmed`, `failed`. |
| `valueWei` | Value of the main transaction. |
| `fingerprint`, `matchedChat` | The `h` code and whether it matched. |

Write through an internal route the page calls (rate limited, no PII beyond the wallet). Aggregates only are public: `GET /api/agent-stats` returns counts by action and `ref` for 24 hours, 7 days, and 30 days, plus the number of unique wallets. Per-wallet rows are visible only in the admin area.

### "via Grok" badge

A transaction whose calldata ends with the ERC-8021 marker `80218021802180218021802180218021` and whose codes start with `polypad` was prepared through the agent API. Where the site lists a trade, a mint, a fund creation, or a launch, show a small label "via Grok" when the codes include `grok`, or "via agent" for any other `ref`. Compute it from the transaction input at read time. Do not store it as a claim about the person.

## Security

* No `dangerouslySetInnerHTML`. Links in API text are allowed only to `polypad.family` and `robinhoodchain.blockscout.com`.
* The page never sends a private key or seed phrase anywhere and has no field that accepts one. If the link contains a field with such a name, ignore the link and show an error.
* Send `X-Polypad-Client: sign-page` on rebuild calls.
* `ref` and `c` are display and counting values only. Validate them to their patterns before storing.

## Deploy list (Abacus)

1. The v2 API: `polypad/web/lib/agents-api/v2/**`, `polypad/web/app/api/agents/v2/[[...slug]]/route.ts`.
2. The remote MCP route: `polypad/web/app/api/mcp/route.ts`.
3. The `/sign` page, the `AgentAction` table, `/api/agent-stats`, and the "via Grok" label.
4. `POLYPAD_RPC_URL` set to a dedicated endpoint (a server-side environment variable, never exposed to the browser).
