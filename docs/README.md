# Polypad documentation

Polypad is the token launchpad in this repository. It runs on Robinhood Chain (chain ID 4663). This index is the public docs map. The website serves the same outline at `/docs`, linked from the footer and the About page.

| Topic | Document |
| --- | --- |
| Launch flow | [LAUNCH_FLOW.md](LAUNCH_FLOW.md) |
| Commitment window | [LAUNCH_FLOW.md](LAUNCH_FLOW.md#commitment-window) |
| Graduation and the V4 hook | [LAUNCH_FLOW.md](LAUNCH_FLOW.md#graduation) |
| Holder Protections | [HOLDER_PROTECTIONS.md](HOLDER_PROTECTIONS.md) |
| Build activity | [BUILD_ACTIVITY.md](BUILD_ACTIVITY.md) |
| Agent launch API and MCP | [AGENTS_API.md](AGENTS_API.md) |
| Direct `createLaunch` from an operator wallet | [AGENTS_LAUNCH.md](AGENTS_LAUNCH.md) |
| Risk | [RISK.md](RISK.md) |
| Token list (Uniswap schema) | [../tokenlist/README.md](../tokenlist/README.md) |

## Launch flow

A caller uses `createLaunch` on the current factory. The factory deploys a fixed-supply token and a launch clone. The caller is the creator. The creator fee is 0% to 5% on the current factory and stays at the value set in that call. Supply and virtual ETH may be left at zero to take the factory defaults. Details, including the dev buy and the fee split, are in [LAUNCH_FLOW.md](LAUNCH_FLOW.md).

## Commitment window

`launchDelay` is seconds before trading can open. Zero opens the curve immediately. Any other value up to 30 days opens a window where ETH commitments can be withdrawn in full. The website offers 24 hours, 3 days, and 7 days. When the window ends, the dev buy runs before commitment fills. See [LAUNCH_FLOW.md](LAUNCH_FLOW.md#commitment-window).

## Graduation and the V4 hook

Eighty percent of supply trades on a constant-product curve. At the threshold stored on that launch, the crossing buy graduates into a Uniswap V4 pool. The hook holds the full-range liquidity and has no function that removes it. Fees after graduation are still taken in ETH. See [LAUNCH_FLOW.md](LAUNCH_FLOW.md#graduation) and [polypad/contracts/docs/ARCHITECTURE.md](../polypad/contracts/docs/ARCHITECTURE.md).

## Holder Protections

Vesting vaults and creator bonds are optional contracts used after launch. A vault carries the Holder Protections label only when the cliff is at least 30 days and the duration is at least 180 days. That label is a schedule check. A bond posts ETH against a floor balance and can be slashed if the floor fails. Neither one is created by `createLaunch`. See [HOLDER_PROTECTIONS.md](HOLDER_PROTECTIONS.md).

## Build activity

A launch can store `https://github.com/owner/repo` in its social links. The token page labels that URL as Build. Polypad does not check who controls the repository. The agent API accepts the same URL as `repository`. See [BUILD_ACTIVITY.md](BUILD_ACTIVITY.md).

## Agent launch API

`GET /api/agents/v1` describes the HTTP API. `POST /api/agents/v1/validate` checks parameters. `POST /api/agents/v1/simulate` runs `eth_call` and returns an unsigned `createLaunch` transaction. The caller signs it. The API does not accept private keys. Successful calls that keep the default mark store `https://polypad.family/docs#agent-launched` on the token, which the site shows as Agent-launched. The factory bytecode is unchanged.

The MCP server in [`agents/polypad-mcp`](../agents/polypad-mcp) exposes `polypad_validate_launch` and `polypad_prepare_launch` for external agents. See [AGENTS_API.md](AGENTS_API.md). Calling the factory yourself is still described in [AGENTS_LAUNCH.md](AGENTS_LAUNCH.md).

## Risk

Tokens are created by their users. The contracts are unaudited. An outside review is planned. Security-scanned with Bevor. Not a formal audit. Scans are not audits. Not financial advice. See [RISK.md](RISK.md).

## Other documents

| Document | What it covers |
| --- | --- |
| [README](../README.md) | Project overview, architecture, modules, quickstart, deployments |
| [DEPLOYMENTS.md](DEPLOYMENTS.md) | How to read [`deployments/robinhood-chain.json`](../deployments/robinhood-chain.json) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Staking v1 pool lifecycle, roles, and fees, plus how v2 differs |
| [CREATOR_CONTRACTS.md](CREATOR_CONTRACTS.md) | NFT staking, vesting, bonds, gated mints, treasury rules, floor vault, buybacks, tokenized funds |
| [FUND_CORE_FIX.md](FUND_CORE_FIX.md) | Phase 2 deadline, refund, exit, and feed NAV |
| [security/phase2-live-scan.md](security/phase2-live-scan.md) | Security scan of the live Phase 2 deployment. Not a review |
| [PHASE3.md](PHASE3.md) | Phase 3 template, high-water mark, skin lock, tape, brake, and distributions |
| [PHASE4.md](PHASE4.md) | Phase 4 clone planning, agent, season cards, NAV bids, and per-share wallets |
| [funds/PHASE5.md](funds/PHASE5.md) | Phase 5 listings, share art, conviction locks, carry, and the nav-floor queue. Not deployed |
| [AUDIT_SCOPE.md](AUDIT_SCOPE.md) | Staking files and behaviours an outside review would focus on |
| [SECURITY.md](../SECURITY.md) | Reporting a vulnerability and the bug bounty |

Per-module notes live next to the source: [`src/v2`](../src/v2/README.md), [`src/nftstaking`](../src/nftstaking/README.md), [`src/vesting`](../src/vesting/README.md), [`src/bond`](../src/bond/README.md), [`src/gatedmint`](../src/gatedmint/README.md), [`src/treasury`](../src/treasury/README.md), [`src/floorvault`](../src/floorvault/README.md), [`src/buyback`](../src/buyback/README.md), [`src/fund`](../src/fund/README.md).
