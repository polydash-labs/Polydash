// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {GenericV4RouterAdapter} from "../../../src/fund/growth/GenericV4RouterAdapter.sol";
import {MockERC20} from "../../mocks/MockERC20.sol";

/// @notice Minimal WETH9 for the local pool: mint via deposit, burn via withdraw. Defined here
///         (rather than reusing test/fund/InvestMocks.sol) because that file pulls in the paris
///         fund vaults, which cannot share a compilation graph with the cancun V4 adapter.
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "weth");
    }

    receive() external payable {}
}

/// @notice Fee-on-transfer token: `transfer` delivers 98% and burns the 2% fee;
///         `transferFrom` is clean. Models TORCH's buy-only tax: the pool's `take`
///         (a `transfer`) is taxed, the adapter's `settle` (also a `transfer`) would
///         be taxed too — which is why this token is only bought in tests, never sold.
contract MockFoT is ERC20 {
    uint256 public constant FEE_BPS = 200;

    constructor() ERC20("FoT Token", "FOT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        uint256 fee = (value * FEE_BPS) / 10000;
        super.transfer(to, value - fee);
        if (fee > 0) _burn(msg.sender, fee);
        return true;
    }
}

/// @notice Minimal surface of v4-core's PoolModifyLiquidityTest. The implementation itself is
///         `pragma solidity 0.8.26`, which this 0.8.24 test file cannot import, so it is deployed
///         from its compiled artifact (built by the buyback tests' 0.8.26 job) via `deployCode`.
interface IPoolModifyLiquidityTest {
    function modifyLiquidity(
        PoolKey memory key,
        IPoolManager.ModifyLiquidityParams memory params,
        bytes memory hookData
    ) external payable returns (BalanceDelta delta);
}

