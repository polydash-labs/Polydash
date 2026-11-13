// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {GenericV4TwapFeed} from "../src/fund/growth/GenericV4TwapFeed.sol";
import {GenericV4RouterAdapter} from "../src/fund/growth/GenericV4RouterAdapter.sol";
import {UniswapV3TwapFeed} from "../src/fund/growth/UniswapV3TwapFeed.sol";
import {TwapPriceMath} from "../src/fund/growth/TwapPriceMath.sol";

/// @notice Minimal allowlist interface used so this script does not import
///         src/fund/phase2/FundAllowlist.sol: that file is compilation-restricted
///         to evm_version paris, while the growth feeds require min cancun, and a
///         single script cannot import both. The interface is the exact
///         `proposeAsset` / `propose` signatures from FundAllowlist.
interface IAllowlist {
    function proposeAsset(address asset, address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)
        external
        returns (uint256 id);
    function propose(address target, bool isRouter, bool allowed) external returns (uint256 id);
}

/// @notice Deploy the GENERAL V4 fix and queue the four blocked tokens for the
///         allowlist: TIBBIR, TORCH, FOBO (ETH-quoted V4 pools) and ORBIO
///         (USDG-quoted V4 pool). One generic adapter + one generic feed per token
///         (the same contracts, new constructor args — no per-token contracts).
///         Also deploys the USDG/WETH V3 reference feed the ORBIO feed converts
///         through, so ORBIO's price stays WETH-denominated.
///         HOOKR is NOT in this script: it is the generality-proof token (proven
///         on a mainnet fork to need only a feed deploy + a proposeAsset call),
///         not a Jon-approved mainnet allowlisting. Onboarding it later is just a
///         feed deploy + proposeAsset — no new contracts.
///         V4 feeds self-observe via poke(): this script pokes each new feed once
///         to seed its first observation. The buyback keeper must then poke all
///         five new feeds every 15 minutes (see the report) so each feed has a full
///         30-minute TWAP window by the time the 2-day timelock expires; until the
///         window fills, latestPrice reverts (fail closed) and no trade can use the
///         feed. The band check below reads the pool's CURRENT spot tick (the feed
///         has no TWAP yet at deploy time) and fails loudly if the spot price is
///         outside the band — the same fail-loud intent as the V3 batch script's
///         TWAP check, adapted to a feed that starts empty.
///         Proposals become executable after the allowlist's 2-day delay; execute()
///         is permissionless.
/// @dev Dry-run (no broadcast, no key needed):
///      CONFIRM_GENERIC_V4_DEPLOY=yes forge script script/DeployGenericV4.s.sol
///        --rpc-url https://rpc.mainnet.chain.robinhood.com
///        --sender 0x9a21c75aC263cC43125E70200636f6397f8776d0 --unlocked
///      Real run (deployer key required, never in chat or files):
///      CONFIRM_GENERIC_V4_DEPLOY=yes forge script script/DeployGenericV4.s.sol
///        --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast --private-key 0x...
contract DeployGenericV4 is Script {
    using PoolIdLibrary for PoolKey;

    error DeployNotConfirmed();
    error BandCheckFailed(string name, uint256 spotPriceX18, uint256 minPriceX18, uint256 maxPriceX18);

    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant ALLOWLIST = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    // USDG/WETH V3 pool, fee 100 — deepest USDG/WETH reference.
    address internal constant USDG_WETH_V3_POOL = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;

    uint32 internal constant TWAP_WINDOW = 1800;
    uint32 internal constant MAX_OBSERVATION_AGE = 1800;
    uint64 internal constant MAX_STALE = 3600;

    struct Item {
        string name;
        address asset;
        address quote; // address(0) = native ETH, else the quote token
        address hook;
        uint24 fee;
        int24 tickSpacing;
        uint256 minPriceX18;
        uint256 maxPriceX18;
    }

    function run() external {
        if (keccak256(bytes(vm.envOr("CONFIRM_GENERIC_V4_DEPLOY", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }

        // Bands are [spot/2, spot*2] from the fork-verified spot prices
        // (see the generic-V4 report); the spot check below re-verifies them live.
        Item[4] memory items = [
            Item({
                name: "TIBBIR",
                asset: 0x4db7374E966097be94C6680d49156D580F097Bbf,
                quote: address(0),
                hook: 0x88e5d1cf9907acD48E7C81ff6eBC088aD358a5cc,
                fee: 3000,
                tickSpacing: 60,
                minPriceX18: 37_000_000_000_000,
                maxPriceX18: 148_100_000_000_000
            }),
            Item({
                name: "TORCH",
                asset: 0x000050E18ffa3F8F7aD170Eb9CeF160eb3Ed1111,
                quote: address(0),
                hook: address(0),
                fee: 3000,
                tickSpacing: 60,
                minPriceX18: 918_000_000_000,
                maxPriceX18: 3_672_000_000_000
            }),
            Item({
                name: "FOBO",
                asset: 0x000DE658153f47f23e92973C8EB1e89762703676,
                quote: address(0),
                hook: 0x0Af57F62982D03066ef917AcAd87F771c06528Ec,
                fee: 0,
                tickSpacing: 60,
                minPriceX18: 489_000_000_000,
                maxPriceX18: 1_957_000_000_000
            }),
            Item({
                name: "ORBIO",
                asset: 0xAa07A0e9209e16aC99708C3EC70159c6eF3128A3,
                quote: USDG,
                hook: address(0),
                fee: 8000,
                tickSpacing: 80,
                minPriceX18: 7_100_000_000_000,
                maxPriceX18: 28_400_000_000_000
            })
        ];

        IAllowlist allowlist = IAllowlist(ALLOWLIST);
        IPoolManager pm = IPoolManager(POOL_MANAGER);

        vm.startBroadcast();
        // 1. The generic adapter (one deployment serves every V4 pool; the pool
        //    key travels in `data` per call).
        GenericV4RouterAdapter adapter = new GenericV4RouterAdapter(POOL_MANAGER, WETH);
        console2.log("GenericV4RouterAdapter:", address(adapter));

        // 2. The USDG/WETH V3 reference feed (reads the pool's own observations;
        //    needs no poking). Only ORBIO uses it.
        UniswapV3TwapFeed ref =
            new UniswapV3TwapFeed(USDG_WETH_V3_POOL, USDG, WETH, TWAP_WINDOW, MAX_OBSERVATION_AGE);
        console2.log("USDG/WETH reference feed:", address(ref));
        (uint256 refPx,) = ref.latestPrice(USDG);
        console2.log("USDG/WETH reference priceX18:", refPx);

        // 3. Deploy the four generic V4 feeds, poke each once, and check the live
        //    spot price sits inside its band before anything is proposed.
        address[] memory feeds = new address[](items.length);
        for (uint256 i = 0; i < items.length; ++i) {
            address refFeed = items[i].quote == USDG ? address(ref) : address(0);
            GenericV4TwapFeed feed = new GenericV4TwapFeed(
                POOL_MANAGER,
                items[i].asset,
                items[i].quote,
                items[i].hook,
                items[i].fee,
                items[i].tickSpacing,
                TWAP_WINDOW,
                MAX_OBSERVATION_AGE,
                WETH,
                refFeed
            );
            feeds[i] = address(feed);
            feed.poke();
            console2.log(items[i].name, "feed:", feeds[i]);

            // Spot check: the pool's current tick -> spot priceX18 (WETH-denominated).
            // Build the pool key with currencies sorted (currency0 < currency1),
            // the same way the feed does.
            address c0 = items[i].quote;
            address c1 = items[i].asset;
            if (c1 < c0) (c0, c1) = (c1, c0);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(c0),
                currency1: Currency.wrap(c1),
                fee: items[i].fee,
                tickSpacing: items[i].tickSpacing,
                hooks: IHooks(items[i].hook)
            });
            (, int24 tick,,) = StateLibrary.getSlot0(pm, key.toId());
            bool assetIsCurrency0 = items[i].asset == c0;
            uint256 spotPx = TwapPriceMath.priceX18FromTick(int256(tick), assetIsCurrency0);
            if (items[i].quote == USDG) {
                spotPx = Math.mulDiv(spotPx, refPx, 1e18);
            }
            console2.log(items[i].name, "spot priceX18:", spotPx);
            if (spotPx < items[i].minPriceX18 || spotPx > items[i].maxPriceX18) {
                revert BandCheckFailed(items[i].name, spotPx, items[i].minPriceX18, items[i].maxPriceX18);
            }
        }

        // 4. Queue the four asset proposals + the generic adapter as a router.
        for (uint256 i = 0; i < items.length; ++i) {
            uint256 id =
                allowlist.proposeAsset(items[i].asset, feeds[i], MAX_STALE, items[i].minPriceX18, items[i].maxPriceX18);
            console2.log(items[i].name, "proposal id:", id);
        }
        uint256 routerId = allowlist.propose(address(adapter), true, true);
        console2.log("generic adapter router proposal id:", routerId);
        vm.stopBroadcast();
    }
}
