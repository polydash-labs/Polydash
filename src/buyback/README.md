# POLYDASH buybacks

Two contracts that turn the buyback share of Polypad launch fees into POLYDASH burns and staker rewards.

- `PolydashBuybackVault` receives ETH from the launch factories' buyback hook (`buyback()`), from labelled manual top-ups (`topUp()`) and from plain transfers, and buys POLYDASH on its Uniswap V4 POLYDASH/WETH pool.
- `PolydashRewardsPool` is an ongoing single-sided POLYDASH staking pool that accepts reward top-ups and is the vault's initial rewards target.

Intended configuration: the launch factories send 40% of collected platform fees to the vault (`setBuybackConfig(true, 4000, vault)`). Of each buy, 62.5% is sent to `0x...dEaD` in the same transaction and 37.5% is held for stakers, so 25% of fees go to burns and 15% to stakers.

## PolydashBuybackVault

**Buy flow.** Anyone calls `observePrice()`, then `buy()` 5 to 60 minutes later. A buy runs only if spot is within 2% of the observed price, spends at most `maxBuyEth` (0.02 ETH), waits 10 minutes between buys and enforces a minimum output from the observed price net of the pool fee (read from the hook, capped at `maxPoolFeeBps`) and `maxSlippageBps`. The swap output is split with two `take` calls: burn share to `0x...dEaD`, the rest to the vault.

**Stakers' share.** Held POLYDASH can leave only via `notifyRewardAmount` on the rewards target (`releaseToTarget()`, anyone), or, after 30 days without an active target, to `0x...dEaD` (`burnHeldStaking()`, anyone). A valid target has code, is the initial target or registered in the Polydash staking factory V2, has POLYDASH as stake and reward token, returns `acceptsRewardTopUps() == true` and has at least one day left. Release checks that the allowance returns to zero.

**Target changes.** Only `targetAdmin` (the Polydash fee wallet) can `proposeTarget`, `cancelTarget` and, after a public 48-hour timelock, `executeTarget`. It cannot move ETH or POLYDASH anywhere else.

**Accounting.** `Received(source, from, amount)` with `Source` 0 = Factory, 1 = Manual, 2 = Direct, 3 = OtherBuybackCall; `receive()` fits the 2,300 gas stipend. `BoughtAndBurned`, `RewardsReleased`, `HeldStakingBurned` and target events make every step indexable.

| Parameter | Deployed value |
| --- | --- |
| `maxBuyEth` | 0.02 ETH |
| `maxSlippageBps` | 300 |
| `maxPoolFeeBps` | 200 (pool reads 120) |
| `burnShareBps` | 6,250 |
| `targetAdmin` | `0x9a21c75aC263cC43125E70200636f6397f8776d0` |
| `stakingFactory` | `0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0` |
| `initialTarget` | `PolydashRewardsPool` below |
| Pool | POLYDASH/WETH, poolId `0xc37d1893...74b5`, hook `0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc` |

No owner, no admin beyond the target timelock, no withdraw; all parameters are immutable.

## PolydashRewardsPool

Stake POLYDASH, earn POLYDASH (Synthetix-style `rewardPerToken`). Anyone can add rewards with `notifyRewardAmount`; each top-up is added to what is still unstreamed and the total is re-streamed over 30 days. Rewards that would accrue while nobody is staked, and rate rounding dust, are carried (`carryScaled`) into the next stream. Principal (`totalStaked`) and rewards (`rewardReserve`) are tracked separately. A top-up below 1% of what is still streaming (`MIN_RESTREAM_BPS`) is carried instead of restarting the clock, so dust top-ups cannot stretch the stream. Direct transfers are ignored until someone calls `syncDonations()`. No owner, no lock, no fee; unstake any time. `endTime()` returns `type(uint256).max`.

## Trust assumptions

- The fee wallet controls the launch factories' buyback setting (no timelock on the factory side) and the vault's rewards target (48-hour timelock).
- The Uniswap V4 PoolManager and the POLYDASH pool hook behave as deployed; a hook fee above `maxPoolFeeBps` is treated as the cap.
- NFT and staking fees have no on-chain split; their 40% share is sent manually to `topUp()`. Fees routed to project treasuries on the site are a front-end flow with no contract.

## Known limits

- Buys need two transactions from a caller who pays gas and receives nothing.
- The POLYDASH pool is thin; buys are capped at 0.02 ETH and can still fill partially.
- The 2% band and the observation delay reduce, but do not remove, exposure to price manipulation.
- Rewards vary with fees and can be zero; the pool makes no promise of any return.
- Existing V2 staking pools are funded once and cannot be targets.

## Static analysis

Slither (both contracts, lib and test filtered): 42 results, 0 high, 19 medium, 21 low, 2 informational. Medium triage:
- `incorrect-equality` (14): `== 0` guards for "nothing to do".
- `divide-before-multiply` (3, pool): intentional; remainders go to `carryScaled` (invariant: owed rewards never exceed the reserve).
- `reentrancy-no-eth` (2, pool `stake`, `notifyRewardAmount`): both `nonReentrant`, fixed token, balance-delta accounting.

## Deployment (Robinhood Chain, 4663)

| Contract | Address | Block | Verification |
| --- | --- | --- | --- |
| `PolydashRewardsPool` | [`0x608d106Bb58A804fcd45823e0C6087801dee2aCa`](https://robinhoodchain.blockscout.com/address/0x608d106Bb58A804fcd45823e0C6087801dee2aCa) | 103888328 | [Sourcify match](https://repo.sourcify.dev/4663/0x608d106Bb58A804fcd45823e0C6087801dee2aCa) |
| `PolydashBuybackVault` | [`0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193`](https://robinhoodchain.blockscout.com/address/0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193) | 103888442 | [Sourcify match](https://repo.sourcify.dev/4663/0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193) |

Compiler: solc 0.8.26, via-IR, optimizer 200, EVM `cancun`, Uniswap v4-core v4.0.0.

## Tests

`test/buyback/` (70: vault unit and fuzz, rewards pool unit and fuzz, vault invariants, pool solvency invariants) and `test/fork/BuybackFork.t.sol` (2, against the deployed contracts; needs `FORK_RPC`).
