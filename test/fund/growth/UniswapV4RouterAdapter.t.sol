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
import {UniswapV4RouterAdapter} from "../../../src/fund/growth/UniswapV4RouterAdapter.sol";
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

/// @notice Unit coverage for the V4 adapter against a local PoolManager (no hook, 3000 fee,
///         60 tick spacing): the swap translation, the `data` price-limit encoding, the
///         minAmountOut / partial-fill guards, and the no-funds-left-behind invariant.
contract UniswapV4RouterAdapterTest is Test {
    using PoolIdLibrary for PoolKey;

    IPoolManager pm;
    IPoolModifyLiquidityTest lp;
    MockWETH weth;
    MockERC20 polydash;
    PoolKey key;
    UniswapV4RouterAdapter adapter;

    // Fixed addresses so WETH < POLYDASH, as a V4 pool key requires.
    address constant WETH_ADDR = 0x1000000000000000000000000000000000000001;
    address constant POLYDASH_ADDR = 0x2000000000000000000000000000000000000002;

    function setUp() public {
        // PoolManager is `pragma solidity 0.8.26`, which this 0.8.24 test file cannot import,
        // so both it and the liquidity helper are deployed from their compiled artifacts (built
        // by the buyback tests' 0.8.26 job) via `deployCode`.
        pm = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(address(this))));
        lp = IPoolModifyLiquidityTest(
            deployCode("PoolModifyLiquidityTest.sol:PoolModifyLiquidityTest", abi.encode(address(pm)))
        );
        deployCodeTo("test/fund/growth/UniswapV4RouterAdapter.t.sol:MockWETH", WETH_ADDR);
        deployCodeTo(
            "test/mocks/MockERC20.sol:MockERC20", abi.encode("Polydash", "POLYDASH", uint256(0)), POLYDASH_ADDR
        );
        weth = MockWETH(payable(WETH_ADDR));
        polydash = MockERC20(POLYDASH_ADDR);

        key = PoolKey(Currency.wrap(WETH_ADDR), Currency.wrap(POLYDASH_ADDR), 3000, 60, IHooks(address(0)));
        // ~1000 POLYDASH per WETH, as in the buyback tests.
        pm.initialize(key, TickMath.getSqrtPriceAtTick(69_060));
        vm.deal(address(this), 1000 ether);
        weth.deposit{value: 1000 ether}();
        weth.approve(address(lp), type(uint256).max);
        polydash.approve(address(lp), type(uint256).max);
        lp.modifyLiquidity(key, IPoolManager.ModifyLiquidityParams(-887_220, 887_220, 1e22, 0), "");

        adapter = new UniswapV4RouterAdapter(address(pm), WETH_ADDR, POLYDASH_ADDR, address(0), 3000, 60);
        vm.deal(address(this), 1000 ether);
    }

    receive() external payable {}

    function test_constructor_rejects_zero_addresses() public {
        vm.expectRevert(UniswapV4RouterAdapter.BadAmount.selector);
        new UniswapV4RouterAdapter(address(0), WETH_ADDR, POLYDASH_ADDR, address(0), 3000, 60);
        vm.expectRevert(UniswapV4RouterAdapter.BadAmount.selector);
        new UniswapV4RouterAdapter(address(pm), address(0), POLYDASH_ADDR, address(0), 3000, 60);
        vm.expectRevert(UniswapV4RouterAdapter.BadAmount.selector);
        new UniswapV4RouterAdapter(address(pm), WETH_ADDR, address(0), address(0), 3000, 60);
    }

    function test_constructor_rejects_manager_without_code() public {
        vm.expectRevert(UniswapV4RouterAdapter.BadAmount.selector);
        new UniswapV4RouterAdapter(address(0x1234), WETH_ADDR, POLYDASH_ADDR, address(0), 3000, 60);
    }

    function test_constructor_rejects_reversed_currency_order() public {
        vm.expectRevert(UniswapV4RouterAdapter.BadPair.selector);
        new UniswapV4RouterAdapter(address(pm), POLYDASH_ADDR, WETH_ADDR, address(0), 3000, 60);
    }

    function test_constructor_rejects_zero_tick_spacing() public {
        vm.expectRevert(UniswapV4RouterAdapter.BadAmount.selector);
        new UniswapV4RouterAdapter(address(pm), WETH_ADDR, POLYDASH_ADDR, address(0), 3000, 0);
    }

    function test_pool_key_and_id() public view {
        PoolKey memory k = adapter.poolKey();
        assertEq(Currency.unwrap(k.currency0), WETH_ADDR);
        assertEq(Currency.unwrap(k.currency1), POLYDASH_ADDR);
        assertEq(k.fee, 3000);
        assertEq(k.tickSpacing, 60);
        assertEq(address(k.hooks), address(0));
        assertEq(adapter.poolId(), PoolId.unwrap(key.toId()));
    }

    function test_spot_price_matches_initialization() public view {
        assertEq(adapter.spotSqrtPriceX96(), TickMath.getSqrtPriceAtTick(69_060));
    }

    function test_eth_in_buys_polydash() public {
        uint256 before = polydash.balanceOf(address(this));
        uint256 out = adapter.swap{value: 1 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, "");
        assertGt(out, 0);
        assertEq(polydash.balanceOf(address(this)), before + out);
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(polydash.balanceOf(address(adapter)), 0);
        // ~1000 POLYDASH per WETH at a 0.3% fee: wide band for price impact.
        assertGt(out, 900 ether);
        assertLt(out, 1100 ether);
    }

    function test_weth_in_buys_polydash() public {
        weth.transfer(address(adapter), 1 ether);
        uint256 before = polydash.balanceOf(address(this));
        uint256 out = adapter.swap(WETH_ADDR, POLYDASH_ADDR, 1 ether, 1, "");
        assertGt(out, 900 ether);
        assertLt(out, 1100 ether);
        assertEq(polydash.balanceOf(address(this)), before + out);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(polydash.balanceOf(address(adapter)), 0);
    }

    function test_polydash_in_sells_for_weth() public {
        polydash.transfer(address(adapter), 1000 ether);
        uint256 before = weth.balanceOf(address(this));
        uint256 out = adapter.swap(POLYDASH_ADDR, WETH_ADDR, 1000 ether, 1, "");
        assertGt(out, 0.9 ether);
        assertLt(out, 1.1 ether);
        assertEq(weth.balanceOf(address(this)), before + out);
        assertEq(polydash.balanceOf(address(adapter)), 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
    }

    function test_polydash_in_sells_for_eth() public {
        polydash.transfer(address(adapter), 1000 ether);
        uint256 before = address(this).balance;
        uint256 out = adapter.swap(POLYDASH_ADDR, address(0), 1000 ether, 1, "");
        assertGt(out, 0.9 ether);
        assertLt(out, 1.1 ether);
        assertEq(address(this).balance, before + out);
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(polydash.balanceOf(address(adapter)), 0);
    }

    function test_min_amount_out_enforced() public {
        // 1 ETH buys ~1000 POLYDASH; demanding 2000 must revert and move nothing.
        vm.expectRevert(UniswapV4RouterAdapter.Slippage.selector);
        adapter.swap{value: 1 ether}(address(0), POLYDASH_ADDR, 1 ether, 2000 ether, "");
        assertEq(polydash.balanceOf(address(adapter)), 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
    }

    function test_bad_pair_reverts() public {
        vm.expectRevert(UniswapV4RouterAdapter.BadPair.selector);
        adapter.swap{value: 1 ether}(address(0), address(0), 1 ether, 1, "");
        address stranger = address(0x9999);
        vm.expectRevert(UniswapV4RouterAdapter.BadPair.selector);
        adapter.swap{value: 1 ether}(address(0), stranger, 1 ether, 1, "");
        vm.expectRevert(UniswapV4RouterAdapter.BadPair.selector);
        adapter.swap(stranger, POLYDASH_ADDR, 1 ether, 1, "");
    }

    function test_eth_input_wrong_msg_value_reverts() public {
        vm.expectRevert(UniswapV4RouterAdapter.BadAmount.selector);
        adapter.swap{value: 0.5 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, "");
        vm.expectRevert(UniswapV4RouterAdapter.BadAmount.selector);
        adapter.swap{value: 2 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, "");
    }

    function test_token_input_with_msg_value_reverts() public {
        polydash.transfer(address(adapter), 1000 ether);
        vm.expectRevert(UniswapV4RouterAdapter.BadAmount.selector);
        adapter.swap{value: 1 wei}(POLYDASH_ADDR, WETH_ADDR, 1000 ether, 1, "");
    }

    function test_token_input_without_prefunding_reverts() public {
        vm.expectRevert(UniswapV4RouterAdapter.BadAmount.selector);
        adapter.swap(POLYDASH_ADDR, WETH_ADDR, 1000 ether, 1, "");
    }

    function test_zero_amount_reverts() public {
        vm.expectRevert(UniswapV4RouterAdapter.BadAmount.selector);
        adapter.swap{value: 0}(address(0), POLYDASH_ADDR, 0, 1, "");
    }

    function test_explicit_limit_with_room_succeeds() public {
        uint160 spot = adapter.spotSqrtPriceX96();
        uint160 limit = uint160((uint256(spot) * 90) / 100);
        uint256 out = adapter.swap{value: 1 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, abi.encode(limit));
        assertGt(out, 900 ether);
    }

    function test_explicit_limit_too_tight_reverts() public {
        uint160 spot = adapter.spotSqrtPriceX96();
        // One wei below spot: the swap cannot move the price at all, so it fills zero
        // (Slippage from the callback) or partially (PartialFill from swap). Either way it
        // reverts and nothing moves.
        vm.expectRevert();
        adapter.swap{value: 1 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, abi.encode(spot - 1));
        assertEq(polydash.balanceOf(address(adapter)), 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
    }

    function test_explicit_limit_wrong_side_reverts() public {
        uint160 spot = adapter.spotSqrtPriceX96();
        vm.expectRevert(UniswapV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap{value: 1 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, abi.encode(spot));
        vm.expectRevert(UniswapV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap{value: 1 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, abi.encode(spot + 1));
        polydash.transfer(address(adapter), 1000 ether);
        vm.expectRevert(UniswapV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap(POLYDASH_ADDR, WETH_ADDR, 1000 ether, 1, abi.encode(spot));
        vm.expectRevert(UniswapV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap(POLYDASH_ADDR, WETH_ADDR, 1000 ether, 1, abi.encode(spot - 1));
    }

    function test_explicit_limit_malformed_reverts() public {
        vm.expectRevert(UniswapV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap{value: 1 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, abi.encode(uint128(1)));
        vm.expectRevert(UniswapV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap{value: 1 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, abi.encode(TickMath.MIN_SQRT_PRICE));
        vm.expectRevert(UniswapV4RouterAdapter.BadPriceLimit.selector);
        adapter.swap{value: 1 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, abi.encode(TickMath.MAX_SQRT_PRICE));
    }

    function test_adapter_holds_nothing_after_round_trip() public {
        adapter.swap{value: 1 ether}(address(0), POLYDASH_ADDR, 1 ether, 1, "");
        uint256 got = polydash.balanceOf(address(this));
        polydash.transfer(address(adapter), got);
        adapter.swap(POLYDASH_ADDR, address(0), got, 1, "");
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(polydash.balanceOf(address(adapter)), 0);
    }

    function test_receive_rejects_plain_eth() public {
        (bool ok,) = address(adapter).call{value: 1 wei}("");
        assertFalse(ok);
    }

    function test_unlock_callback_only_pool_manager() public {
        vm.expectRevert(UniswapV4RouterAdapter.NotPoolManager.selector);
        adapter.unlockCallback("");
    }
}

/// @notice Fork coverage for the real pool: the deployed POLYDASH/WETH Uniswap V4 pool on
///         Robinhood Chain (chain 4663), reached through UniswapV4RouterAdapter. Nothing is
///         broadcast; state changes exist only on the local fork.
///         Run with: `forge test --match-path test/fund/growth/UniswapV4RouterAdapter.t.sol
///         --fork-url https://robinhood.drpc.org --fork-block-number 110526500 -vvv`
///         (the official public RPC cannot serve historical state; dRPC can). FORK_RPC is also
///         honoured. Without a fork the tests skip: plain `forge test` stays offline.
contract UniswapV4RouterAdapterForkTest is Test {
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address constant HOOK = 0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc;
    uint24 constant FEE = 0x800000; // dynamic-fee hook
    int24 constant TICK_SPACING = 200;
    /// @dev Verified on-chain: poolKey().toId() for the key above, and the poolId in the brief.
    bytes32 constant POOL_ID = 0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5;
    /// @dev Pinned fork block, verified 2026-11-09: dRPC serves state at this block (hook
    ///      pairedFee reads 10000 pips, protocolFee 2000 pips). Re-pin if dRPC ever prunes it.
    uint256 constant FORK_BLOCK = 110_526_500;
    string constant DRPC = "https://robinhood.drpc.org";

    UniswapV4RouterAdapter adapter;
    bool internal on;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            if (block.chainid != 4663) return; // no fork: skip
            rpc = DRPC; // launched with --fork-url: re-pin to FORK_BLOCK
        }
        vm.createSelectFork(rpc, FORK_BLOCK);
        on = true;
        adapter = new UniswapV4RouterAdapter(POOL_MANAGER, WETH, POLYDASH, HOOK, FEE, TICK_SPACING);
        vm.deal(address(this), 10 ether);
    }

    receive() external payable {}

    /// @notice Spot-implied output for `amountIn` at the current sqrt price, before fees and
    ///         price impact. Both tokens are 18 decimals, so no scaling is needed.
    function _spotImpliedOut(uint256 amountIn, bool buying) internal view returns (uint256) {
        uint160 spot = adapter.spotSqrtPriceX96();
        uint256 q96 = uint256(1) << 96;
        if (buying) {
            return Math.mulDiv(Math.mulDiv(amountIn, spot, q96), spot, q96);
        }
        return Math.mulDiv(Math.mulDiv(amountIn, q96, spot), q96, spot);
    }

    function test_fork_pool_id_and_fee_match_record() public view {
        if (!on) return;
        assertEq(adapter.poolId(), POOL_ID);
        assertEq(adapter.fee(), FEE);
        assertEq(adapter.tickSpacing(), TICK_SPACING);
        assertEq(adapter.hook(), HOOK);
        assertGt(adapter.spotSqrtPriceX96(), 0);
    }

    function test_fork_buy_eth_for_polydash() public {
        if (!on) return;
        uint256 implied = _spotImpliedOut(0.001 ether, true);
        assertGt(implied, 0);
        uint256 minOut = (implied * 50) / 100;
        uint256 before = IERC20(POLYDASH).balanceOf(address(this));
        uint256 out = adapter.swap{value: 0.001 ether}(address(0), POLYDASH, 0.001 ether, minOut, "");
        assertGe(out, minOut);
        // Real output is below the zero-fee, zero-impact implied output; allow 1% for rounding.
        assertLe(out, (implied * 101) / 100);
        assertEq(IERC20(POLYDASH).balanceOf(address(this)), before + out);
        assertEq(address(adapter).balance, 0);
        assertEq(IERC20(WETH).balanceOf(address(adapter)), 0);
        assertEq(IERC20(POLYDASH).balanceOf(address(adapter)), 0);
    }

    function test_fork_sell_polydash_for_eth() public {
        if (!on) return;
        uint256 out = adapter.swap{value: 0.001 ether}(address(0), POLYDASH, 0.001 ether, 1, "");
        assertGt(out, 0);
        IERC20(POLYDASH).transfer(address(adapter), out);
        uint256 implied = _spotImpliedOut(out, false);
        uint256 minOut = (implied * 50) / 100;
        uint256 ethBefore = address(this).balance;
        uint256 ethOut = adapter.swap(POLYDASH, address(0), out, minOut, "");
        assertGe(ethOut, minOut);
        assertLe(ethOut, (implied * 101) / 100);
        assertEq(address(this).balance, ethBefore + ethOut);
        assertEq(IERC20(POLYDASH).balanceOf(address(this)), 0);
        assertEq(IERC20(POLYDASH).balanceOf(address(adapter)), 0);
        assertEq(IERC20(WETH).balanceOf(address(adapter)), 0);
        assertEq(address(adapter).balance, 0);
    }

    function test_fork_buy_with_weth_and_sell_for_weth() public {
        if (!on) return;
        MockWETH weth = MockWETH(payable(WETH));
        weth.deposit{value: 0.001 ether}();
        weth.transfer(address(adapter), 0.001 ether);
        uint256 impliedBuy = _spotImpliedOut(0.001 ether, true);
        uint256 bought = adapter.swap(WETH, POLYDASH, 0.001 ether, (impliedBuy * 50) / 100, "");
        assertGt(bought, 0);
        IERC20(POLYDASH).transfer(address(adapter), bought);
        uint256 impliedSell = _spotImpliedOut(bought, false);
        uint256 wethBefore = weth.balanceOf(address(this));
        uint256 sold = adapter.swap(POLYDASH, WETH, bought, (impliedSell * 50) / 100, "");
        assertGt(sold, 0);
        assertEq(weth.balanceOf(address(this)), wethBefore + sold);
        assertEq(IERC20(POLYDASH).balanceOf(address(this)), 0);
        assertEq(IERC20(POLYDASH).balanceOf(address(adapter)), 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
    }

    function test_fork_min_amount_out_enforced() public {
        if (!on) return;
        uint256 implied = _spotImpliedOut(0.001 ether, true);
        vm.expectRevert(UniswapV4RouterAdapter.Slippage.selector);
        adapter.swap{value: 0.001 ether}(address(0), POLYDASH, 0.001 ether, implied * 10, "");
        assertEq(IERC20(POLYDASH).balanceOf(address(adapter)), 0);
        assertEq(IERC20(WETH).balanceOf(address(adapter)), 0);
    }

    function test_fork_explicit_limit_with_room_succeeds() public {
        if (!on) return;
        uint160 spot = adapter.spotSqrtPriceX96();
        uint160 limit = uint160((uint256(spot) * 95) / 100);
        uint256 implied = _spotImpliedOut(0.001 ether, true);
        uint256 out = adapter.swap{value: 0.001 ether}(
            address(0), POLYDASH, 0.001 ether, (implied * 50) / 100, abi.encode(limit)
        );
        assertGt(out, 0);
    }

    function test_fork_explicit_limit_too_tight_reverts() public {
        if (!on) return;
        uint160 spot = adapter.spotSqrtPriceX96();
        uint256 implied = _spotImpliedOut(0.001 ether, true);
        // One wei below spot: fills zero (Slippage) or partially (PartialFill). Either way the
        // swap reverts and nothing moves.
        vm.expectRevert();
        adapter.swap{value: 0.001 ether}(address(0), POLYDASH, 0.001 ether, (implied * 50) / 100, abi.encode(spot - 1));
        assertEq(IERC20(POLYDASH).balanceOf(address(adapter)), 0);
        assertEq(IERC20(WETH).balanceOf(address(adapter)), 0);
    }
}
