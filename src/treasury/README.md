# Treasury rules

These contracts are unaudited. An outside review is planned.

`TreasuryRulesFactory` deploys a `TreasuryRules` implementation in its constructor and creates one EIP-1167 clone per Polypad token (salt = token). A treasury holds a project's funds under published, on-chain rules so that scheduled tasks (buybacks, reward-pool funding, airdrops) can be executed by an operator only within those rules.

- Only tokens launched through the Polypad launch factories are supported.
- Withdrawals, rule changes and airdrops are queued behind a timelock (`queueWithdraw`, `queueRules`, `queueAirdrop`, then `execute`). The owner can pause the treasury.
- Buybacks route through the bonding curve before graduation and through the Uniswap V4 PoolManager after.
- Reward pools are created through `PolydashStakingFactoryV2`.
- `ITreasuryExternal.sol` holds the minimal Uniswap V4 types and interfaces used by the module.

Deployed factory: [`0x2A06dafEd9A5CaBC7693683E24025f96D7AF656f`](https://robinhoodchain.blockscout.com/address/0x2A06dafEd9A5CaBC7693683E24025f96D7AF656f) ([Sourcify](https://repo.sourcify.dev/4663/0x2A06dafEd9A5CaBC7693683E24025f96D7AF656f)).

Implementation (created by the factory): [`0x77Ef2141D3d79e2D2b9a094D2C6d2aab826D4ccb`](https://robinhoodchain.blockscout.com/address/0x77Ef2141D3d79e2D2b9a094D2C6d2aab826D4ccb) ([Sourcify](https://repo.sourcify.dev/4663/0x77Ef2141D3d79e2D2b9a094D2C6d2aab826D4ccb)). Each treasury vault is an EIP-1167 minimal proxy of this implementation.

Tests: `test/treasury/`.
