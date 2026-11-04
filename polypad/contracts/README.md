# Polydash Launchpad

Token launchpad for **Robinhood Chain** (chain id `4663`).
Tokens trade on a constant-product bonding curve, then graduate in one transaction into a Uniswap V4 pool. The Polydash hook holds that liquidity and has no function that removes it. Creators set a fee (0–5% on the current factory) on trades before and after graduation. The fee is paid to the creator payout wallet.

> **Status.** These contracts are unaudited. An outside review is planned. Live Polypad addresses on Robinhood Chain are listed in [`../README.md`](../README.md) and [`../../deployments/robinhood-chain.json`](../../deployments/robinhood-chain.json). `script/Deploy.s.sol` still refuses chain ID 4663 unless `MAINNET` and `I_HAVE_WRITTEN_APPROVAL_AND_AUDIT` are set. That is a script guard, not a completed review.

## Quick start

Requirements: [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`, `anvil`).

```bash
git submodule update --init --recursive
forge build
forge test
```

### 1. Deploy on Arbitrum Sepolia (421614)

```bash
export ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
export PLATFORM_FEE_WALLET=0xYourFeeWallet
export FINAL_OWNER=0xYourMultisig          # optional: 2-step ownership transfer is started
forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast --private-key $PK
```

Deploys the `PolydashLaunch` implementation, `PolydashFactory`, and `PolydashHook` (CREATE2 address mined so its
low bits encode the V4 hook permissions), then calls `factory.setHook(hook)`. Set `BUYBACK_WETH` +
`BUYBACK_V3_POOL` to also deploy the (disabled) `BuybackRouter`.

### 2. Create a launch

```bash
FACTORY=0x... TOKEN_NAME="My Token" TOKEN_SYMBOL=MYT CREATOR_FEE_BPS=100 DEV_BUY_WEI=10000000000000000 \
forge script script/CreateLaunch.s.sol --rpc-url arbitrum_sepolia --broadcast --private-key $PK
```

Optional: `TOKEN_IMAGE`, `TOKEN_DESCRIPTION`, `PAYOUT_WALLET`, `LAUNCH_DELAY` (seconds of pre-launch commitments),
`SOCIAL_X`, `SOCIAL_TELEGRAM`, `SOCIAL_WEBSITE`.

### 3. Buy / sell / graduate

```bash
# SALE_ADDR = the launch clone address for your token (from the factory)
# buy with 0.1 ETH (minTokensOut = 0 for the demo; use a real quote from quoteBuy() in production)
cast send $SALE_ADDR "buy(uint256)" 0 --value 0.1ether --rpc-url arbitrum_sepolia --private-key $PK

# sell: approve then sell
cast send $TOKEN "approve(address,uint256)" $SALE_ADDR $AMOUNT --rpc-url arbitrum_sepolia --private-key $PK
cast send $SALE_ADDR "sell(uint256,uint256)" $AMOUNT 0 --rpc-url arbitrum_sepolia --private-key $PK

# graduation happens automatically inside the buy that reaches the threshold (default 15 ETH raised)
cast call $SALE_ADDR "graduated()(bool)" --rpc-url arbitrum_sepolia

# creator fees (anyone can trigger; always paid to the payout wallet)
cast send $SALE_ADDR "claimCreatorFees()" --rpc-url arbitrum_sepolia --private-key $PK
```

## Architecture summary

| Contract | Purpose |
|---|---|
| `PolydashFactory` | Creates launches (EIP-1167 clones + new token), global config for future launches, routes platform fees. Ownable2Step. |
| `PolydashLaunch` | Per-token bonding curve: commitments → dev buy → trading → atomic graduation. |
| `PolydashToken` | Fixed-supply ERC-20, no owner/mint/pause/tax. |
| `PolydashHook` | Uniswap V4 hook: creates the pool, owns the LP forever, charges fees in ETH on every swap. |
| `PolydashCommitVault` | Pooled pre-launch commitments: deposit/withdraw while Pending, then everyone settles at the same average price and claims tokens + refunds pro-rata. No owner, no fee, no admin functions. |
| `BuybackRouter` | Optional: platform-fee share → $POLYDASH (V3, TWAP-protected) → Trading Rewards pool. Off by default. |

Key numbers: 1B default supply, 80% on the curve / 20% LP reserve, 1.5 ETH virtual reserve, graduation at 15 ETH raised
(or a market-cap target), **platform fee 0.2% hard-coded**, creator fee 0–5% fixed per launch.

### Fee flow

```
 Trader ──ETH──► PolydashLaunch (curve)              Trader ──ETH──► Uniswap V4 pool ──► PolydashHook
                 │ 0.20% platform                                                      │ 0.20% platform
                 │ 0–5%  creator                                                       │ 0–5%  creator
                 │ anti-sniper surplus ──► locked LP at graduation                     │ sell spike (opt.) ──► locked LP
                 │                                                                     │
   creator ◄─────┤ claimCreatorFees() ─────────────────────── creator ◄────────────────┤ (same claim call)
                 │                                                                     │
                 └─ platform ──► PolydashFactory.collectPlatformFees() ◄───────────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     ▼ (100 − b)%                  ▼ b% (optional, default 0)
              platform fee wallet          BuybackRouter ─► $POLYDASH ─► Trading Rewards pool
```

Docs:
* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — design, curve math, V4 graduation, V3 trade-offs, future work
* [`docs/CREATOR_FEE_SAFETY.md`](docs/CREATOR_FEE_SAFETY.md) — how creator fees are paid, including why a claim cannot drain the payout wallet
* [`docs/OWNER_CAPABILITIES.md`](docs/OWNER_CAPABILITIES.md) — exactly what the owner can and cannot do
* [`SLITHER_REPORT.md`](SLITHER_REPORT.md) — static-analysis findings, all triaged
* [`abis/`](abis) — ABIs generated with `forge inspect <Contract> abi --json`

## Addresses

### Arbitrum Sepolia (421614)

| Contract | Address |
|---|---|
| PolydashFactory | TBD — run `Deploy.s.sol` on Arbitrum Sepolia |
| PolydashLaunch (impl) | TBD — run `Deploy.s.sol` on Arbitrum Sepolia |
| PolydashHook | TBD — run `Deploy.s.sol` on Arbitrum Sepolia |
| BuybackRouter | TBD (optional) |
| Uniswap V4 PoolManager | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` |

### Robinhood Chain (4663)

Polypad is deployed on Robinhood Chain. Contract addresses for the current and earlier sets are in [`../README.md`](../README.md) and [`../../deployments/robinhood-chain.json`](../../deployments/robinhood-chain.json). The addresses below are dependencies recorded with this package, not a claim that this script folder is what deployed them.

| | Address |
|---|---|
| Uniswap V4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Uniswap V4 PositionManager | `0x58daec3116aae6D93017bAAea7749052E8a04fA7` |
| POLYDASH token | `0x319525528f42167eF7fC18b77b889958080568e4` |
| Staking V2 factory | `0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0` |

## Tests, coverage & gas

```bash
forge test                                  # 136 tests: unit, fuzz (1,000 runs), invariant (128 runs × depth 64)
FORK_TESTS=true forge test --match-path "test/fork/*"   # Robinhood mainnet fork: real V4 PoolManager, nothing broadcast
slither .                                   # 0 findings (see SLITHER_REPORT.md)
forge coverage --ir-minimum --no-match-coverage "test|script"
forge test --gas-report
```

* **136 / 136 tests passing** (12 suites: BondingCurve, Fees, CreatorFee, Commitments, CommitVault, AntiSniper,
  Graduation, Reentrancy, BondingCurveFuzz, FeeFuzz, LaunchInvariant — 8 invariants, plus the opt-in Robinhood fork test).
* **Coverage (src/):** 98.66% lines · 95.06% statements · 75.58% branches · 98.97% functions.
  Uncovered branches are mostly defensive error paths and V4 callbacks that always revert.

| Gas (from `forge test --gas-report`) | Avg | Max |
|---|---|---|
| `createLaunch` (clone + token + init) | 1,126,783 | 2,099,715 |
| `buy` | 180,354 | 793,053 (buy that graduates into V4) |
| `sell` | 73,952 | 104,545 |
| `claimCreatorFees` | 19,900 | 82,691 |
| `commit` | 87,133 | 137,675 |
| `collectPlatformFees` (factory) | 63,194 | 320,404 |

Local rehearsal: `Deploy.s.sol` + `CreateLaunch.s.sol` were run end-to-end on a local anvil node (chain id set to
421614, `POOL_MANAGER` pointed at a locally deployed, unmodified Uniswap v4-core `PoolManager`); two launches were
created and graduated. Nothing has been broadcast to the public Arbitrum Sepolia network yet.

## Review status

The contracts are unaudited. An outside review is planned. Do not describe them as audited, safe, or guaranteed.

The deploy script still refuses Robinhood Chain unless `MAINNET=true` and `I_HAVE_WRITTEN_APPROVAL_AND_AUDIT=true`. Setting those variables does not mean a review happened. The live deployment is the one linked above. Arbitrum Sepolia addresses in this file are still unset.

## License

MIT
