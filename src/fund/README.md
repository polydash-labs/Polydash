# Tokenized funds (Phase 1a)

These contracts are unaudited. An outside review is planned. They are not deployed.

Phase 1a is the raise. A manager creates a fund the way a creator creates an NFT collection, as an alternative to launching a token. Buyers mint ERC-721 units at a fixed ETH price. Each NFT is one equal unit. A wallet's share of what has been minted is `balanceOf(wallet) / totalMinted`.

`FundFactory` deploys one `FundVault` and one `FundNFT` per fund with `new`. That is the same style as the staking, vesting, bond, and NFT staking factories. There is no proxy and no upgrade path.

## What a manager sets

- Name (1–64 bytes) and symbol (1–16 bytes).
- Image URI and base URI (each at most 512 bytes). The base URI can be changed until the first mint, then it is fixed. `tokenURI` is `baseURI + id + ".json"`, or the image URI when the base URI is empty.
- `mintPrice` in wei, from 0.00001 ETH to 100 ETH. Buyers pay exactly `qty * mintPrice`.
- `raiseCap` in wei. `maxSupply = raiseCap / mintPrice`, rounded down, and it must be from 1 to 10,000. `raiseCap % mintPrice` wei cannot mint another NFT. `previewSupply` returns that remainder. When `maxSupply` is minted, recorded raised ETH is `maxSupply * mintPrice`, which is less than or equal to `raiseCap`.
- `entryFeeBps`, optional, 0 to 500 (0% to 5%). This is the manager's fee on mint ETH, the same cap as the launchpad creator fee.
- `minSkinBps`, optional. `0` selects the default of 500 (5%). Any other value must be from 500 to 10,000. The required unit count is `ceil(maxSupply * minSkinBps / 10_000)`.

## Raise

ETH paid to mint is forwarded to the vault in the same transaction. It is not sent to the manager's wallet.

`raised` on the vault is the gross ETH from mints. The protocol fee and the entry fee are floored independently out of that gross amount (same rounding as the launchpad fee split). The remainder is `principal`.

The protocol fee is 0.2% (`PROTOCOL_FEE_BPS = 20`), the same hard-coded platform fee as the launchpad. There is no setter. It is paid to `feeRecipient` on the factory when anyone calls `withdrawProtocolFee`. The factory owner can point `feeRecipient` at a new address. That does not move principal, and it does not change the rate.

The manager can pull accrued entry fees to the payout wallet (`withdrawEntryFee`). The payout wallet starts as the manager and can be changed by the manager. That pull does not send principal.

The manager must mint at least `skinRequired` units, paying `mintPrice` like anyone else, before another wallet can mint. After that, `publicOpen` is true. The manager's later transfers do not close public minting again: the requirement is to mint, not to keep holding.

Minting stops when the vault is `RaisingClosed`. That happens when gross raised ETH is at least `raiseCap`, or when `maxSupply` NFTs have been minted. Phase 1a has no further status. There is no function that withdraws principal to an externally owned account, and no function that invests it.

`navPerNft()` is `address(vault).balance / totalSupply()`. It counts ETH only. Integer division leaves a remainder in the vault. It is not a market price. `ownershipBps(account)` is `balanceOf(account) * 10_000 / totalMinted`, also floored.

Direct ETH transfers to the vault revert. ETH forced into the vault stays there, increases `navPerNft`, and cannot be pulled by the fee functions.

## Not in this phase

Allowlist swaps, stock tokens, a carry NFT, token-bound accounts, a floor bid, a secondary market, redeeming units, metadata that changes after mint, and an agent executor. Those are not implemented here.

## Tests

`test/fund/Fund.t.sol`.