/// @notice Unit coverage for the generic V4 adapter against a local PoolManager: the pool key
///         in `data`, native-ETH pools (unwrap / wrap), either currency ordering (including a
///         token that sorts below WETH), fee-on-transfer outputs measured by balance, and the
///         minAmountOut / partial-fill guards. No hook, 3000 fee, 60 tick spacing unless noted.
contract GenericV4RouterAdapterTest is Test {
    using PoolIdLibrary for PoolKey;

    IPoolManager pm;
    IPoolModifyLiquidityTest lp;
    MockWETH weth;
    MockERC20 token;
    MockERC20 tokenLow;
    MockFoT fot;
    GenericV4RouterAdapter adapter;

    // Fixed addresses. TOKEN_LOW sorts below WETH (like TORCH / FOBO sort below WETH);
    // TOKEN and FOT sort above it. ETH is address(0) and sorts below everything.
    address constant WETH_ADDR = 0x1000000000000000000000000000000000000001;
    address constant TOKEN_ADDR = 0x2000000000000000000000000000000000000002;
    address constant TOKEN_LOW_ADDR = 0x0000000000000000000000000000000000002000;
    address constant FOT_ADDR = 0x3000000000000000000000000000000000000003;

    PoolKey ethKey; // ETH / TOKEN, 3000 / 60, hookless
    PoolKey wethKey; // WETH / TOKEN, 3000 / 60, hookless
    PoolKey wethLowKey; // TOKEN_LOW / WETH, 3000 / 60, hookless (token sorts below WETH)
    PoolKey ethFotKey; // ETH / FOT, 3000 / 60, hookless

    function setUp() public {
        pm = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(address(this))));
        lp = IPoolModifyLiquidityTest(
            deployCode("PoolModifyLiquidityTest.sol:PoolModifyLiquidityTest", abi.encode(address(pm)))
        );
        deployCodeTo("test/fund/growth/GenericV4RouterAdapter.t.sol:MockWETH", WETH_ADDR);
        deployCodeTo(
            "test/mocks/MockERC20.sol:MockERC20", abi.encode("Token", "TOKEN", uint256(0)), TOKEN_ADDR
        );
        deployCodeTo(
            "test/mocks/MockERC20.sol:MockERC20", abi.encode("TokenLow", "TLOW", uint256(0)), TOKEN_LOW_ADDR
        );
        deployCodeTo("test/fund/growth/GenericV4RouterAdapter.t.sol:MockFoT", FOT_ADDR);
        weth = MockWETH(payable(WETH_ADDR));
        token = MockERC20(TOKEN_ADDR);
        tokenLow = MockERC20(TOKEN_LOW_ADDR);
        fot = MockFoT(FOT_ADDR);

        ethKey = PoolKey(Currency.wrap(address(0)), Currency.wrap(TOKEN_ADDR), 3000, 60, IHooks(address(0)));
        wethKey = PoolKey(Currency.wrap(WETH_ADDR), Currency.wrap(TOKEN_ADDR), 3000, 60, IHooks(address(0)));
        wethLowKey =
            PoolKey(Currency.wrap(TOKEN_LOW_ADDR), Currency.wrap(WETH_ADDR), 3000, 60, IHooks(address(0)));
        ethFotKey = PoolKey(Currency.wrap(address(0)), Currency.wrap(FOT_ADDR), 3000, 60, IHooks(address(0)));

        // ~1000 tokens per ETH, as in the buyback tests. For the TOKEN_LOW/WETH pool
        // the token is currency0, so the price is WETH per token: tick -69060 gives
        // 0.001 WETH per token, i.e. 1000 tokens per WETH, matching the other pools.
        pm.initialize(ethKey, TickMath.getSqrtPriceAtTick(69_060));
        pm.initialize(wethKey, TickMath.getSqrtPriceAtTick(69_060));
        pm.initialize(wethLowKey, TickMath.getSqrtPriceAtTick(-69_060));
        pm.initialize(ethFotKey, TickMath.getSqrtPriceAtTick(69_060));

        token.mint(address(this), 1e30);
        tokenLow.mint(address(this), 1e30);
        fot.mint(address(this), 1e30);
        token.approve(address(lp), type(uint256).max);
        tokenLow.approve(address(lp), type(uint256).max);
        fot.approve(address(lp), type(uint256).max);
        weth.approve(address(lp), type(uint256).max);

        vm.deal(address(this), 10000 ether);
        lp.modifyLiquidity{value: 2000 ether}(
            ethKey, IPoolManager.ModifyLiquidityParams(-887_220, 887_220, 1e22, 0), ""
        );
        weth.deposit{value: 2000 ether}();
        lp.modifyLiquidity(
            wethKey, IPoolManager.ModifyLiquidityParams(-887_220, 887_220, 1e22, 0), ""
        );
        lp.modifyLiquidity(
            wethLowKey, IPoolManager.ModifyLiquidityParams(-887_220, 887_220, 1e22, 0), ""
        );
        lp.modifyLiquidity{value: 2000 ether}(
            ethFotKey, IPoolManager.ModifyLiquidityParams(-887_220, 887_220, 1e22, 0), ""
        );

        adapter = new GenericV4RouterAdapter(address(pm), WETH_ADDR);
        vm.deal(address(this), 1000 ether);
    }

    receive() external payable {}

    /// @notice `data` for a pool: (quote, fee, tickSpacing, hook, priceLimit).
    function _data(address quote, uint160 limit) internal pure returns (bytes memory) {
        return abi.encode(quote, uint24(3000), int24(60), address(0), limit);
    }

    function _dataNoLimit(address quote) internal pure returns (bytes memory) {
        return _data(quote, 0);
    }

    // ------------------------------------------------------------------ constructor

    function test_constructor_rejects_zero_addresses() public {
        vm.expectRevert(GenericV4RouterAdapter.BadAmount.selector);
        new GenericV4RouterAdapter(address(0), WETH_ADDR);
        vm.expectRevert(GenericV4RouterAdapter.BadAmount.selector);
        new GenericV4RouterAdapter(address(pm), address(0));
    }

    function test_constructor_rejects_manager_without_code() public {
        vm.expectRevert(GenericV4RouterAdapter.BadAmount.selector);
        new GenericV4RouterAdapter(address(0x1234), WETH_ADDR);
    }

    // ------------------------------------------------------------------ ETH-quoted pool

    function test_eth_pool_buy_with_eth() public {
        uint256 before = token.balanceOf(address(this));
        uint256 out = adapter.swap{value: 1 ether}(
            address(0), TOKEN_ADDR, 1 ether, 1, _dataNoLimit(address(0))
        );
        assertGt(out, 900 ether);
        assertLt(out, 1100 ether);
        assertEq(token.balanceOf(address(this)), before + out);
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(token.balanceOf(address(adapter)), 0);
    }

    function test_eth_pool_buy_with_weth_unwraps() public {
        weth.transfer(address(adapter), 1 ether);
        uint256 before = token.balanceOf(address(this));
        uint256 out = adapter.swap(WETH_ADDR, TOKEN_ADDR, 1 ether, 1, _dataNoLimit(address(0)));
        assertGt(out, 900 ether);
        assertLt(out, 1100 ether);
        assertEq(token.balanceOf(address(this)), before + out);
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(token.balanceOf(address(adapter)), 0);
    }

    function test_eth_pool_sell_for_eth() public {
        token.transfer(address(adapter), 1000 ether);
        uint256 before = address(this).balance;
        uint256 out = adapter.swap(TOKEN_ADDR, address(0), 1000 ether, 1, _dataNoLimit(address(0)));
        assertGt(out, 0.9 ether);
        assertLt(out, 1.1 ether);
        assertEq(address(this).balance, before + out);
        assertEq(address(adapter).balance, 0);
        assertEq(token.balanceOf(address(adapter)), 0);
    }

    function test_eth_pool_sell_for_weth_wraps() public {
        token.transfer(address(adapter), 1000 ether);
        uint256 before = weth.balanceOf(address(this));
        uint256 out = adapter.swap(TOKEN_ADDR, WETH_ADDR, 1000 ether, 1, _dataNoLimit(address(0)));
        assertGt(out, 0.9 ether);
        assertLt(out, 1.1 ether);
        assertEq(weth.balanceOf(address(this)), before + out);
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(token.balanceOf(address(adapter)), 0);
    }

    // ------------------------------------------------------------------ WETH-quoted pool

    function test_weth_pool_buy_with_eth_wraps() public {
        uint256 before = token.balanceOf(address(this));
        uint256 out = adapter.swap{value: 1 ether}(
            address(0), TOKEN_ADDR, 1 ether, 1, _dataNoLimit(WETH_ADDR)
        );
        assertGt(out, 900 ether);
        assertLt(out, 1100 ether);
        assertEq(token.balanceOf(address(this)), before + out);
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
    }

    function test_weth_pool_buy_with_weth() public {
        weth.transfer(address(adapter), 1 ether);
        uint256 out = adapter.swap(WETH_ADDR, TOKEN_ADDR, 1 ether, 1, _dataNoLimit(WETH_ADDR));
        assertGt(out, 900 ether);
        assertLt(out, 1100 ether);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(token.balanceOf(address(adapter)), 0);
    }

    function test_weth_pool_sell_for_eth_unwraps() public {
        token.transfer(address(adapter), 1000 ether);
        uint256 before = address(this).balance;
        uint256 out = adapter.swap(TOKEN_ADDR, address(0), 1000 ether, 1, _dataNoLimit(WETH_ADDR));
        assertGt(out, 0.9 ether);
        assertLt(out, 1.1 ether);
        assertEq(address(this).balance, before + out);
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
    }

    // ------------------------------------------------------------------ token below WETH

    function test_token_below_weth_buys_and_sells() public {
        // TOKEN_LOW sorts below WETH, so it is currency0 in the WETH pool. The old
        // one-pool adapter's constructor (`require _weth < _polydash`) would have
        // reverted for this pair; the generic adapter sorts the key itself.
        weth.transfer(address(adapter), 1 ether);
        uint256 out = adapter.swap(WETH_ADDR, TOKEN_LOW_ADDR, 1 ether, 1, _dataNoLimit(WETH_ADDR));
        assertGt(out, 900 ether);
        assertLt(out, 1100 ether);
        tokenLow.transfer(address(adapter), out);
        uint256 back = adapter.swap(TOKEN_LOW_ADDR, WETH_ADDR, out, 1, _dataNoLimit(WETH_ADDR));
        assertGt(back, 0.9 ether);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(tokenLow.balanceOf(address(adapter)), 0);
    }

    // ------------------------------------------------------------------ fee-on-transfer output

    function test_fot_buy_returns_measured_output() public {
        // Same buy on the clean ETH pool and on the FoT pool: the FoT output is
        // 98% of the clean output, and the adapter returns the measured amount
        // (the old adapter would revert trying to transfer the delta amount).
        uint256 clean = adapter.swap{value: 1 ether}(
            address(0), TOKEN_ADDR, 1 ether, 1, _dataNoLimit(address(0))
        );
        // The caller already holds a large FOT balance from the mint, so check
        // the balance *increase*, not the absolute balance.
        uint256 before = fot.balanceOf(address(this));
        uint256 fotOut = adapter.swap{value: 1 ether}(
            address(0), FOT_ADDR, 1 ether, 1, _dataNoLimit(address(0))
        );
        assertGt(fotOut, 0);
        // The adapter returns what IT received (98% of clean: the take was
        // taxed once). The caller receives 98% of that, because the payout
        // transfer is taxed a second time by the token. The facet measures
        // the vault's net balance, so it sees the 96% figure — that is what
        // its minAmountOut / deviation checks enforce against.
        assertApproxEqRel(fotOut, (clean * 98) / 100, 0.001e18, "adapter return should be ~98% of clean");
        assertApproxEqRel(
            fot.balanceOf(address(this)) - before, (fotOut * 98) / 100, 0.001e18, "caller receives ~98% of the adapter return"
        );
        assertEq(address(adapter).balance, 0);
        assertEq(fot.balanceOf(address(adapter)), 0);
    }

    function test_fot_buy_min_amount_out_uses_measured_output() public {
        // Demanding the full (pre-tax) clean output must revert: the measured
        // output is 2% less, so `minAmountOut` is enforced against what arrived.
        uint256 clean = adapter.swap{value: 1 ether}(
            address(0), TOKEN_ADDR, 1 ether, 1, _dataNoLimit(address(0))
        );
        vm.expectRevert(GenericV4RouterAdapter.Slippage.selector);
        adapter.swap{value: 1 ether}(address(0), FOT_ADDR, 1 ether, clean, _dataNoLimit(address(0)));
    }

    // ------------------------------------------------------------------ guards

    function test_min_amount_out_enforced() public {
        vm.expectRevert(GenericV4RouterAdapter.Slippage.selector);
        adapter.swap{value: 1 ether}(address(0), TOKEN_ADDR, 1 ether, 2000 ether, _dataNoLimit(address(0)));
        assertEq(token.balanceOf(address(adapter)), 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
    }

    function test_bad_data_reverts() public {
        vm.expectRevert(GenericV4RouterAdapter.BadData.selector);
        adapter.swap{value: 1 ether}(address(0), TOKEN_ADDR, 1 ether, 1, "");
        vm.expectRevert(GenericV4RouterAdapter.BadData.selector);
        adapter.swap{value: 1 ether}(address(0), TOKEN_ADDR, 1 ether, 1, abi.encode(uint160(1)));
    }

    function test_bad_pair_reverts() public {
        vm.expectRevert(GenericV4RouterAdapter.BadPair.selector);
        adapter.swap{value: 1 ether}(address(0), address(0), 1 ether, 1, _dataNoLimit(address(0)));
        // A token with no pool for the given key: the adapter cannot know the
        // pool does not exist without reading it, so the PoolManager reverts
        // with PoolNotInitialized. Any revert is the correct outcome here.
        address stranger = address(0x9999);
        vm.expectRevert();
        adapter.swap{value: 1 ether}(address(0), stranger, 1 ether, 1, _dataNoLimit(address(0)));
        // Neither side is the quote: not a pool pair at all.
        vm.expectRevert(GenericV4RouterAdapter.BadPair.selector);
        adapter.swap(stranger, TOKEN_ADDR, 1 ether, 1, _dataNoLimit(address(0)));
        // Both sides the quote (WETH -> ETH is a wrap, not a pool swap).
        vm.expectRevert(GenericV4RouterAdapter.BadPair.selector);
        adapter.swap{value: 1 ether}(address(0), WETH_ADDR, 1 ether, 1, _dataNoLimit(address(0)));
    }

    function test_eth_input_wrong_msg_value_reverts() public {
        vm.expectRevert(GenericV4RouterAdapter.BadAmount.selector);
        adapter.swap{value: 0.5 ether}(address(0), TOKEN_ADDR, 1 ether, 1, _dataNoLimit(address(0)));
    }

    function test_token_input_with_msg_value_reverts() public {
        token.transfer(address(adapter), 1000 ether);
        vm.expectRevert(GenericV4RouterAdapter.BadAmount.selector);
        adapter.swap{value: 1 wei}(TOKEN_ADDR, WETH_ADDR, 1000 ether, 1, _dataNoLimit(WETH_ADDR));
    }

    function test_token_input_without_prefunding_reverts() public {
        vm.expectRevert(GenericV4RouterAdapter.BadAmount.selector);
        adapter.swap(TOKEN_ADDR, WETH_ADDR, 1000 ether, 1, _dataNoLimit(WETH_ADDR));
    }

    function test_zero_amount_reverts() public {
        vm.expectRevert(GenericV4RouterAdapter.BadAmount.selector);
        adapter.swap{value: 0}(address(0), TOKEN_ADDR, 0, 1, _dataNoLimit(address(0)));
    }

    function test_explicit_limit_with_room_succeeds() public {
        uint160 spot = adapter.spotSqrtPriceX96(address(0), TOKEN_ADDR, 3000, 60, address(0));
        uint160 limit = uint160((uint256(spot) * 90) / 100);
        uint256 out = adapter.swap{value: 1 ether}(
            address(0), TOKEN_ADDR, 1 ether, 1, _data(address(0), limit)
        );
        assertGt(out, 900 ether);
    }

    function test_explicit_limit_too_tight_reverts() public {
        uint160 spot = adapter.spotSqrtPriceX96(address(0), TOKEN_ADDR, 3000, 60, address(0));
        vm.expectRevert();
        adapter.swap{value: 1 ether}(
            address(0), TOKEN_ADDR, 1 ether, 1, _data(address(0), spot - 1)
        );
        assertEq(token.balanceOf(address(adapter)), 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
    }

    function test_explicit_limit_wrong_side_reverts() public {
        uint160 spot = adapter.spotSqrtPriceX96(address(0), TOKEN_ADDR, 3000, 60, address(0));
        vm.expectRevert(GenericV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap{value: 1 ether}(address(0), TOKEN_ADDR, 1 ether, 1, _data(address(0), spot));
        vm.expectRevert(GenericV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap{value: 1 ether}(address(0), TOKEN_ADDR, 1 ether, 1, _data(address(0), spot + 1));
        token.transfer(address(adapter), 1000 ether);
        vm.expectRevert(GenericV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap(TOKEN_ADDR, address(0), 1000 ether, 1, _data(address(0), spot));
        vm.expectRevert(GenericV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap(TOKEN_ADDR, address(0), 1000 ether, 1, _data(address(0), spot - 1));
    }

    function test_adapter_holds_nothing_after_round_trip() public {
        adapter.swap{value: 1 ether}(address(0), TOKEN_ADDR, 1 ether, 1, _dataNoLimit(address(0)));
        uint256 got = token.balanceOf(address(this));
        token.transfer(address(adapter), got);
        adapter.swap(TOKEN_ADDR, address(0), got, 1, _dataNoLimit(address(0)));
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(token.balanceOf(address(adapter)), 0);
    }

    function test_receive_rejects_plain_eth() public {
        (bool ok,) = address(adapter).call{value: 1 wei}("");
        assertFalse(ok);
    }

    function test_unlock_callback_only_pool_manager() public {
        vm.expectRevert(GenericV4RouterAdapter.NotPoolManager.selector);
        adapter.unlockCallback("");
    }

    function test_pool_key_sorts_currencies() public view {
        PoolKey memory k1 = adapter.poolKey(TOKEN_ADDR, address(0), 3000, 60, address(0));
        PoolKey memory k2 = adapter.poolKey(address(0), TOKEN_ADDR, 3000, 60, address(0));
        assertEq(PoolId.unwrap(k1.toId()), PoolId.unwrap(k2.toId()));
        assertEq(PoolId.unwrap(k1.toId()), PoolId.unwrap(ethKey.toId()));
        // Token below WETH sorts as currency0 against WETH.
        PoolKey memory k3 = adapter.poolKey(WETH_ADDR, TOKEN_LOW_ADDR, 3000, 60, address(0));
        assertEq(Currency.unwrap(k3.currency0), TOKEN_LOW_ADDR);
        assertEq(Currency.unwrap(k3.currency1), WETH_ADDR);
    }
}
