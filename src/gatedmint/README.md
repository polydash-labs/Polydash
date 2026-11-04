# Token-gated NFT mints

`PolypadGatedNFTFactory` lets the launch creator of a Polypad token deploy a `PolypadGatedCollection` linked to that token.

- Only the token's launch creator can create a collection (`launch.creator()` on either launch factory).
- Gating is optional. A gated collection has a holder phase (lower holder price, holder-only window) followed by a public phase. With `holderDuration = 0` and holder parameters set to zero, it is a plain fixed-price open mint.
- Holder eligibility is a balance check of the gate token at mint time (`minBalance`).
- Per-wallet caps for holder mints and for all mints. Moving gate tokens between wallets does not reset a wallet's counts.
- `holderMint` is restricted to externally owned accounts to block flash-loan borrow-mint-repay. Smart-contract wallets can still use the public phase.
- The existing open Polypad NFT factories are unchanged.

Deployed factory: [`0x64727D49FB9F8E669C0759B9b8e8f1bd6c99325d`](https://robinhoodchain.blockscout.com/address/0x64727D49FB9F8E669C0759B9b8e8f1bd6c99325d) ([Sourcify](https://repo.sourcify.dev/4663/0x64727D49FB9F8E669C0759B9b8e8f1bd6c99325d)).

Tests: `test/gatedmint/`.
