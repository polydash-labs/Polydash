# Token-backed NFT collections (floor vault)

These contracts are unaudited. An outside review is planned. Sourcify verification is not a review.

`PolypadTokenFloorFactory` lets the creator of a Polypad launch token deploy a fixed-price ERC-721 collection linked to that token. Each collection is an EIP-1167 clone of one `PolypadTokenFloorCollection` implementation, created in the factory constructor.

## Design

- **Mint split.** On each mint, `floorBps` of the price goes to the collection's vault and 0.2% (`PLATFORM_FEE_BPS = 20`) accrues to the platform; the rest accrues to the creator. Both balances are pull-based: `withdrawCreator()` pays the creator's payout wallet and `withdrawPlatform()` pays the Polypad fee wallet, read live from the Polypad NFT factory.
- **Two assets.** Of the vault share, `tokenShareBps` is queued as ETH (`pendingEth`) to buy the linked token; the remainder stays in ETH.
- **Capped, anyone-run buys.** Once the launch has graduated to its Uniswap V4 pool, anyone can run `observePrice()` and then `buyToken()` between `OBS_DELAY` (5 min) and `OBS_MAX_AGE` (1 h) later. A buy runs only if spot is within `MAX_DEVIATION_BPS` (2%) of the observed price, spends at most `maxBuyEth`, waits `BUY_COOLDOWN` (10 min) between buys, and enforces a minimum output from the observed price net of the hook fee (capped at `MAX_HOOK_FEE_BPS`) and `maxSlippageBps`.
- **Redeem.** Burning NFTs pays the holder a pro-rata share of the vault's ETH (including queued ETH) and of the tokens it holds. Token transfers that fail are recorded as owed and claimable later (`claimOwedToken`), so a blocking token cannot trap ETH.
- **No graduation.** If the launch has not graduated within `GRADUATION_WINDOW` (180 days), anyone can call `endTokenShare()` and the queued ETH stays in the ETH bucket.
- **No owner.** The creator can change the payout wallet and base URI only; the creator cannot withdraw vault funds.

## Parameters (checked in `createCollection`)

| Parameter | Range |
| --- | --- |
| `maxSupply` | 1 - 10,000 |
| `price` | 0.00001 - 100 ETH |
| `floorBps` (vault share of price) | 2,000 - 8,000 |
| `tokenShareBps` (token share of the vault share) | 1,000 - 5,000 |
| `maxSlippageBps` | 100 - 1,000 |
| `maxBuyEth` | 0.001 - 10 ETH |
| `royaltyBps` (ERC-2981) | 0 - 1,000 |
| `maxPerWallet` | 1 - 100, and at most `maxSupply` |
| `startTime` | now (0) or up to 30 days ahead |

Only the creator of a token launched through the current or earlier Polypad launch factory can create a collection for it.

## Trust assumptions

- The linked launch, its hook and the Uniswap V4 PoolManager behave as deployed; the hook fee is read on-chain and capped.
- The platform fee wallet is read from the Polypad NFT factory at withdrawal time.
- Buy limits bound execution cost, not market outcome.

## Known limits

- The redeem value is a share of what the vault holds. The token part moves with the market and can go to zero; there is no minimum redeem value.
- Buys depend on keepers or users calling two transactions; thin pools can fill partially (the unfilled ETH stays queued).
- Spot-vs-observation checks reduce, but do not remove, exposure to price manipulation within the 2% band.
- The implementation's NatSpec title still reads "DRAFT - not deployed, not audited"; it is left unchanged so the source stays identical to the verified deployment.

## Static analysis

Slither 0.11.6 (src only): 19 results, no high severity. Triage:
- `arbitrary-send-eth` (`_sendEth`): destinations are `msg.sender` (redeem), the creator's payout wallet and the platform fee wallet. Intended.
- `divide-before-multiply` (mint): at most 1 wei of rounding, which stays in the ETH bucket; covered by conservation fuzz tests.
- `reentrancy-*`: every state-changing collection function is `nonReentrant`; `buyToken` books state after `unlock()` because the fill is unknown before the swap. Reentry through token and ETH paths is tested.
- `incorrect-equality`, `unused-return` (`settle`, `getSlot0`), `timestamp`, `low-level-calls`, `missing-zero-check` (`launchFactoryB` may be zero): by design.

## Deployment (Robinhood Chain, 4663)

| Contract | Address | Verification |
| --- | --- | --- |
| `PolypadTokenFloorFactory` | [`0xdD149A1a76363BaAaFEF97c3E8d8cfdD2E7A277c`](https://robinhoodchain.blockscout.com/address/0xdD149A1a76363BaAaFEF97c3E8d8cfdD2E7A277c) | [Sourcify match](https://repo.sourcify.dev/4663/0xdD149A1a76363BaAaFEF97c3E8d8cfdD2E7A277c) |
| `PolypadTokenFloorCollection` (implementation) | [`0xFa23E496f7244d1674fA8bE5C42556bd054140EA`](https://robinhoodchain.blockscout.com/address/0xFa23E496f7244d1674fA8bE5C42556bd054140EA) | [Sourcify match](https://repo.sourcify.dev/4663/0xFa23E496f7244d1674fA8bE5C42556bd054140EA) |

Compiler: solc 0.8.26, via-IR, optimizer 200, EVM `cancun`, Uniswap v4-core v4.0.0.

## Tests

`test/floorvault/` (115: unit, fuzz, hardening, events, invariant) and `test/fork/FloorVaultFork.t.sol` (3, against the deployed factory; needs `FORK_RPC`).
