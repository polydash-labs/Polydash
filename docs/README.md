# Documentation

| Document | What it covers |
| --- | --- |
| [README](../README.md) | Project overview, architecture, modules, quickstart, deployments, security, roadmap |
| [DEPLOYMENTS.md](DEPLOYMENTS.md) | How to read [`deployments/robinhood-chain.json`](../deployments/robinhood-chain.json) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Staking v1 pool lifecycle, roles, and fees, plus how v2 differs |
| [CREATOR_CONTRACTS.md](CREATOR_CONTRACTS.md) | NFT staking, vesting, bonds, gated mints, treasury rules, floor vault, buybacks |
| [AGENTS_LAUNCH.md](AGENTS_LAUNCH.md) | Calling `createLaunch` from an operator-controlled wallet |
| [AUDIT_SCOPE.md](AUDIT_SCOPE.md) | Staking files and behaviours an outside review would focus on |
| [SECURITY.md](../SECURITY.md) | Reporting a vulnerability and the bug bounty |

Per-module notes live next to the source: [`src/v2`](../src/v2/README.md), [`src/nftstaking`](../src/nftstaking/README.md), [`src/vesting`](../src/vesting/README.md), [`src/bond`](../src/bond/README.md), [`src/gatedmint`](../src/gatedmint/README.md), [`src/treasury`](../src/treasury/README.md), [`src/floorvault`](../src/floorvault/README.md), [`src/buyback`](../src/buyback/README.md).

Polypad launchpad design notes: [`polypad/contracts/docs`](../polypad/contracts/docs/ARCHITECTURE.md).

The contracts in this repository are unaudited. An outside review is planned.
