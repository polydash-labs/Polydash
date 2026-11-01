# Creator bond

`CreatorBondFactory` lets the launch creator of a Polypad token post an ETH bond for a fixed period, committing that a set of registered wallets keeps at least a floor balance of the token.

- Only tokens launched through the Polypad launch factories are accepted (`launchOfToken` lookup on either factory), and only the launch creator can open a bond.
- Lifecycle: `Pending` (every non-creator registered wallet calls `confirmWallet`) -> `Active` -> `Refunded` or `Slashed`. The creator can `cancel()` while pending.
- The condition is balance-based: the aggregate balance of registered wallets must stay at or above `floor = committed * (10_000 - allowanceBps) / 10_000`. Tokens sent into registered wallets only raise the sum, so outsiders cannot grief a bond.
- While the condition fails before `endTime`, anyone can call `slash()` (`canSlash()` is the view for keepers). After a slash, non-registered holders can burn tokens through `redeem()` at a rate fixed at slash time (`pot / totalSupply`), so total claims can never exceed the pot.
- After `endTime` the creator can `refund()` only if the floor still holds at that moment.
- Contract limits: minimum 0.01 ETH and 7 days; sell allowance capped at 20% (`MAX_ALLOWANCE_BPS`). No admin, no oracle, nothing upgradeable.
- Staking or vesting committed tokens lowers the registered wallet balance and counts as a move.

`IPolydashLaunchInfo.sol` holds the minimal launch-factory interfaces shared by the bond, vesting, gated-mint and treasury modules.

Deployed factory: [`0x876170251e30F99E27119AF0e90648A88D508f97`](https://robinhoodchain.blockscout.com/address/0x876170251e30F99E27119AF0e90648A88D508f97) ([Sourcify](https://repo.sourcify.dev/4663/0x876170251e30F99E27119AF0e90648A88D508f97)).

Tests: `test/bond/`.
