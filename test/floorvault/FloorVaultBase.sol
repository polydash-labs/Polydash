// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {PolypadTokenFloorFactory} from "../../src/floorvault/PolypadTokenFloorFactory.sol";
import {PolypadTokenFloorCollection as C} from "../../src/floorvault/PolypadTokenFloorCollection.sol";
import "./Mocks.sol";

abstract contract FloorVaultBase is Test {
    PoolManager pm;
    PoolModifyLiquidityTest lp;
    PoolSwapTest sw;
    MockToken tok;
    MockHook hook;
    MockLaunch launch;
    MockLaunchFactory lfA;
    MockLaunchFactory lfB;
    PolypadTokenFloorFactory f;
    PoolKey key;
    address creator = address(0xC0);
    address alice = address(0xA1);
    address bob = address(0xB0);
    address feeWallet = address(0xFEE);
    MockFeeSource feeSrc;

    function setUp() public virtual {
        pm = new PoolManager(address(this));
        lp = new PoolModifyLiquidityTest(pm);
        sw = new PoolSwapTest(pm);
        tok = new MockToken();
        hook = new MockHook();
        launch = new MockLaunch(creator, address(tok), address(hook));
        lfA = new MockLaunchFactory();
        lfB = new MockLaunchFactory();
        lfB.add(address(tok), address(launch));
        f = new PolypadTokenFloorFactory(
            address(lfA), address(lfB), address(feeSrc = new MockFeeSource(feeWallet)), address(pm)
        );

        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(tok)), 3000, 60, IHooks(address(0)));
        hook.setKey(key);
        pm.initialize(key, TickMath.getSqrtPriceAtTick(69_060)); // ~1000 tokens per ETH
        tok.mint(address(this), 1e30);
        tok.approve(address(lp), type(uint256).max);
        tok.approve(address(sw), type(uint256).max);
        vm.deal(address(this), 5000 ether);
        lp.modifyLiquidity{value: 2000 ether}(key, IPoolManager.ModifyLiquidityParams(-887_220, 887_220, 1e22, 0), "");
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    receive() external payable {}

    function _p() internal view returns (PolypadTokenFloorFactory.Params memory p) {
        p = PolypadTokenFloorFactory.Params({
            name: "Moon Floor",
            symbol: "MF",
            imageUri: "ipfs://img",
            description: "d",
            baseURI: "ipfs://b/",
            maxSupply: 1000,
            price: 0.1 ether,
            floorBps: 5000,
            tokenShareBps: 5000,
            maxSlippageBps: 300,
            maxBuyEth: 1 ether,
            royaltyBps: 500,
            maxPerWallet: 100,
            startTime: 0,
            token: address(tok),
            payoutWallet: address(0)
        });
    }

    function _create() internal returns (C c) {
        vm.prank(creator);
        c = C(payable(f.createCollection(_p())));
    }

    function _mint(C c, address who, uint256 n) internal {
        uint256 v = c.price() * n;
        vm.prank(who);
        c.mint{value: v}(n);
    }

    function _readyBuy(C c) internal {
        launch.setGraduated(true);
        c.observePrice();
        skip(6 minutes);
    }

    function _bal(C c) internal view returns (uint256) {
        return c.ethFloor() + c.pendingEth() + c.creatorBalance() + c.platformBalance();
    }
}
