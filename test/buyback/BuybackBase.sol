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
import {PolydashBuybackVault as V} from "../../src/buyback/PolydashBuybackVault.sol";
import "./Mocks.sol";

abstract contract BuybackBase is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    PoolManager pm;
    PoolModifyLiquidityTest lp;
    PoolSwapTest sw;
    MockWETH weth;
    MockToken tok;
    MockLaunchFactory fa;
    MockLaunchFactory fb;
    MockStakingFactory msf;
    MockRewardsPool rp;
    address feesWallet = address(0x9A21);
    V v;
    PoolKey key;
    address alice = address(0xA1);
    address bob = address(0xB0);

    function setUp() public virtual {
        pm = new PoolManager(address(this));
        lp = new PoolModifyLiquidityTest(pm);
        sw = new PoolSwapTest(pm);
        deployCodeTo("test/buyback/Mocks.sol:MockWETH", address(0x1000000000000000000000000000000000000001));
        deployCodeTo("test/buyback/Mocks.sol:MockToken", address(0x2000000000000000000000000000000000000002));
        weth = MockWETH(address(0x1000000000000000000000000000000000000001));
        tok = MockToken(address(0x2000000000000000000000000000000000000002));
        fa = new MockLaunchFactory();
        fb = new MockLaunchFactory();
        msf = new MockStakingFactory();
        rp = new MockRewardsPool(address(tok), address(tok), block.timestamp + 135 days);
        msf.add(address(rp));
        key = PoolKey(Currency.wrap(address(weth)), Currency.wrap(address(tok)), 3000, 60, IHooks(address(0)));
        pm.initialize(key, TickMath.getSqrtPriceAtTick(69_060)); // ~1000 POLYDASH per WETH
        tok.mint(address(this), 1e30);
        weth.mint(address(this), 1e24);
        tok.approve(address(lp), type(uint256).max);
        weth.approve(address(lp), type(uint256).max);
        tok.approve(address(sw), type(uint256).max);
        weth.approve(address(sw), type(uint256).max);
        lp.modifyLiquidity(key, IPoolManager.ModifyLiquidityParams(-887_220, 887_220, 1e22, 0), "");
        v = new V(_init());
        vm.deal(address(this), 1000 ether);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    function _init() internal view returns (V.Init memory p) {
        p = V.Init({
            poolManager: address(pm),
            weth: address(weth),
            polydash: address(tok),
            hook: address(0),
            poolFee: 3000,
            tickSpacing: 60,
            factoryA: address(fa),
            factoryB: address(fb),
            maxBuyEth: 0.02 ether,
            maxSlippageBps: 300,
            maxPoolFeeBps: 300,
            burnShareBps: 6250,
            stakingFactory: address(msf),
            targetAdmin: feesWallet,
            initialTarget: address(0)
        });
    }

    receive() external payable {}

    function _fund(uint256 a) internal {
        fa.send{value: a}(address(v), a);
    }

    function _ready() internal {
        v.observePrice();
        skip(6 minutes);
    }

    function _setTarget(address t) internal {
        vm.prank(feesWallet);
        v.proposeTarget(t);
        skip(48 hours);
        vm.prank(feesWallet);
        v.executeTarget();
    }

    function _buyOnce(uint256 fund) internal returns (uint256 e, uint256 b, uint256 k) {
        _fund(fund);
        _ready();
        (e, b, k) = v.buy();
    }

    function _whale(bool buyTok, int256 amt) internal {
        uint160 lim = buyTok ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        sw.swap(key, IPoolManager.SwapParams(buyTok, -amt, lim), PoolSwapTest.TestSettings(false, false), "");
    }
}
