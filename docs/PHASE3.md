# Phase 3

Phase 3 is a new factory. It does not modify the live Phase 1a factory or the live Phase 2 factory, facet, allowlist, or router adapter. No Phase 3 contract is deployed. This note is not a review. Not financial advice.

A fund is created from a `StrategyTemplate`. Publishing a template does not have an edit function. The fund copies the mandate hash, mandate URI, asset list, position cap, trade cap, deviation cap, high-water-mark fee, drawdown brake, and skin-lock duration. The manager does not pass different values.

`FundVaultPhase3` delegatecalls `FundSwapFacetPhase3`. It does not delegatecall the live Phase 2 facet. Spendable ETH excludes entry fees, the 20 bps protocol fee, the performance fee, and ETH reserved for a distribution. `harvest` accrues a fee on the gain in net value per share above the high-water mark and leaves it in the vault for the manager to pull. A buy of a mandate asset reverts when the drop from the peak reaches `maxDrawdownBps`. Zero disables that brake. Sells and ETH/WETH wraps stay open. `distribute` sets aside spendable ETH, one share per outstanding NFT. Holders pull it. An exit pays any unclaimed round for the burned ids first.

The manager's skin token ids cannot be transferred until the lock ends. A burn for exit or refund is still allowed.

`NavTape` records net value, the high-water mark, and the drawdown. `Trade` is still the blotter event.

The site page is `/funds/phase3`. The funds layout still renders the not-live page unless `FUND_ROUTES_ENABLED` is exactly `enabled`. The header does not link to it.

Unsigned creation payloads, compiler settings, deploy order, and gas measured on a fork of the live Phase 2 allowlist are in [deploy/phase3/unsigned](../deploy/phase3/unsigned). Nonces are not recorded. Read the signer's nonce immediately before signing. Do not reuse one from this note.
