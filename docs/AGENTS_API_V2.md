# Agent API v2 and the Polypad MCP server

Version 2 lets a chat agent browse Polypad and prepare actions on Robinhood Chain (chain id 4663). It is **non-custodial**: every write returns an unsigned transaction and a signing link. The server never holds, asks for, or forwards a key, and it never signs or broadcasts.

Version 1 ([AGENTS_API.md](AGENTS_API.md)) is unchanged. v2 adds trading, NFTs, funds, a portfolio read, plain-language protections, a transaction status read, and a remote MCP server.

* REST: `https://polypad.family/api/agents/v2` (index at the same path).
* Remote MCP (Streamable HTTP, stateless, no auth): `https://polypad.family/api/mcp`.
* Stdio MCP: `agents/polypad-mcp/polypad_mcp.py` (now also exposes the v2 tools).
* Signing page: [POLYPAD_SIGN_PAGE_SPEC.md](grok/POLYPAD_SIGN_PAGE_SPEC.md).
* Chat bot prompt and setup: [grok/bot_prompt.md](grok/bot_prompt.md).

## The prepared-action response

Every `prepare` tool returns:

| Field | Meaning |
| --- | --- |
| `summary` | `headline`, `lines`, `youPay`, `youReceiveAtLeast`, `fees`, `slippageBps`, `risks`. Show this to the person before the link. |
| `transactions[]` | Ordered steps. Each has `to`, `data`, `value` (wei string), `valueHex`, `chainId` 4663, `gas` (estimate times 1.2), `simulated`. |
| `simulation` | `eth_call` result of step 1. A step after an approval cannot be simulated until the approval exists, so it has `simulated: false` and the signing page checks it again. |
| `signing` | `url`, `checksum`, `instructions`, `expiresInSeconds`. |
| `attribution` | The `ref` tag and the standard used. |
| `warnings` | Anything the person should know, such as a buy that reaches the graduation threshold. |

If the simulation reverts, the API returns an error with a plain reason and **no signing link**. A person is never handed a transaction that is known to fail.

### Slippage, size, and caps

* Slippage defaults to 100 bps (1%). The maximum is 1000 bps (10%).
* An action above 1 ETH needs `confirmLarge: true`. Ask the person to confirm the amount before you send it again. Above 25 ETH is refused. Split it.
* Sells add the exact-amount approval step. A graduated token adds the Permit2 approval, then the Universal Router swap.
* A buy in a commitment window becomes `commit()` (minimum 0.0001 ETH) and says it can be withdrawn while the window is open.

### Output firewall

The API refuses to return a transaction whose target is not a known Polypad or Uniswap contract, and refuses actions for the Polydash fee wallet. It rejects any request body with a key field (`privateKey`, `mnemonic`, `seed`, and similar) at any depth, or any 64-hex value, with `400 key_material_rejected`, and does not echo the value. Error messages are scrubbed of URLs, 32-byte hex values, and credentials.

## Tools

| Tool | REST | Kind | Purpose |
| --- | --- | --- | --- |
| `polypad_what_can_i_do` | GET `/api/agents/v2/onboard` | read | What can I do |
| `polypad_intent` | POST `/api/agents/v2/intent` | read | Understand a request |
| `polypad_list_tokens` | GET `/api/agents/v2/tokens` | read | Browse tokens |
| `polypad_get_token` | GET `/api/agents/v2/token` | read | Token details |
| `polypad_token_protections` | GET `/api/agents/v2/protections` | read | Token protections in plain words |
| `polypad_quote_trade` | GET `/api/agents/v2/quote` | read | Quote a buy or sell |
| `polypad_prepare_buy` | POST `/api/agents/v2/prepare/buy` | prepare | Prepare a buy |
| `polypad_prepare_sell` | POST `/api/agents/v2/prepare/sell` | prepare | Prepare a sell |
| `polypad_list_nfts` | GET `/api/agents/v2/nfts` | read | Browse NFT collections |
| `polypad_list_nft_listings` | GET `/api/agents/v2/nfts/listings` | read | Browse marketplace listings |
| `polypad_prepare_nft_buy` | POST `/api/agents/v2/prepare/nft-buy` | prepare | Prepare an NFT buy or mint |
| `polypad_list_fund_templates` | GET `/api/agents/v2/fund-templates` | read | Fund templates |
| `polypad_list_funds` | GET `/api/agents/v2/funds` | read | Discover funds |
| `polypad_get_fund` | GET `/api/agents/v2/fund` | read | Fund details |
| `polypad_prepare_fund_create` | POST `/api/agents/v2/prepare/fund-create` | prepare | Prepare a fund launch |
| `polypad_prepare_fund_mint` | POST `/api/agents/v2/prepare/fund-mint` | prepare | Prepare a fund investment |
| `polypad_prepare_fund_redeem` | POST `/api/agents/v2/prepare/fund-redeem` | prepare | Prepare a fund exit or refund |
| `polypad_prepare_token_launch` | POST `/api/agents/v2/prepare/token-launch` | prepare | Prepare a token launch |
| `polypad_portfolio` | GET `/api/agents/v2/portfolio` | read | Wallet portfolio (read-only) |
| `polypad_get_tx_status` | GET `/api/agents/v2/tx/status` | read | Transaction status |
| `polypad_stats` | GET `/api/agents/v2/stats` | read | Agent traffic stats |

