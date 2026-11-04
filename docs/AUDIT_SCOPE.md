# Audit scope

Commit: _tag at audit kickoff_ · Compiler: solc 0.8.24, optimizer 200, via-IR, EVM paris.

## In scope

| File | nSLOC* | Notes |
| --- | ---: | --- |
| `src/PolydashStakingFactory.sol` | 168 | Pool deployer, registry, admin |
| `src/PolydashStakingPool.sol` | 190 | Reward accounting, stake/withdraw, fees |
| **Total** | **358** | |

\*Non-blank, non-comment lines.

Deployed instance: StakingFactory v1 `0x0aAEa47d2e7303EC5a809062eafa59e7F011D857` (Robinhood Chain).

**In scope (verified on-chain):** StakingFactory v2 `0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0`: `PolydashStakingFactoryV2.sol` and `PolydashStakingPoolV2.sol`, verified (exact match, solc 0.8.24, optimizer 200, via-IR) at [Blockscout](https://robinhoodchain.blockscout.com/address/0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0?tab=contract). Source mirrored byte-for-byte in [`src/v2/`](../src/v2) (provenance, compiler settings and bytecode check in [`src/v2/README.md`](../src/v2/README.md)); tests in [`test/v2/`](../test/v2).

> **Legacy v1 factory.** StakingFactory v1 (`0x0aAEa47d2e7303EC5a809062eafa59e7F011D857`) is legacy. Its reward accumulator uses 1e18 precision, so a reward token with few decimals (for example 6-decimal USDC) streamed to a large 18-decimal stake supply can round to zero on every update and those rewards are lost. Do not create v1 pools with 6-decimal reward tokens. New pools should use StakingFactory v2.

## Known issues

### V1 fee recipient can freeze exits

Reported by r00k, Hey Research Lab.

`PolydashStakingPool._sendPrincipal` transfers a non-zero unstake fee to the factory `feeRecipient` before principal is sent to the staker. If the stake token reverts on that transfer (a blocklist on USDC or USDT, or any token that refuses the recipient), `withdraw`, `exit`, and `emergencyWithdraw` revert. Principal stays in the pool until the factory owner sets `feeRecipient` to an address the stake token accepts.

V1 is legacy and has a single third-party pool. The deployed source is not modified. The factory owner can rotate `feeRecipient` to unfreeze exits. V2 is not affected: it does not push fees on exit. `collectPlatformFees` pulls platform fees, so a reverting fee recipient does not block v2 principal exits.

`test/PolydashStakingPoolFeeRecipient.t.sol` demonstrates the revert and the rotation. It is test-only.

## Out of scope

- `lib/openzeppelin-contracts` (v5.0.2) and `lib/forge-std`
- $POLYDASH token `0x319525528f42167eF7fC18b77b889958080568e4` (Clanker-deployed) and its LP
- `test/`, `script/`, off-chain apps (Polypad, Polypredict, Polytrade), front-ends

## Areas of interest

- Reward accounting correctness and rounding (`rewardPerToken`, `unallocatedRewards`, emergency forfeits)
- Fee-on-transfer handling for stake and reward tokens; same token used for stake and reward
- Whether any privileged role can move staker principal
- Fee cap enforcement and immutability per pool
