# Tokenized funds (Phase 1a)

These contracts are unaudited. An outside review is planned. They are not deployed. Broadcast and Sourcify steps for `FundFactory` are in [Deploy on Robinhood Chain](#deploy-on-robinhood-chain-phase-1b). Not financial advice.

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

`test/fund/Fund.t.sol` and `test/fund/DeployFundFactory.t.sol`.

## Deploy on Robinhood Chain (Phase 1b)

These contracts are unaudited. An outside review is planned. Not financial advice. A Sourcify or Blockscout match is a bytecode check. It is not a review.

Phase 1b broadcasts `FundFactory` only. `createFund` deploys one `FundVault` and one `FundNFT` for each fund. Leave those contracts off this broadcast.

`script/DeployFundFactory.s.sol` reads `PRIVATE_KEY` and `FEE_RECIPIENT`. Both are required for a broadcast. The script has no default recipient, so the deployer sets it on purpose. Leave `DEPLOY_FUND_FACTORY_PK` unset. If that variable is set, the script uses it instead of `PRIVATE_KEY`. The unit test is the only caller that sets it, so the test does not share `PRIVATE_KEY` with the staking deploy test in one Foundry process. If that recipient is the launchpad platform fee wallet already recorded in [`deployments/robinhood-chain.json`](../../deployments/robinhood-chain.json), set `FEE_RECIPIENT` to `0x9a21c75aC263cC43125E70200636f6397f8776d0`. Copy [`.env.example`](../../.env.example) to `.env` on the machine that signs. Do not commit `.env`, a key, or a keystore.

The factory address is not in the manifest until that broadcast lands and the entry below is filled in.

Compiler settings come from [`foundry.toml`](../../foundry.toml): solc 0.8.24, optimizer 200 runs, via-IR, `bytecode_hash = "ipfs"`, and EVM `paris` for `src/fund/**`. Run the commands from the repository root.

### Broadcast

`ROBINHOOD_RPC_URL` can be the public RPC or an Alchemy URL for chain ID 4663. `--rpc-url robinhood` reads that variable.

```bash
export ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
export FEE_RECIPIENT=0x9a21c75aC263cC43125E70200636f6397f8776d0
export PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY_HERE

forge script script/DeployFundFactory.s.sol --rpc-url robinhood --broadcast
```

The script logs the factory address, `owner` (the broadcasting key), and `feeRecipient`.

### Sourcify

```bash
forge verify-contract <addr> src/fund/FundFactory.sol:FundFactory --chain 4663 --verifier sourcify
```

Sourcify compares the on-chain creation code, which includes the fee-recipient constructor argument. If the submission needs that argument called out, add `--guess-constructor-args`, or pass the creation transaction with `--creation-transaction-hash <tx>`.

Blockscout is a secondary check. Its API is Etherscan-shaped, so pass the ABI-encoded constructor argument:

```bash
forge verify-contract <addr> src/fund/FundFactory.sol:FundFactory \
  --chain 4663 \
  --verifier blockscout \
  --verifier-url https://robinhoodchain.blockscout.com/api/ \
  --constructor-args $(cast abi-encode "constructor(address)" "$FEE_RECIPIENT")
```

### Manifest entry after broadcast

Add this object to `contracts` in [`deployments/robinhood-chain.json`](../../deployments/robinhood-chain.json) only after the factory is on chain. Replace the address, Sourcify URL, and verification status with the real result. Then add the same address to the tables in the root README, [`docs/DEPLOYMENTS.md`](../../docs/DEPLOYMENTS.md), [`docs/CREATOR_CONTRACTS.md`](../../docs/CREATOR_CONTRACTS.md), and this file.

```json
{
  "name": "FundFactory",
  "group": "fund",
  "role": "factory",
  "address": "<factory address>",
  "sourcify": "https://sourcify.dev/server/v2/contract/4663/<factory address>",
  "verification": "<match or exact match>",
  "source": "src/fund/",
  "notes": "Phase 1a raise/mint only; unaudited; not deployed until this entry. FundVault and FundNFT are created per fund by createFund.",
  "documentedIn": ["README.md", "docs/DEPLOYMENTS.md", "docs/CREATOR_CONTRACTS.md", "src/fund/README.md"]
}
```
