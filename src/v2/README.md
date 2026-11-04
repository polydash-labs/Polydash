# Staking V2 source (deployed)

These contracts are unaudited. An outside review is planned. Sourcify verification is not a review.

This directory mirrors the verified source of the deployed Polydash staking V2 contracts on
Robinhood Chain (chain ID 4663). The two `.sol` files are byte-for-byte identical to the
verified source. No header comments or import changes were needed: the verified sources
import `@openzeppelin/contracts/...`, which resolves through this repo's existing remapping to
`lib/openzeppelin-contracts` (v5.0.2). The six OpenZeppelin files in the verified bundle are
byte-identical to that library version.

| Contract | Address | Verification |
| --- | --- | --- |
| `PolydashStakingFactoryV2` | [`0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0`](https://robinhoodchain.blockscout.com/address/0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0?tab=contract) | Sourcify exact match (creation and runtime), verified 2026-10-28 15:45:59 UTC. [Sourcify](https://repo.sourcify.dev/4663/0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0) |
| `PolydashStakingPoolV2` | Deployed by the factory with `new` (one contract per pool, not proxies), e.g. [`0xB2BBc1752FAa5BCfC67571819af30CE2AaF58518`](https://robinhoodchain.blockscout.com/address/0xB2BBc1752FAa5BCfC67571819af30CE2AaF58518), [`0x0F50043E172B8652bb786C4F14f30c415E5760AB`](https://robinhoodchain.blockscout.com/address/0x0F50043E172B8652bb786C4F14f30c415E5760AB) | Source included in the factory verification. Pools are not individually verified on the explorer; their runtime bytecode matches this source (see below). |

Factory deployment: block 83248798, tx [`0x72f9c126...0c42c`](https://robinhoodchain.blockscout.com/tx/0x72f9c126ac1d900233a6863eb67b89a016fa59121662d7872706ab0d8ef0c42c), deployer `0x351BDe628892Aeb055F717300DBd2848af178479`.

## Compiler settings (from the verification metadata)

| Setting | Value |
| --- | --- |
| Compiler | `solc 0.8.24+commit.e11b9ed9` |
| Optimizer | enabled, 200 runs |
| via-IR | `true` |
| EVM version | `paris` |
| Remappings | `@openzeppelin/contracts/=oz/` (OpenZeppelin v5.0.2 files) |

These are identical to `[profile.default]` in `foundry.toml`, so no separate profile is needed.

## Bytecode check

```sh
forge build
python3 script/v2/compare_bytecode.py            # uses https://rpc.mainnet.chain.robinhood.com
```

The script compares the locally compiled runtime bytecode with `eth_getCode` for the factory
and two pools, masking only immutable values and the CBOR metadata blobs (the metadata hash
differs because the source path changed from `PolydashStakingFactoryV2.sol` to `src/v2/...`).
Result on 2026-10-29: all three match, with equal code length (factory 16,031 bytes, pools
8,911 bytes).

## Reward accounting

`PolydashStakingPoolV2` keeps rewards in units scaled by `1e36`:

- `rewardRate` is reward tokens per second scaled by `1e18`; the truncation dust from that
  division is booked to `unallocatedScaled` at funding time.
- Each update accrues `elapsed * rewardRate * 1e18` (reward x `1e36`). This is divided by
  `totalStaked` into `rewardPerTokenStored`; the division remainder is stored in
  `rewardRemainder` and added to the next update instead of being discarded.
- When `totalStaked` changes (stake, withdraw, emergency withdraw, recovery) the carried
  remainder is moved to `unallocatedScaled`, which the creator can recover after the end.
- Per-user balances (`rewardsScaled`) stay in `1e36` units; a claim pays whole token units and
  keeps the fractional part with the user.

See `test/v2/PrecisionV2.t.sol`: a 6-decimal reward token streamed to a 1e27-unit 18-decimal
stake supply with hourly claims pays the full reward in V2, while the legacy v1 pool pays zero
under the same conditions.
