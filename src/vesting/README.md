# Creator vesting

`CreatorVestingFactory` creates one `CreatorVestingVault` per allocation. Tokens move straight from the depositor into the vault and vest linearly with a cliff.

- Ownerless: no admin withdraw, no pause. The beneficiary can only extend the cliff or duration, never shorten them.
- Optional staking: the vault can stake its locked tokens in a `PolydashStakingPoolV2` pool (validated through the V2 factory's `isPool`). Rewards go to the beneficiary immediately; only principal vests.
- Releases, reward claims and re-staking are permissionless calls; funds only ever move to the beneficiary.
- Beneficiary transfer is two-step (`proposeBeneficiary` / `acceptBeneficiary`) and only the current beneficiary can start it.
- Only Polypad-launched tokens are accepted (`isPolypadToken`).
- Views for integrations: `vestedAmount`, `lockedAmount`, `releasable`, `holdings`, `meetsBadgeMinimum`, and on the factory `vaultsByToken`, `vaultsByBeneficiary`, `totalLockedForToken`, `vaultMeetsBadgeMinimum`.

`IPolydashStakingV2.sol` is the minimal interface to the deployed staking V2 contracts (source in [`src/v2/`](../v2)).

Deployed factory: [`0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022`](https://robinhoodchain.blockscout.com/address/0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022) ([Sourcify](https://repo.sourcify.dev/4663/0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022)).

Tests: `test/vesting/` (the unit tests run against the real staking V2 source in `src/v2/`).
