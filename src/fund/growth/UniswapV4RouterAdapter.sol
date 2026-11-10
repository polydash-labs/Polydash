// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundSwapRouter, IWETH} from "../phase2/Interfaces.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title UniswapV4RouterAdapter (not reviewed, not deployed)
/// @notice Adapts a single Uniswap V4 pool to the vault's narrow `IFundSwapRouter.swap` interface.
///         PoolManager has no `swap(address,address,uint256,uint256,bytes)` function, so the vault
///         cannot call it directly; it calls this adapter instead, and the adapter swaps through
///         `poolManager.unlock` / `unlockCallback`, copying the settle/take pattern of
///         `PolydashBuybackVault`. The vault measures its own balances after the call and does not
///         trust the return value, so this adapter only has to deliver the output to the caller
///         (the vault). This adapter serves exactly one pool: WETH <-> POLYDASH on Robinhood Chain
///         (WETH is currency0, POLYDASH is currency1). Any other pair reverts.
///
///         `data` is `abi.encode(uint160 sqrtPriceLimitX96)` when non-empty; empty means no price
///         limit (TickMath.MIN_SQRT_PRICE + 1 for buys, MAX_SQRT_PRICE - 1 for sells). An explicit
///         limit must sit on the executable side of the spot price or the call reverts.
///
///         Slippage safety — there is deliberately NO price limit derived from `minAmountOut`:
///         V4's `SwapParams` has no `amountOutMinimum`, and a limit derived from `minAmountOut`
///         would bind the *marginal* price at the end of the swap, which is always worse than the
///         *average* execution price (the price only moves against the trader). For the small,
///         high-impact trades this fund makes against a thin pool, that gap is material, so a
///         derived limit would spuriously revert swaps whose average price was fine. Instead the
///         swap is safe because it is atomic and net-measured:
///           1. The pool swap runs inside `unlock`; the adapter reads the returned `BalanceDelta`
///              and requires the input actually spent to equal `amountIn` exactly (a price limit
///              can only stop a swap early, never over-fill it) and the output to be at least
///              `minAmountOut`, else the whole call reverts and the pool swap rolls back with it.
///              This is the same guarantee V3's `amountOutMinimum` gives, enforced after the fact
///              rather than before it.
///           2. The Phase 3 facet independently re-measures the vault's balances, enforces
///              `minAmountOut` itself, and rejects any execution price outside `maxDeviationBps`
///              of the TWAP feed price (`_checkDeviation`).
///         A caller that wants a hard bound on the price excursion inside the swap can still pass
///         an explicit `sqrtPriceLimitX96` in `data`.
///
///         Dynamic-fee hook — the pool's fee is NOT an adapter input and is never assumed: the
///         pool key carries fee `0x800000` (dynamic), the hook sets the fee per swap (paired fee
///         plus protocol fee, ~120 bps at deployment), and V4 deducts it inside the PoolManager.
///         The adapter only ever looks at the net `BalanceDelta`, so any fee the hook charges —
///         including one that changes between swaps — is automatically accounted for: it shows up
///         as less output, and the `minAmountOut` check rejects the swap if the fee eats too much.
///         Native ETH (`address(0)`) is wrapped to WETH for the pool call and unwrapped on the
///         way back.
contract UniswapV4RouterAdapter is IFundSwapRouter, IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;
    address public immutable weth;
    address public immutable polydash;
    address public immutable hook;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;

    error BadAmount();
    error BadPair();
    error BadPriceLimit();
    error PartialFill();
    error Slippage();
    error EthSendFailed();
    error NotPoolManager();

    constructor(address _poolManager, address _weth, address _polydash, address _hook, uint24 _fee, int24 _tickSpacing) {
        if (_poolManager == address(0) || _weth == address(0) || _polydash == address(0)) revert BadAmount();
        if (_poolManager.code.length == 0) revert BadAmount();
        if (_weth >= _polydash) revert BadPair();
        if (_tickSpacing <= 0) revert BadAmount();
        poolManager = IPoolManager(_poolManager);
        weth = _weth;
        polydash = _polydash;
        hook = _hook;
        fee = _fee;
        tickSpacing = _tickSpacing;
    }

    /// @notice Called by the vault. Token input arrives as a transfer before the call; ETH input
    ///         arrives as `msg.value`. Output goes back to the caller. No funds stay here.
    function swap(address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external
        payable
        override
        nonReentrant
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert BadAmount();
        address tokenIn = assetIn == address(0) ? weth : assetIn;
        address tokenOut = assetOut == address(0) ? weth : assetOut;
        if (tokenIn == tokenOut) revert BadPair();
        bool zeroForOne;
        if (tokenIn == weth && tokenOut == polydash) zeroForOne = true;
        else if (tokenIn == polydash && tokenOut == weth) zeroForOne = false;
        else revert BadPair();
        uint160 sqrtPriceLimitX96 = _priceLimit(data, zeroForOne);

        if (assetIn == address(0)) {
            if (msg.value != amountIn) revert BadAmount();
            IWETH(weth).deposit{value: amountIn}();
        } else {
            if (msg.value != 0) revert BadAmount();
            if (IERC20(tokenIn).balanceOf(address(this)) < amountIn) revert BadAmount();
        }

        (uint256 spent, uint256 got) = abi.decode(
            poolManager.unlock(abi.encode(tokenIn, tokenOut, amountIn, zeroForOne, sqrtPriceLimitX96)),
            (uint256, uint256)
        );
        // A price limit can only stop a swap early (partial fill), never over-fill it. Refuse a
        // partial fill outright: the vault paid for `amountIn` of input and must get all of it
        // swapped, or the whole call reverts and nothing moves.
        if (spent != amountIn) revert PartialFill();
        if (got < minAmountOut) revert Slippage();
        amountOut = got;

        if (assetOut == address(0)) {
            IWETH(weth).withdraw(amountOut);
            (bool ok,) = msg.sender.call{value: amountOut}("");
            if (!ok) revert EthSendFailed();
        } else {
            IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        }
    }

    /// @notice Called by the PoolManager during `unlock`. Only the PoolManager may call it.
    ///         Settles the input (sync / transfer / settle, as in `PolydashBuybackVault`) and
    ///         takes the output to this adapter; `swap` forwards it to the caller. The returned
    ///         delta is net of the pool and hook fees, whatever they are.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address tokenIn, address tokenOut, uint256 amountIn, bool zeroForOne, uint160 sqrtPriceLimitX96) =
            abi.decode(data, (address, address, uint256, bool, uint160));
        BalanceDelta delta = poolManager.swap(
            poolKey(),
            IPoolManager.SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: sqrtPriceLimitX96}),
            ""
        );
        int128 deltaIn = zeroForOne ? delta.amount0() : delta.amount1();
        int128 deltaOut = zeroForOne ? delta.amount1() : delta.amount0();
        if (deltaIn >= 0 || deltaOut <= 0) revert Slippage();
        uint256 spent = uint256(uint128(-deltaIn));
        uint256 got = uint256(uint128(deltaOut));
        if (spent > amountIn) revert Slippage();
        poolManager.sync(Currency.wrap(tokenIn));
        IERC20(tokenIn).safeTransfer(address(poolManager), spent);
        poolManager.settle();
        poolManager.take(Currency.wrap(tokenOut), address(this), got);
        return abi.encode(spent, got);
    }

    /// @notice The pool this adapter serves.
    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(weth), Currency.wrap(polydash), fee, tickSpacing, IHooks(hook));
    }

    /// @notice Id of `poolKey()`.
    function poolId() external view returns (bytes32) {
        return PoolId.unwrap(poolKey().toId());
    }

    /// @notice Current pool sqrt price, for off-chain `sqrtPriceLimitX96` computation.
    function spotSqrtPriceX96() public view returns (uint160 s) {
        (s,,,) = poolManager.getSlot0(poolKey().toId());
    }

    /// @notice Empty `data` means no price limit. Otherwise `data` is one uint160, which must be
    ///         strictly inside (MIN_SQRT_PRICE, MAX_SQRT_PRICE) and on the executable side of the
    ///         spot price (below spot for a buy, above spot for a sell); a limit the price has
    ///         already passed would fill zero and is rejected here with a clear error instead.
    function _priceLimit(bytes calldata data, bool zeroForOne) internal view returns (uint160) {
        if (data.length == 0) {
            return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        }
        if (data.length != 32) revert BadPriceLimit();
        uint160 limit = abi.decode(data, (uint160));
        if (limit <= TickMath.MIN_SQRT_PRICE || limit >= TickMath.MAX_SQRT_PRICE) revert BadPriceLimit();
        uint160 spot = spotSqrtPriceX96();
        if (zeroForOne) {
            if (limit >= spot) revert BadPriceLimit();
        } else {
            if (limit <= spot) revert BadPriceLimit();
        }
        return limit;
    }

    /// @notice Only WETH unwrapping pays this contract. Plain ETH from anywhere else reverts.
    receive() external payable {
        if (msg.sender != weth) revert BadAmount();
    }
}
