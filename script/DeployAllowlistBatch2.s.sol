// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {UniswapV3TwapFeed} from "../src/fund/growth/UniswapV3TwapFeed.sol";
import {GenericV4TwapFeed} from "../src/fund/growth/GenericV4TwapFeed.sol";
import {TwapPriceMath} from "../src/fund/growth/TwapPriceMath.sol";

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

/// @notice Batch allowlist queue for the 4 tokens Jon approved 2026-11-17:
///         HOOKR, HMM, DELTA, BOW. Three V3 tokens get a UniswapV3TwapFeed
///         (6-hour TWAP window, 6-hour max observation age); HOOKR gets a
///         GenericV4TwapFeed (30-minute window, matching the existing V4 feeds
///         and the 15-minute keeper poke cadence).
///
///         CORRECTION vs the research pass: BOW's WETH pool is a Uniswap V3
///         pool (0xDaF8038E8Eab4A56bD1C0485D414241622384FEF, fee 1%, token0=WETH,
///         token1=BOW — verified live via token0/token1/fee/slot0), NOT a V4
///         pool. The research pass mistook GeckoTerminal's 20-byte V3 pool
///         address for a V4 poolId. BOW therefore takes a V3 TWAP feed, same as
///         HMM and DELTA. Its BOW/SPY pool IS V4 (poolId
///         0xdba909ac1600a59685928cf317fb953d518d405b4748371889e3cb2932adf4c2,
///         fee 0, tickSpacing 200, hook = Pons memeHook
///         0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044 — verified by recomputing
///         the poolId from the PoolKey), but that pool is SPY-quoted and is NOT
///         used for the feed.
///
///         HOOKR hook read (verified live 2026-11-17): the HOOKR/ETH V4 pool
///         key is (currency0=address(0) [native ETH], currency1=HOOKR,
///         fee=2500, tickSpacing=25, hooks=address(0)) — the keccak of that
///         key is exactly the known poolId
///         0x590dcb6a87828bf688b48089a62239b693378f1fb64d2286e6a399ed8c005fdf.
///         The pool has NO hook (address(0)), and the Nov 12 fork test
///         (GenericV4Fork.t.sol test_hookr_generality_proof) bought and sold
///         HOOKR through this exact key with zero tax. HOOKR token: plain
///         ERC20, 18 decimals, 1B supply, 7,154-byte code.
///         The GenericV4RouterAdapter (0x5B79f2A4f3dBAFd463065D31EaA95aC6675D2429)
///         is already an allowed router, so no router proposal is needed.
///
///         Bands are [spot/2, spot*2] from live spot prices read 2026-11-17
///         (V3 slot0 sqrtPrice for HMM/DELTA/BOW; GeckoTerminal USD prices
///         for HOOKR). The script asserts each feed's live TWAP (V3) / spot
///         (V4, feed starts empty) is inside its band before proposing, so a
///         stale band fails loudly instead of allowlisting a bad band.
///         Proposals become executable after the allowlist's 2-day delay;
///         execute() is permissionless.
///
///         V4 feeds self-observe via poke(): this script pokes the HOOKR feed
///         once to seed its first observation. The buyback keeper must then
///         poke it every 15 minutes (add it to the keeper's feed list) so the
///         feed has a full 30-minute TWAP window by the time the 2-day
///         timelock expires; until the window fills, latestPrice reverts
///         (fail closed) and no trade can use the feed. V3 feeds read the
///         pool's own observations and need no poking.
///
///         KNOWN QUIRK: IPoolManager.getSlot0(poolId) reverts on this chain
///         (verified on both dRPC and the official RPC, even for known-good
///         pools) — do NOT treat that as a pool problem. The feed
///         constructor and the spot check below use StateLibrary.getSlot0
///         (extsload path), which is how the Nov 12 V4 feeds deployed fine.
/// @dev Dry-run (no broadcast, no key needed):
///      CONFIRM_ALLOWLIST_BATCH_2=yes forge script script/DeployAllowlistBatch2.s.sol
///        --rpc-url https://rpc.mainnet.chain.robinhood.com
///        --sender 0x9a21c75aC263cC43125E70200636f6397f8776d0 --unlocked
///      Real run (deployer key required, never in chat or files):
///      CONFIRM_ALLOWLIST_BATCH_2=yes forge script script/DeployAllowlistBatch2.s.sol
///        --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast --private-key 0x...
contract DeployAllowlistBatch2 is Script {
    using PoolIdLibrary for PoolKey;

    error DeployNotConfirmed();
    error BandCheckFailed(string name, uint256 priceX18, uint256 minPriceX18, uint256 maxPriceX18);

    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant ALLOWLIST = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    uint32 internal constant V3_TWAP_WINDOW = 21_600; // 6 hours
    uint32 internal constant V3_MAX_OBSERVATION_AGE = 21_600;
    uint32 internal constant V4_TWAP_WINDOW = 1800; // 30 minutes
    uint32 internal constant V4_MAX_OBSERVATION_AGE = 1800;
    uint64 internal constant MAX_STALE = 3600;

    struct V3Item {
        string name;
        address pool;
        address asset;
        uint256 minPriceX18;
        uint256 maxPriceX18;
    }

    function run() external {
        if (keccak256(bytes(vm.envOr("CONFIRM_ALLOWLIST_BATCH_2", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }

        // Spot prices read live 2026-11-17; bands are [spot/2, spot*2].
        V3Item[3] memory v3items = [
            V3Item({
                name: "HMM",
                pool: 0x2b0D0183d017c58B924401cA8AC362f6E01F0E9e,
                asset: 0x7FE995a80075dF3Dc8Ae11A9b82c7FE4202CD87f,
                minPriceX18: 2_135_000_000_000,
                maxPriceX18: 8_541_000_000_000
            }),
            V3Item({
                name: "DELTA",
                pool: 0xD64FbdA67E1015dF43Fa5e49F02cA844729E5F94,
                asset: 0xe8ffd7e24187F72afB08d75B1bb13088A989a791,
                minPriceX18: 932_000_000_000,
                maxPriceX18: 3_730_000_000_000
            }),
            V3Item({
                name: "BOW",
                pool: 0xDaF8038E8Eab4A56bD1C0485D414241622384FEF,
                asset: 0x451b42A15100C340CA12F7c66DE06fac5EA2D751,
                minPriceX18: 738_000_000_000,
                maxPriceX18: 2_954_000_000_000
            })
        ];

        // HOOKR: V4 HOOKR/ETH pool, key (ETH, HOOKR, fee 2500, tickSpacing 25,
        // hooks address(0)) — poolId verified by keccak recomputation.
        address hookrAsset = 0x18E674231A58c239Dc7DaeDcffE15Ec3A24cff5c;
        uint256 hookrMin = 3_394_000_000_000;
        uint256 hookrMax = 13_578_000_000_000;

        IAllowlist allowlist = IAllowlist(ALLOWLIST);
        IPoolManager pm = IPoolManager(POOL_MANAGER);

        vm.startBroadcast();
        // Phase 1: deploy the three V3 feeds, then check every 6h TWAP is
        // inside its band. A stale band reverts here, before any proposal.
        address[] memory v3feeds = new address[](v3items.length);
        for (uint256 i = 0; i < v3items.length; ++i) {
            UniswapV3TwapFeed feed = new UniswapV3TwapFeed(
                v3items[i].pool, v3items[i].asset, WETH, V3_TWAP_WINDOW, V3_MAX_OBSERVATION_AGE
            );
            v3feeds[i] = address(feed);
            (uint256 twapPriceX18,) = feed.latestPrice(v3items[i].asset);
            if (twapPriceX18 < v3items[i].minPriceX18 || twapPriceX18 > v3items[i].maxPriceX18) {
                revert BandCheckFailed(v3items[i].name, twapPriceX18, v3items[i].minPriceX18, v3items[i].maxPriceX18);
            }
            console2.log(v3items[i].name, "feed:", v3feeds[i]);
            console2.log(v3items[i].name, "twapPriceX18:", twapPriceX18);
        }

        // Phase 2: deploy the HOOKR V4 feed, poke once, and check the live
        // spot price sits inside its band before anything is proposed.
        GenericV4TwapFeed hookrFeed = new GenericV4TwapFeed(
            POOL_MANAGER, hookrAsset, address(0), address(0), 2500, 25, V4_TWAP_WINDOW, V4_MAX_OBSERVATION_AGE, WETH, address(0)
        );
        address hookrFeedAddr = address(hookrFeed);
        hookrFeed.poke();
        console2.log("HOOKR", "feed:", hookrFeedAddr);
        {
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(hookrAsset),
                fee: 2500,
                tickSpacing: 25,
                hooks: IHooks(address(0))
            });
            (, int24 tick,,) = StateLibrary.getSlot0(pm, key.toId());
            uint256 spotPx = TwapPriceMath.priceX18FromTick(int256(tick), false);
            console2.log("HOOKR", "spot priceX18:", spotPx);
            if (spotPx < hookrMin || spotPx > hookrMax) {
                revert BandCheckFailed("HOOKR", spotPx, hookrMin, hookrMax);
            }
        }

        // Phase 3: queue the four asset proposals (owner-only; 2-day delay).
        for (uint256 i = 0; i < v3items.length; ++i) {
            uint256 id =
                allowlist.proposeAsset(v3items[i].asset, v3feeds[i], MAX_STALE, v3items[i].minPriceX18, v3items[i].maxPriceX18);
            console2.log(v3items[i].name, "proposal id:", id);
        }
        uint256 hookrId = allowlist.proposeAsset(hookrAsset, hookrFeedAddr, MAX_STALE, hookrMin, hookrMax);
        console2.log("HOOKR", "proposal id:", hookrId);
        vm.stopBroadcast();
    }
}
