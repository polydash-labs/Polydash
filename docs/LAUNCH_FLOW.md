# Launch flow

Polypad launches a fixed-supply token on Robinhood Chain (chain ID 4663) through the current factory, [`0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2`](https://robinhoodchain.blockscout.com/address/0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2). `createLaunch` is permissionless: there is no allowlist, no backend signature, and the calling address becomes the creator.

The factory deploys a new ERC-20 and a clone of the launch contract. The token has no owner, mint, pause, blacklist, or transfer tax. The whole supply is minted once to the launch contract. Contract detail is in [`polypad/contracts/docs/ARCHITECTURE.md`](../polypad/contracts/docs/ARCHITECTURE.md).

## Parameters

| Field | Rule |
| --- | --- |
| `name`, `symbol` | Required. The API caps them at 64 and 32 UTF-8 bytes. |
| `imageUri` | Empty, or an `https://` or `ipfs://` URL. |
| `description` | Optional. The API caps it at 2,000 characters. |
| `socialLinks` | At most 10. The API accepts `https://`, `ipfs://`, and the agent mark. |
| `creatorFeeBps` | 0 to 500 on the current factory (0% to 5%). `0` means 0%, not a default. Fixed for the life of the token. |
| `creatorPayoutWallet` | `0x000…000` means the creator. Creator fees only go to this address. |
| `devBuyEth` | Optional buy at launch, in wei. The ETH attached to the transaction must equal it. |
| `totalSupply` | `0` selects 1,000,000,000 tokens (18 decimals). Otherwise 1,000,000 to 1,000,000,000,000 tokens. |
| `virtualEthReserve` | `0` selects 1.5 ETH. Otherwise 0.01 ETH to 1,000 ETH. |
| `launchDelay` | Seconds before trading can open. `0` opens immediately. Maximum 30 days (2,592,000 seconds). |

There is no launch fee. Trades pay a 0.2% platform fee plus the creator fee, both taken in ETH. Anti-sniper settings (a higher buy fee and a per-wallet cap for the opening blocks) are copied from the factory at creation.

## Commitment window

`launchDelay` of zero skips the window and opens the curve in the same transaction.

A non-zero delay puts the launch in a commitment phase until `launchTime`. During that phase, wallets commit ETH and can withdraw the full amount. The website offers three presets: 24 hours, 3 days, and 7 days. The factory itself accepts any delay up to 30 days, which is what the agent API allows.

When `launchTime` is reached, anyone can start the launch. The creator's dev buy runs before commitment fills. Commitments are then bought in batches of up to 200 at curve prices. Later batches are permissionless. A commitment that is still unprocessed can be pulled back by its owner, including after graduation, so a commitment is not stuck in the contract.

An optional commit vault can pool several users into one commitment. After settlement, each depositor claims the same average-price share. The vault has no owner and no fee.

## Trading

Once the curve is open, `buy` and `sell` trade against virtual reserves. Eighty percent of supply is on the curve. Twenty percent is held back for liquidity. Spot price is `ethReserve * 1e18 / tokenReserve`. New reserves round in favour of the pool.

## Graduation

The graduation threshold is copied into the launch at creation. In the source, the factory default is 15 ETH of real ETH raised. The live value is whatever `graduationEthTarget` (or the market-cap mode) was set to before that launch; later factory changes do not move an existing launch. `previewGraduationThreshold` reads the threshold a new launch would get.

The buy that reaches the threshold is capped at the threshold. Unused ETH is returned in that transaction, and graduation runs at the end of it:

1. Liquidity ETH is the real ETH raised plus any anti-sniper surplus.
2. Liquidity tokens are sized at the final curve spot price, so the Uniswap V4 pool opens at that price.
3. Tokens left beyond that position are burned.
4. `PolydashHook` initialises the pool and adds a full-range position that the hook holds.

The hook has no function that removes that position. `beforeInitialize` reverts for everyone else, so a third party cannot create another pool that uses this hook. After graduation, creator and platform fees are still charged in ETH on swaps.

A launch can be watched from `LaunchCreated` and from `allLaunches()` on the factory. The website reads those launches directly.

## Where to prepare a transaction

The website Create page builds the transaction in the connected wallet. An external agent uses [`AGENTS_API.md`](AGENTS_API.md), which returns an unsigned transaction after an `eth_call`. Calling the factory from the operator's own wallet is described in [`AGENTS_LAUNCH.md`](AGENTS_LAUNCH.md).
