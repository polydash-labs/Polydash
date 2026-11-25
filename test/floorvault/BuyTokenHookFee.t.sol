// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

import {PolypadTokenFloorFactory} from "../../src/floorvault/PolypadTokenFloorFactory.sol";
import {PolypadTokenFloorCollection as C} from "../../src/floorvault/PolypadTokenFloorCollection.sol";
import "./Mocks.sol";

/// @notice Faithful mock of PolydashHook's buy-side fee for exact-in swaps.
///  Mirrors the real hook: beforeSwap charges platform+creator fee on the ETH in,
///  takes it from the PoolManager into the hook, and returns it as a positive
///  specified delta (toBeforeSwapDelta(fee, 0)). afterSwap returns 0 for
///  exact-in zeroForOne (handled in beforeSwap), exactly like the real hook.
///  `pools(bytes32)` returns (launch, token, platformBps, creatorBps) so the
///  collection's buyFeeBps() reads the fee instead of falling back to the max.
contract FeeHook {
    IPoolManager public immutable manager;
    PoolKey public key;
    uint256 public platformBps = 20;
    uint256 public creatorBps = 500;

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    receive() external payable {}

    function setKey(PoolKey memory k) external {
        key = k;
    }

    function poolKeyOf(address) external view returns (PoolKey memory) {
        return key;
    }

    function pools(bytes32) external view returns (address, address, uint256, uint256) {
        return (address(0), address(0), platformBps, creatorBps);
    }

    function beforeSwap(address, PoolKey calldata k, IPoolManager.SwapParams calldata params, bytes calldata)
        external
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bool exactIn = params.amountSpecified < 0;
        if (exactIn != params.zeroForOne) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        uint256 amount = uint256(-params.amountSpecified);
        uint256 fee = amount * (platformBps + creatorBps) / 10_000;
        if (fee > 0) {
            manager.take(k.currency0, address(this), fee);
        }
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        return (IHooks.afterSwap.selector, 0);
    }
}

/// @notice Reproduction for the reported buyToken() underflow: does the hook fee
///  charged on top of the swap make pendingEth -= ethIn underflow when
///  pendingEth <= maxBuyEth? The test asserts the CORRECT behavior (buy succeeds,
///  ethIn == the requested amount, pendingEth reduced by exactly that amount).
///  If the report is right, the bug-case test reverts with panic 0x11.
contract BuyTokenHookFeeTest is Test {
    PoolManager pm;
    PoolModifyLiquidityTest lp;
    MockToken tok;
    FeeHook hook;
    MockLaunch launch;
    MockLaunchFactory lfA;
    MockLaunchFactory lfB;
    PolypadTokenFloorFactory f;
    PoolKey key;
    address creator = address(0xC0);
    address alice = address(0xA1);
    address feeWallet = address(0xFEE);
    MockFeeSource feeSrc;

    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    function setUp() public {
        pm = new PoolManager(address(this));
        lp = new PoolModifyLiquidityTest(pm);
        tok = new MockToken();
        hook = _deployFeeHook();
        launch = new MockLaunch(creator, address(tok), address(hook));
        lfA = new MockLaunchFactory();
        lfB = new MockLaunchFactory();
        lfB.add(address(tok), address(launch));
        f = new PolypadTokenFloorFactory(
            address(lfA), address(lfB), address(feeSrc = new MockFeeSource(feeWallet)), address(pm)
        );

        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(tok)), 3000, 60, IHooks(address(hook)));
        hook.setKey(key);
        pm.initialize(key, TickMath.getSqrtPriceAtTick(69_060)); // ~1000 tokens per ETH
        tok.mint(address(this), 1e30);
        tok.approve(address(lp), type(uint256).max);
        vm.deal(address(this), 5000 ether);
        lp.modifyLiquidity{value: 2000 ether}(key, IPoolManager.ModifyLiquidityParams(-887_220, 887_220, 1e22, 0), "");
        vm.deal(alice, 1000 ether);
    }

    receive() external payable {}

    function _deployFeeHook() internal returns (FeeHook h) {
        bytes memory creationCode = type(FeeHook).creationCode;
        bytes memory args = abi.encode(IPoolManager(pm));
        bytes32 initHash = keccak256(abi.encodePacked(creationCode, args));
        for (uint256 i; i < 500_000; ++i) {
            address a = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xFF), address(this), bytes32(i), initHash))))
            );
            if (uint160(a) & 0x3FFF == HOOK_FLAGS) {
                return new FeeHook{salt: bytes32(i)}(pm);
            }
        }
        revert("hook salt not found");
    }

    function _params(uint256 maxBuyEth) internal view returns (PolypadTokenFloorFactory.Params memory p) {
        p = PolypadTokenFloorFactory.Params({
            name: "Moon Floor",
            symbol: "MF",
            imageUri: "ipfs://img",
            description: "d",
            baseURI: "ipfs://b/",
            maxSupply: 1000,
            price: 1 ether,
            floorBps: 2000,
            tokenShareBps: 5000,
            maxSlippageBps: 300,
            maxBuyEth: maxBuyEth,
            royaltyBps: 500,
            maxPerWallet: 100,
            startTime: 0,
            token: address(tok),
            payoutWallet: address(0)
        });
    }

    function _create(uint256 maxBuyEth) internal returns (C c) {
        vm.prank(creator);
        c = C(payable(f.createCollection(_params(maxBuyEth))));
    }

    function _readyBuy(C c) internal {
        launch.setGraduated(true);
        c.observePrice();
        skip(6 minutes);
    }

    /// @notice Report's bug case: 1 mint at 1 ETH -> pendingEth 0.1 ETH, maxBuyEth 10 ETH.
    ///  If the hook fee were charged on top, ethIn would be 0.1052 ETH and
    ///  `pendingEth -= ethIn` would underflow (panic 0x11). Correct behavior:
    ///  the fee comes out of the specified amount, so ethIn == 0.1 ETH exactly.
    function test_buyToken_pendingBelowMaxBuy_withHookFee() public {
        C c = _create(10 ether);
        vm.prank(alice);
        c.mint{value: 1 ether}(1);
        assertEq(c.pendingEth(), 0.1 ether);
        assertEq(c.buyFeeBps(), 520);
        _readyBuy(c);
        (uint256 ethIn, uint256 out) = c.buyToken();
        assertEq(ethIn, 0.1 ether, "ethIn must equal the requested amount, fee included");
        assertEq(c.pendingEth(), 0, "pendingEth fully consumed");
        assertGt(out, 0);
        // the hook really did take its 5.2% fee (proves the fee path fired)
        assertEq(address(hook).balance, 0.1 ether * 520 / 10_000, "hook collected its fee");
        assertEq(c.tokenReserve(), out);
    }

    /// @notice Report's control case: identical state, only maxBuyEth 0.001 ETH.
    function test_buyToken_pendingAboveMaxBuy_withHookFee() public {
        C c = _create(0.001 ether);
        vm.prank(alice);
        c.mint{value: 1 ether}(1);
        assertEq(c.pendingEth(), 0.1 ether);
        _readyBuy(c);
        (uint256 ethIn, uint256 out) = c.buyToken();
        assertEq(ethIn, 0.001 ether, "ethIn must equal the capped amount");
        assertEq(c.pendingEth(), 0.099 ether);
        assertGt(out, 0);
        assertEq(address(hook).balance, 0.001 ether * 520 / 10_000, "hook collected its fee");
    }
}
