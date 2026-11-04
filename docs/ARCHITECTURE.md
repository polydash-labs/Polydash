# Architecture

This document describes staking v1 in detail, then how v2 differs. The wider system (Polypad, creator contracts, buybacks, agents) is diagrammed in the [README](../README.md#architecture). Creator modules are in [CREATOR_CONTRACTS.md](CREATOR_CONTRACTS.md).

The contracts are unaudited. An outside review is planned.

## Overview

Staking-as-a-Service is two contracts:

| Contract | Role |
| --- | --- |
| `PolydashStakingFactory` | Registry + deployer. Anyone calls `createPool`; rewards are pulled from the caller into the new pool in the same transaction. |
| `PolydashStakingPool` | Immutable, non-upgradeable reward pool. One stake token, one reward token, fixed schedule. |

Neither contract is upgradeable or uses proxies.

## Pool lifecycle

1. **Create**: `createPool(stake, reward, amount, start, duration, cap, name, desc)`.
   Bounds: duration 1 day to 3650 days; start ≤ now + 365 days (past/0 = now); name 1–64 bytes; description ≤ 280 bytes.
   The factory transfers `amount` to the pool, then calls `initializeRewards()`, which records the **actual balance received**
   (fee-on-transfer aware) and sets `rewardRate = received * 1e18 / duration`.
2. **Stake**: allowed until `endTime`. Credits the amount actually received. Optional `maxTotalStake` cap (0 = unlimited).
3. **Accrue**: Synthetix-style `rewardPerToken`. While `totalStaked == 0`, emissions go to `unallocatedRewards`.
4. **Withdraw / claim / exit**: principal returned minus the pool's `unstakeFeeBps`; rewards claimable at any time.
5. **Emergency withdraw**: returns principal (fee still applies) and forfeits all accrued rewards to `unallocatedRewards`.
6. **Recover**: after `endTime`, only the creator can call `recoverUnallocated()` to take back never-allocated + forfeited rewards.

## Roles & permissions

| Role | Can | Cannot |
| --- | --- | --- |
| Factory owner | `setFeeRecipient`, `setUnstakeFeeBps` (≤ 500 bps, future pools only), `setVerified`, two-step `transferOwnership` / `acceptOwnership` | Move any pool's staked or reward tokens; change an existing pool's fee or schedule |
| Pool creator | `recoverUnallocated` after end | Withdraw stakers' principal or allocated rewards; end a pool early |
| Staker | stake, withdraw, claim, exit, emergencyWithdraw | — |
| Factory contract | `initializeRewards` once per pool | Anything else on the pool |

## Fee model

- Unstake fee in basis points, **hard-capped at 5%** (`MAX_UNSTAKE_FEE_BPS = 500`) in both the constructor and the setter.
- The fee is **snapshotted into each pool as an immutable** at creation; later changes affect new pools only.
- The fee **recipient** is read from the factory at withdrawal time, so the owner can redirect where future fees go (but not the amount).
- No fee on staking, claiming or pool creation.

## Trust assumptions & known behaviours

- The owner is trusted only for: fee recipient address, fee level of future pools, and the cosmetic `verified` flag.
- Tokens are assumed to be standard or fee-on-transfer ERC-20s. **Rebasing tokens and tokens with transfer hooks/blocklists
  are not supported**; a blocklisted fee recipient could block withdrawals for that token (`emergencyWithdraw` also charges the fee).
- If the reward token taxes transfers, stakers receive the post-tax amount on claim.
- Integer division leaves small dust in pools; it is not recoverable by design.
- Stray tokens sent directly to a pool are not recoverable.
- The `AlreadyRecovered` error and `unallocatedRecovered` flag are declared in v1 but unused (recovery can be called
  repeatedly while there is something to recover).
- `getPools` / `getPoolInfo` are view helpers for front-ends; an unbounded `limit` is the caller's responsibility.

## v2

StakingFactory v2 (`0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0`, deployed Oct 8 2026, 3 pools) runs newer code.
Its source is **verified** ([Blockscout](https://robinhoodchain.blockscout.com/address/0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0?tab=contract)): `PolydashStakingFactoryV2` + `PolydashStakingPoolV2`. Notable v2 differences: share-based accounting (`totalStaked` is shares, `principalBacking()` is tokens), a claim fee (`claimFeeBps`) instead of an unstake fee, `Withdrawn(user, shares, amount)`, `EmergencyWithdrawn`, and `getPoolInfo` / `getPoolAddresses` helpers. This document otherwise describes v1.
