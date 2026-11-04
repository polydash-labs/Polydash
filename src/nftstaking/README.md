# NFT staking

These contracts are unaudited. An outside review is planned.

`NftStakingFactory` deploys one `NftStakingPool` per collection and reward token. Stakers deposit ERC-721 tokens and earn an ERC-20 reward streamed over a fixed window.

- Fixed window `[start, end)`. `fund()` can only raise the reward rate over the remaining window; it cannot extend the window or dilute existing stakers.
- Fee-on-transfer aware: funding credits the amount actually received.
- Optional boosts via `createBoostedPool`: loyalty tiers by continuous stake time and a set bonus for wallets holding a minimum number of staked NFTs. Caps: 3.0x tier multiplier, +50% set bonus, at most 4 tiers.
- Deployed unrestricted: any contract reporting ERC-721 support through ERC-165 can get a pool. Each pool only holds its own collection and reward token, so a hostile collection is contained to its own pool.
- `emergencyWithdraw` makes no reward-token calls, so a broken reward token cannot trap NFTs.
- Unallocated rewards (zero-staker periods, rounding dust, forfeited emergency rewards) are recoverable by the pool creator after the end, never rewards owed to stakers.

Deployed factory: [`0x827b9BB6a176D13Ea7E05b8e5891c8040cb822B1`](https://robinhoodchain.blockscout.com/address/0x827b9BB6a176D13Ea7E05b8e5891c8040cb822B1) ([Sourcify](https://repo.sourcify.dev/4663/0x827b9BB6a176D13Ea7E05b8e5891c8040cb822B1)).

Tests: `test/nftstaking/`.
