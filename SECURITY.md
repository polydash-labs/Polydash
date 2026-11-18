# Security Policy

Polydash contracts are **unaudited**. Source code is public and verified on Sourcify where applicable. Automated scans are not a review, and they do not remove risk.

Live contract addresses are listed at [polypad.family/contracts](https://polypad.family/contracts) and in the [README](README.md#deployed-contracts-robinhood-chain-chain-id-4663).

## Reporting a vulnerability

Please **do not** open public issues for security problems. Report privately:

- Email: jon@dasheco.xyz (subject: `Security report`)
- Or a private advisory: GitHub, Security tab, "Report a vulnerability"

Please follow responsible disclosure. Include the affected contract and address, the impact, and a proof of concept (a failing Foundry test is ideal).

We aim to acknowledge reports within 72 hours and keep you updated until resolution. Please allow reasonable time for a fix before public disclosure.

### No monetary rewards

Polydash does **not** offer monetary rewards for vulnerability reports. There is no bug bounty budget. Researchers who report valid issues in good faith receive public credit in the fix notes and in the project's security hall of fame, if they wish to be named. Good-faith research that follows this policy will not be pursued legally.

## SEAL Safe Harbor

Polypad is adopting the [SEAL Safe Harbor Agreement for Whitehats](https://frameworks.securityalliance.org/safe-harbor/overview/) (v3). During an active exploit, approved whitehats may rescue funds under the agreement's terms and keep a rescue reward deducted from the rescued funds.

- **Agreement:** registration in progress — the agreement address and registration transaction will be added here once registered
- **Registry:** SafeHarborRegistry `0x326733493E143b8904716E7A64A9f4fb6A185a2c` (registered on Base; Robinhood Chain contracts are covered in scope via `eip155:4663`)
- **Scope:** all Polypad contracts on Robinhood Chain (chain ID 4663), including the deployer address `0x9a21c75aC263cC43125E70200636f6397f8776d0` with scope All, plus the contracts listed below
- **Asset recovery address:** `0x9a21c75aC263cC43125E70200636f6397f8776d0` (moves to the 2-of-3 multisig when it exists)
- **Rescue reward:** 10% of rescued funds, capped at $2,500 per whitehat, deducted from the rescued funds before return (`retainable=true`). No aggregate cap. No payment comes from the project's funds.
- **Identity:** pseudonymous whitehats accepted, subject to sanctions screening (OFAC/US/UK/EU/UN) of the payout address.
- **Timing:** rescued funds must be sent to the asset recovery address within 72 hours; whitehats should reach out within 6 hours of a rescue.

The rescue reward is **not** a bug bounty. It only applies when a whitehat rescues funds during an active exploit. It does not pay for vulnerability reports — see "No monetary rewards" above.

### Active-exploit emergency contact

- SEAL 911: https://t.me/seal_911_bot (free 24/7 emergency triage)

## In scope

Contracts on Robinhood Chain (chain ID 4663):

- Tokenized-fund factories: FundFactoryPhase3V2 `0xe50Da719947E83f316977d9c425DF95672E7B27e`, V3 fund factory `0xB5251BaC3CFE2A057B7703D4477Bf80f10B8154B`, FundAllowlist `0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19`
- Live tokenized funds: Polyfund NFT `0x7c1d31629ac68aebe83f230edbc7eacfc26285ef` (vault `0xbcC982b6A5ABbBb5d94cCE7e772E923F88d29dD9`), Polycat NFT `0x6ab881addd044cc601f21f107f9b110e41531ba4` (vault `0x7d8d3308f54777f5b56fc3efb2afeffe925dfdd2`)
- Token launch factory (current): `0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2`
- Staking factories: current (FoT-claim fix) `0x4C87aff7009DE1c58E052FEe202349a10b28Be9c`, legacy v2 `0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0`, legacy v1 `0x0aAEa47d2e7303EC5a809062eafa59e7F011D857`
- Staking pools created by these factories
- x402 SpendVault: `0xDb5544a977b0dF881268746F2C47F049da579486`
- Agent credit score: AgentRegistry `0x514e352A12F3DB3d4cA649dD328776390e1725eF`, AgentScore `0x1F7ebaAf16aEAa2F519D2Cc69B6091f908C6C92b`
- BuybackVault: `0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193`
- Polypad launchpad and NFT contracts listed at polypad.family/contracts

See [docs/AUDIT_SCOPE.md](docs/AUDIT_SCOPE.md) for details.

### Out of scope

- The $POLYDASH token contract (`0x319525528f42167eF7fC18b77b889958080568e4`, a standard Clanker deployment)
- Third-party contracts and protocols (Uniswap, Clanker, bridges, oracles)
- Websites, front ends, Telegram bots and other off-chain infrastructure
- Issues requiring a compromised owner key, social engineering or phishing
- Known issues listed in the docs, and gas optimizations

### Rules

- Test only on a local fork. Never test against live contracts or real user funds.
- Do not publicly disclose an issue before it is fixed.
- A clear proof of concept is required for any report to be acted on.
- Good-faith research that follows this policy will not be pursued legally.

## Known issues

### V1 staking pool: fee recipient can freeze exits

Reported by r00k, Hey Research Lab.

In `PolydashStakingPool._sendPrincipal` (`src/PolydashStakingPool.sol`), a non-zero unstake fee is transferred to `IPolydashStakingFactory(factory).feeRecipient()` before the staker's principal is returned. If that transfer reverts, `withdraw`, `exit`, and `emergencyWithdraw` all revert. A stake token that refuses the current recipient — for example a blocklist token such as USDC or USDT, or any token that rejects that address — leaves staked principal in the pool until a transfer to the recipient succeeds.

Staking factory v1 (`0x0aAEa47d2e7303EC5a809062eafa59e7F011D857`) is legacy and has a single third-party pool. The deployed v1 source is unchanged. Mitigation: the factory owner keeps `feeRecipient` set to an address the stake token will transfer to, and can rotate `feeRecipient` to unfreeze exits.

Staking factory v2 is not affected. V2 does not push a fee during exit. Platform fees are accounted separately and paid by `collectPlatformFees` (a pull). A reverting fee recipient does not block v2 principal withdrawals, including `emergencyWithdraw`.

A local demonstration is `test/PolydashStakingPoolFeeRecipient.t.sol` (test double only; it does not change `src/`).

### V2 staking pool: fee-on-transfer reward tokens can freeze claims (latent)

Confirmed by Atlas, 2026-11-11 (external researcher report; reproduced locally).

In `PolydashStakingPoolV2._claim()`, a fee-on-transfer reward token makes a claim near the remaining balance revert with `ERC20InsufficientBalance`, freezing rewards. `claim()` takes no amount so users cannot claim a smaller piece, and `exit()` is blocked too (it calls `_claim`); `emergencyWithdraw()` still recovers principal but forfeits rewards.

Live impact: none. All live pools on the legacy v2 factory (`0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0`) use POLYDASH as both stake and reward token (plain ClankerToken ERC20, no fee/hook); claims work live.

Fix deployed 2026-11-11 as a new factory (`0x4C87aff7009DE1c58E052FEe202349a10b28Be9c`): the pool learns the reward-token fee, sizes `_claim` so the real outflow fits, adds `claimAmount(uint256)` for partial claims, and makes `_capReward` outflow-aware. New pools use the new factory only. Pools are standalone and immutable, each permanently bound to its creating factory; old pools read the old factory forever.

## Polypad creator contracts

The creator contracts in `src/nftstaking`, `src/vesting`, `src/bond`, `src/gatedmint`, `src/treasury`, `src/floorvault` and `src/buyback` are **not audited**. They were deployed before an external audit, and an outside review is planned. Their source is verified on Sourcify (addresses in [docs/CREATOR_CONTRACTS.md](docs/CREATOR_CONTRACTS.md)). Scans are not audits. Reports on these contracts are welcome through the channels above.

## Security.txt

The live security contact file is at https://polypad.family/.well-known/security.txt (RFC 9116).
