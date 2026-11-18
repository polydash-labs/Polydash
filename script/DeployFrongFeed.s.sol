// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {GenericV4TwapFeed} from "../src/fund/growth/GenericV4TwapFeed.sol";
import {TwapPriceMath} from "../src/fund/growth/TwapPriceMath.sol";

/// @notice One-off mainnet onboarding for FRONG (the generic-V4 generality proof
///         token): deploy one GenericV4TwapFeed for its FRONG/ETH V4 pool, poke it
///         once to seed the first observation, and propose it to the allowlist.
///         The adapter is already an approved router — no router proposal needed.
///         Band is computed LIVE from the pool's current spot tick ([spot/2, spot*2]),
///         so a stale hardcoded band can never deploy. The feed constructor reverts
///         unless the pool key identifies an initialized pool, so a wrong fee /
///         tickSpacing / hook / currency pair fails loudly before anything is sent.
///         Proposals become executable after the allowlist's 2-day delay; execute()
///         is permissionless. After this runs, add the new feed to the buyback
///         keeper's TWAP_FEED_ADDRESSES so it is poked every 15 minutes.
/// @dev Dry-run (no broadcast, no key needed):
///      CONFIRM_FRONG_DEPLOY=yes forge script script/DeployFrongFeed.s.sol
///        --rpc-url https://rpc.mainnet.chain.robinhood.com
///        --sender 0x9a21c75aC263cC43125E70200636f6397f8776d0 --unlocked
///      Real run (deployer key required, never in chat or files):
///      CONFIRM_FRONG_DEPLOY=yes forge script script/DeployFrongFeed.s.sol
///        --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast --private-key 0x...
interface IAllowlist {
    function proposeAsset(address asset, address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)
        external
        returns (uint256 id);
}

contract DeployFrongFeed is Script {
    using PoolIdLibrary for PoolKey;

    error DeployNotConfirmed();

    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant ALLOWLIST = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    address internal constant FRONG = 0x6245e67affA44a23077f0Ea7f981a8DC743a0c47;
    uint24 internal constant FEE = 2500;
    int24 internal constant TICK_SPACING = 60;

    uint32 internal constant TWAP_WINDOW = 1800;
    uint32 internal constant MAX_OBSERVATION_AGE = 1800;
    uint64 internal constant MAX_STALE = 3600;

    function run() external {
        if (keccak256(bytes(vm.envOr("CONFIRM_FRONG_DEPLOY", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }

        IPoolManager pm = IPoolManager(POOL_MANAGER);

        // FRONG/ETH pool key, currencies sorted (currency0 < currency1).
        address c0 = address(0);
        address c1 = FRONG;
        if (c1 < c0) (c0, c1) = (c1, c0);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        (, int24 tick,,) = StateLibrary.getSlot0(pm, key.toId());
        bool assetIsCurrency0 = FRONG == c0;
        uint256 spotPx = TwapPriceMath.priceX18FromTick(int256(tick), assetIsCurrency0);
        uint256 minPx = spotPx / 2;
        uint256 maxPx = spotPx * 2;
        console2.log("FRONG spot priceX18:", spotPx);
        console2.log("FRONG band [min, max]:", minPx, maxPx);

        vm.startBroadcast();
        GenericV4TwapFeed feed = new GenericV4TwapFeed(
            POOL_MANAGER, FRONG, address(0), address(0), FEE, TICK_SPACING, TWAP_WINDOW, MAX_OBSERVATION_AGE, WETH, address(0)
        );
        console2.log("FRONG feed:", address(feed));
        feed.poke();
        console2.log("feed poked (first observation seeded)");

        uint256 id = IAllowlist(ALLOWLIST).proposeAsset(FRONG, address(feed), MAX_STALE, minPx, maxPx);
        console2.log("FRONG proposal id:", id);
        vm.stopBroadcast();
    }
}
