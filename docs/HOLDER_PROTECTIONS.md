# Holder Protections

Holder Protections are optional contracts a launch creator can use after `createLaunch`. The factory does not deploy them, and a token without them is still a normal Polypad launch.

They are labels and on-chain constraints. They are not a promise about price, liquidity, or what the creator will do off-chain.

## Vesting label

`CreatorVestingVault` holds one creator allocation on a cliff and a linear schedule. The beneficiary cannot shorten the cliff or the duration. They can only lengthen them. There is no owner and no admin withdraw of the locked allocation.

`meetsBadgeMinimum()` returns true only when both of these hold:

- cliff of at least 30 days (`BADGE_MIN_CLIFF`)
- duration of at least 180 days (`BADGE_MIN_DURATION`)

The contract accepts shorter schedules. The function is a label for interfaces (the comment in source names it for the Holder Protections badge). A vault that returns false is still a vault; it just does not meet that label.

Pool rewards, if the vault stakes into a V2 pool, are not on the vesting schedule. Anyone can call `claimRewards()` and the rewards go to the beneficiary, minus the pool's claim fee.

Deployed factory: [`0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022`](https://robinhoodchain.blockscout.com/address/0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022). Source and tests: [`src/vesting`](../src/vesting).

## Creator bond

`CreatorBond` locks an ETH pot for a fixed period. The launch creator posts it against a floor balance of the token across registered wallets. The floor is `committed * (10_000 - allowanceBps) / 10_000`, and the sell allowance is capped at 20%. The minimum bond is 0.01 ETH and 7 days.

Every non-creator registered wallet has to confirm before the bond is active. If the floor fails before the end, anyone can slash. After a slash, holders outside the registered set can burn tokens to claim a share of the pot fixed at slash time. After the end, the creator can refund only if the floor still holds at that moment. Staking or vesting tokens out of a registered wallet lowers the counted balance.

There is no admin key and no oracle. A bond does not stop the creator from selling tokens that sit outside the registered wallets, and it does not keep a price.

Deployed factory: [`0x876170251e30F99E27119AF0e90648A88D508f97`](https://robinhoodchain.blockscout.com/address/0x876170251e30F99E27119AF0e90648A88D508f97). Source and tests: [`src/bond`](../src/bond).

## What these contracts do not do

They do not review the token, the creator, or any linked repository. They do not block trading on the curve or on the graduated pool. Security-scanned with Bevor. Not a formal audit. Scans are not audits. Not financial advice.
