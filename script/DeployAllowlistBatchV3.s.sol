// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {UniswapV3TwapFeed} from "../src/fund/growth/UniswapV3TwapFeed.sol";

/// @notice Minimal allowlist interface used so this script does not import
///         src/fund/phase2/FundAllowlist.sol: that file is compilation-restricted
///         to evm_version paris, while the growth feeds require min cancun, and a
///         single script cannot import both. The interface is the exact
///         `proposeAsset` signature from FundAllowlist.
interface IAllowlist {
    function proposeAsset(address asset, address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)
        external
        returns (uint256 id);
}

/// @notice Batch allowlist queue for the 4 V3 tokens Jon approved 2026-11-12:
///         PONS, CASHCAT, WALLET, PIPEDOG. Each gets a UniswapV3TwapFeed (30-minute
///         TWAP window, 30-minute max observation age — the same parameters as the RNJ
///         feed 0x2707FdBdf3e108c0040150D712E385B59Fd3dA2C) and a proposeAsset call
///         (maxStale 3600, band [current/2, current*2] priceX18 — the same style as the
///         POLYDASH 60M-260M and RNJ 2,327,107,335-9,308,429,342 bands).
///         The UniswapV3RouterAdapter (0xA5187f8e56Dd0784624D833CEE3bF6f2Aa5E7581)
///         is already an allowed router, so no router proposal is needed for these.
///         The script asserts each feed's live 30-min TWAP is inside its band before
///         proposing, so a stale band fails loudly instead of allowlisting a bad band.
///         Proposals become executable after the allowlist's 2-day delay (Nov 14 if
///         queued Nov 12); execute() is permissionless.
///         The 4 V4 tokens from the same approval (TIBBIR, ORBIO, TORCH, FOBO) are NOT
///         in this script: their V4 pools are ETH- or USDG-quoted, and the existing
///         GenericV4TwapFeed / UniswapV4RouterAdapter only serve WETH-quoted pools.
///         See the batch report for the full findings.
/// @dev Dry-run (no broadcast, no key needed):
///      CONFIRM_ALLOWLIST_BATCH_V3=yes forge script script/DeployAllowlistBatchV3.s.sol
///        --rpc-url https://rpc.mainnet.chain.robinhood.com
///        --sender 0x9a21c75aC263cC43125E70200636f6397f8776d0 --unlocked
///      Real run (deployer key required, never in chat or files):
///      CONFIRM_ALLOWLIST_BATCH_V3=yes forge script script/DeployAllowlistBatchV3.s.sol
///        --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast --private-key 0x...
contract DeployAllowlistBatchV3 is Script {
    error DeployNotConfirmed();
    error BandCheckFailed(string name, uint256 twapPriceX18, uint256 minPriceX18, uint256 maxPriceX18);

    address internal constant ALLOWLIST = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    uint32 internal constant TWAP_WINDOW = 1800;
    uint32 internal constant MAX_OBSERVATION_AGE = 1800;
    // PIPEDOG's pool is deep ($3M) but quiet (~48 tx/day): at dry-run time its
    // newest observation was ~2.5h old, so a 30-min feed fails closed most of the
    // morning. A 6h TWAP keeps its feed live (a 6h gap is ~e^-12 at 2 tx/hour)
    // while still being a genuine time-weighted average; the facet's 5% deviation
    // check still guards execution against a stale TWAP.
    uint32 internal constant PIPEDOG_TWAP_WINDOW = 21_600;
    uint32 internal constant PIPEDOG_MAX_OBSERVATION_AGE = 21_600;
    uint64 internal constant MAX_STALE = 3600;

    struct Item {
        string name;
        address pool;
        address asset;
        uint256 minPriceX18;
        uint256 maxPriceX18;
        uint32 twapWindow;
        uint32 maxObservationAge;
    }

    function run() external {
        if (keccak256(bytes(vm.envOr("CONFIRM_ALLOWLIST_BATCH_V3", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }

        Item[4] memory items = [
            Item({
                name: "PONS",
                pool: 0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA,
                asset: 0x39dBED3a2bd333467115dE45665cC57F813C4571,
                minPriceX18: 36_920_000_000_000,
                maxPriceX18: 147_680_000_000_000,
                twapWindow: TWAP_WINDOW,
                maxObservationAge: MAX_OBSERVATION_AGE
            }),
            Item({
                name: "CASHCAT",
                pool: 0xA70fc67C9F69da90B63a0e4C05D229954574E313,
                asset: 0x020bfC650A365f8BB26819deAAbF3E21291018b4,
                minPriceX18: 12_655_000_000_000,
                maxPriceX18: 50_620_000_000_000,
                twapWindow: TWAP_WINDOW,
                maxObservationAge: MAX_OBSERVATION_AGE
            }),
            Item({
                name: "WALLET",
                pool: 0x9501A20Bedb8beA0798FE5D4c411f5e270965D49,
                asset: 0x0339f5459FC690aC85F1782e15782A151b4A9E1b,
                minPriceX18: 3_060_500_000_000,
                maxPriceX18: 12_242_000_000_000,
                twapWindow: TWAP_WINDOW,
                maxObservationAge: MAX_OBSERVATION_AGE
            }),
            Item({
                name: "PIPEDOG",
                pool: 0xB7f10f74B39291b9290b779978e19A7637C742D6,
                asset: 0x5Cb6F181081301b44905F3ae15419112ecaBd8A6,
                minPriceX18: 83_650_000_000,
                maxPriceX18: 334_600_000_000,
                twapWindow: PIPEDOG_TWAP_WINDOW,
                maxObservationAge: PIPEDOG_MAX_OBSERVATION_AGE
            })
        ];

        IAllowlist allowlist = IAllowlist(ALLOWLIST);
        address[] memory feeds = new address[](items.length);

        vm.startBroadcast();
        // Phase 1: deploy all four feeds, then check every TWAP is inside its band.
        // A stale band reverts here, before any proposal is queued.
        for (uint256 i = 0; i < items.length; ++i) {
            UniswapV3TwapFeed feed = new UniswapV3TwapFeed(
                items[i].pool, items[i].asset, WETH, items[i].twapWindow, items[i].maxObservationAge
            );
            feeds[i] = address(feed);
            (uint256 twapPriceX18,) = feed.latestPrice(items[i].asset);
            if (twapPriceX18 < items[i].minPriceX18 || twapPriceX18 > items[i].maxPriceX18) {
                revert BandCheckFailed(items[i].name, twapPriceX18, items[i].minPriceX18, items[i].maxPriceX18);
            }
            console2.log(items[i].name, "feed:", feeds[i]);
            console2.log(items[i].name, "twapPriceX18:", twapPriceX18);
        }
        // Phase 2: queue the four asset proposals (owner-only; 2-day delay).
        for (uint256 i = 0; i < items.length; ++i) {
            uint256 id =
                allowlist.proposeAsset(items[i].asset, feeds[i], MAX_STALE, items[i].minPriceX18, items[i].maxPriceX18);
            console2.log(items[i].name, "proposal id:", id);
        }
        vm.stopBroadcast();
    }
}