Full input schemas: `GET /api/agents/v2` lists the endpoints, MCP `tools/list` returns the JSON schema of each tool, and `agents/polypad-mcp/schemas/tools_v2.json` is generated from the same registry (`npm run gen:agent-tools`; a test fails if it drifts).

`polypad_intent` accepts plain language ("buy 0.01 ETH of POLYCAT", "launch a fund with POLYDASH", "sell half my STAKE") through a deterministic parser, with no model involved. It runs read-only requests directly. For actions that move funds it needs `from`. If anything is missing it returns the questions to ask and does not guess an amount, a token, or a fee. Dollar amounts are not converted: it asks for ETH.

## What each action does on-chain

| Action | Contract call |
| --- | --- |
| Buy on the curve (launch phase 3) | `PolydashLaunch.buy(minTokensOut)` with ETH |
| Sell on the curve | `token.approve(launch, amount)`, then `PolydashLaunch.sell(tokensIn, minEthOut)` |
| Commit in the window (phase 1) | `PolydashLaunch.commit()` with ETH |
| Buy after graduation | Universal Router `execute(0x10, [V4_SWAP: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL])` on the native-ETH/token pool with the launch's hook |
| Sell after graduation | `token.approve(Permit2)`, `Permit2.approve(token, router, amount, expiry)`, then the same router call |
| NFT public mint (fixed-price collection) | `collection.mint(quantity)` with `mintPrice * quantity` |
| NFT marketplace purchase | `NFTMarketplace.buy(listingId)` with the listing price |
| Create a fund | `FundFactory.createFund(Params)` on the Phase 6 factory (Phase 3 on request) |
| Mint fund shares | `fund.mint(quantity)` with `mintPrice * quantity` |
| Exit a fund | `fund.exit(ids)` after the raise closes |
| Refund a failed raise | `vault.failRaise()` if the deadline passed and nobody marked it yet, then `fund.refund(ids)` |
| Launch a token | `LaunchFactory.createLaunch(...)`, with the Agent-launched label by default |

Not prepared, and linked to the page instead: NFT commitment-window flows and bonding-curve NFT collections (their commit semantics are not verified on-chain yet), and stock tokens or stablecoin baskets in funds (no published template can hold them).

## Attribution

Each prepared main transaction ends with an [ERC-8021](https://eips.ethereum.org/EIPS/eip-8021) schema 0 suffix: `utf8("polypad,<ref>") || len || 0x00 || 0x80218021802180218021802180218021`. The `ref` defaults to `grok` and can be set per request (`[a-z0-9_-]{1,24}`). The suffix is appended after the ABI-encoded arguments, which the contracts ignore. `polypad_get_tx_status` reads it back, and any indexer can count it from calldata. The signing link also carries `ref`, so page visits and signed transactions can be joined in the dashboard. `X-Polypad-Client` (1–64 characters) is recorded for traffic measurement.

Pass `ref` on any prepare tool to separate campaigns, for example `ref: "grok-launch-week"`.

## Limits

| Bucket | Limit |
| --- | --- |
| Reads | 120 per minute per client IP |
| Prepare | 30 per minute per client IP and 12 per minute per wallet |
| Intent | 40 per minute per client IP |
| Request body | 16 KiB |

Limits are in memory per server process, like v1. A `429` carries `retry-after`.

## Errors

`{ "ok": false, "error": { "code", "message", ... } }`. Codes include `invalid_params`, `key_material_rejected`, `amount_too_large`, `confirm_large_required`, `insufficient_balance`, `not_found`, `ambiguous_token`, `not_tradable`, `amount_exceeds_curve`, `simulation_reverted`, `skin_required`, `raise_open`, `sold_out`, `wallet_cap`, `listing_not_valid`, `commit_window_open`, `no_matching_template`, `choose_template`, `rate_limited`, `rate_limited_wallet`, `rpc_unavailable`. MCP tool calls return the same body with `isError: true`.

## Running the tests

```bash
cd polypad/web
npm test                                  # unit tests, no network
FORK_RPC=<rpc url> npm run test:fork      # starts its own anvil fork of chain 4663
python -m pytest agents/tests             # stdio MCP, parity with the registry
```

The fork tests execute every prepared transaction on the fork (curve buy and sell, graduated Uniswap V4 buy and sell with Permit2, NFT mint and marketplace purchase, Phase 6 fund create, mint, failed-raise refund, token launch with and without a commitment window). They never write to the live chain. `FORK_RPC` is read from the environment and is never logged.

## Hosting

The routes are Next.js route handlers in `polypad/web/app/api/agents/v2/[[...slug]]/route.ts` and `polypad/web/app/api/mcp/route.ts`. They need one RPC endpoint (`POLYPAD_RPC_URL`, falling back to `NEXT_PUBLIC_RPC_URL`). A dedicated key is recommended because log scans for the portfolio read use more calls than the public endpoint is meant for.
