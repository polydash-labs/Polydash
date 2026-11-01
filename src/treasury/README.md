# Treasury rules

`TreasuryRulesFactory` deploys a `TreasuryRules` implementation in its constructor and creates one EIP-1167 clone per Polypad token (salt = token). A treasury holds a project's funds under published, on-chain rules so that scheduled tasks (buybacks, reward-pool funding, airdrops) can be executed by an operator only within those rules.

- Only tokens launched through the Polypad launch factories are supported.
- Withdrawals, rule changes and airdrops are queued behind a timelock (`queueWithdraw`, `queueRules`, `queueAirdrop`, then `execute`). The owner can pause the treasury.
- Buybacks route through the bonding curve before graduation and through the Uniswap V4 PoolManager after.
- Reward pools are created through `PolydashStakingFactoryV2`.
- `ITreasuryExternal.sol` holds the minimal Uniswap V4 types and interfaces used by the module.

Status: **not yet deployed.** The source may still change before deployment.

Tests: `test/treasury/`.
