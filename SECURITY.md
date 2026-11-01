# Security Policy

Polydash contracts are **not audited**. Source code is public and verified on Sourcify where applicable. Automated scans are not audits.

## Supported versions

Security reports are accepted for the currently deployed contracts listed at [polypad.family/contracts](https://polypad.family/contracts) and in the [README](README.md#deployed-contracts-robinhood-chain-chain-id-4663). Staking factory v1 is legacy; reports are still welcome, but fixes ship in newer versions.

## Reporting a vulnerability

Please **do not** open public issues for security problems. Report privately:

- Email: jon@dasheco.xyz (subject: `Security report`)
- Telegram: [@Johhnnylaw31](https://t.me/Johhnnylaw31)
- Or a private advisory: GitHub, Security tab, "Report a vulnerability"

Please follow responsible disclosure. Include the affected contract and address, the impact, and a proof of concept (a failing Foundry test is ideal).

We aim to acknowledge reports within 72 hours and keep you updated until resolution. Please allow reasonable time
for a fix before public disclosure.

## Polypad creator contracts

The creator contracts in `src/nftstaking`, `src/vesting`, `src/bond`, `src/gatedmint` and `src/treasury` are **not audited**. They were deployed before an external audit, and an outside review is planned. Their source is verified on Sourcify (addresses in [docs/CREATOR_CONTRACTS.md](docs/CREATOR_CONTRACTS.md)); the treasury rules module is not yet deployed. Scans are not audits. Reports on these contracts are welcome through the channels above.

## Bug bounty

Polydash runs a small self-hosted bug bounty for its staking contracts.

| Severity | Example impact | Reward |
|---|---|---|
| Critical | Theft or permanent freezing of staked funds or unclaimed rewards | Up to $100 |
| High | Temporary freezing of funds, or rewards paid incorrectly | Up to $50 |
| Medium | Griefing or denial of service with no direct loss of funds | Up to $25 |
| Low | Contract fails to deliver promised behavior, no funds at risk | Recognition |

**Total bounty budget: $100.** Rewards are paid in USDC or $POLYDASH at the team's choice, to the first valid
report of each issue. Severity and reward amounts are decided by the Polydash team.

### In scope

Contracts on Robinhood Chain (bug bounty covers staking contracts; reports on Polypad launchpad and NFT contracts listed at polypad.family/contracts are also welcome):

- Staking factory v2: `0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0` (verified source, `PolydashStakingFactoryV2` / `PolydashStakingPoolV2`: [explorer](https://robinhoodchain.blockscout.com/address/0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0?tab=contract))
- Staking factory v1: `0x0aAEa47d2e7303EC5a809062eafa59e7F011D857` (source in [`src/`](src); [explorer](https://robinhoodchain.blockscout.com/address/0x0aAEa47d2e7303EC5a809062eafa59e7F011D857))
- Staking pools created by these factories

See [docs/AUDIT_SCOPE.md](docs/AUDIT_SCOPE.md) for details.

### Out of scope

- The $POLYDASH token contract (`0x319525528f42167ef7fc18b77b889958080568e4`, a standard Clanker deployment)
- Third-party contracts and protocols (Uniswap, Clanker, bridges, oracles)
- Websites, front ends, Telegram bots and other off-chain infrastructure
- Issues requiring a compromised owner key, social engineering or phishing
- Known issues listed in the docs, and gas optimizations

### Rules

- Test only on a local fork. Never test against live contracts or real user funds.
- Do not publicly disclose an issue before it is fixed.
- A clear proof of concept is required for any reward.
- Good-faith research that follows this policy will not be pursued legally.
