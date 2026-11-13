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

/// @title GenericV4RouterAdapter (not reviewed, not deployed)
/// @notice Adapts ANY Uniswap V4 pool to the vault's narrow `IFundSwapRouter.swap`
///         interface. PoolManager has no `swap(address,address,uint256,uint256,bytes)`
///         function, so the vault cannot call it directly; it calls this adapter
///         instead, and the adapter swaps through `poolManager.unlock` /
///         `unlockCallback`, copying the settle/take pattern of
///         `PolydashBuybackVault`. The vault measures its own balances after the call
///         and does not trust the return value, so this adapter only has to deliver
///         the output to the caller (the vault).
///
///         Unlike `UniswapV4RouterAdapter` (one pool: WETH <-> POLYDASH, key in
///         immutables), this adapter takes the pool key per call in `data`, the same
///         way the generic V3 adapter takes the fee tier per call. Onboarding a new
///         token needs only a feed deploy + a `proposeAsset` call: no new adapter,
///         no new contract. The pool is identified by:
///
///         `data` = `abi.encode(address quote, uint24 fee, int24 tickSpacing,
///         address hook, uint160 sqrtPriceLimitX96)`
///           - `quote`: the pool's quote currency — `address(0)` for native ETH,
///             the WETH address for a WETH pool, the USDG address for a USDG pool,
///             or any ERC20 the vault holds. The other pool currency is the asset
///             (the non-quote side of `assetIn` / `assetOut`).
///           - `fee`, `tickSpacing`, `hook`: the PoolKey fields.
///           - `sqrtPriceLimitX96`: `0` means no limit (the min/max default for the
///             direction); otherwise an explicit limit, which must sit on the
///             executable side of the spot price or the call reverts.
///
///         Native ETH. The vault holds ETH and WETH and the facet measures the two
///         together, so the adapter converts freely between them at 1:1:
///           - A pool quoted in native ETH takes ETH: when the vault sends WETH the
///             adapter unwraps it to ETH before the pool call, and when the pool
///             pays out ETH for a sell the adapter wraps it to WETH if the vault
///             asked for WETH (or sends ETH if the vault asked for ETH).
///           - A pool quoted in WETH takes WETH: when the vault sends ETH the adapter
///             wraps it, and when the pool pays out WETH the adapter unwraps it if
///             the vault asked for ETH.
///         Either currency ordering works: the pool key is built by sorting the two
///         currencies (native ETH, `address(0)`, sorts below every token), and
///         `zeroForOne` follows from which side the input is on. There is no
///         assumption that the quote sorts below the asset (TORCH and FOBO both sort
///         below WETH and would have reverted the old adapter's constructor).
///
///         Taxes and hooks, generically. No per-token special cases: the adapter
///         only ever looks at net amounts, and measures what actually arrived.
///           - Hook fees (e.g. FOBO's 2.5% hook tax, charged on the quote side) are
///             already netted into the `BalanceDelta` the PoolManager returns: the
///             input the caller owes is the full `amountIn`, the output is reduced
///             by the fee, and the `minAmountOut` check rejects the swap if the fee
///             eats too much. The facet's 5% deviation check is the second backstop.
///           - Fee-on-transfer outputs (e.g. TORCH's 2% buy tax, taken by the token
///             contract when the pool pays the buyer) make the delta overstate what
///             the adapter actually receives. The adapter measures its own balance
///             increase around the pool's `take` and delivers THAT to the caller;
///             `minAmountOut` is enforced against the measured amount, and the
///             return value is the measured amount. The old adapter would have
///             reverted here (it tried to transfer the delta amount it did not hold).
///           - The input leg uses the adapter's actual balance, not the nominal
///             `amountIn`: if the vault-to-adapter transfer was taxed, the adapter
///             swaps what it actually holds and requires the pool to consume exactly
///             that (a price limit can only stop a swap early, never over-fill it).
///
///         Known limitation (documented, not hidden): a token that levies a transfer
///         fee on transfers INTO the pool — i.e. the sell leg's `settle`, where the
///         adapter pays the pool — cannot be sold through this adapter, because the
///         pool would receive less than the swap's input delta and `settle` would
///         revert. Serving such a token needs a pre-fund pattern (transfer first,
///         measure what the pool received, swap with that net amount). None of the
///         tokens onboarded so far has this property: TORCH's tax is buy-only
///         (verified on a mainnet fork: the sell leg settles in full), FOBO's tax
///         is a hook tax, not a token transfer fee, and TIBBIR / HOOKR are plain
///         ERC20s. A USDG-quoted pool is routable when the vault sends USDG; the
///         current vault holds only ETH/WETH, so a USDG pool additionally needs a
///         two-hop (WETH -> USDG -> asset) or a USDG holding, which this
///         single-pool adapter does not do.
///
///         Slippage safety — there is deliberately NO price limit derived from
///         `minAmountOut`: V4's `SwapParams` has no `amountOutMinimum`, and a limit
///         derived from `minAmountOut` would bind the *marginal* price at the end of
///         the swap, which is always worse than the *average* execution price (the
///         price only moves against the trader). For the small, high-impact trades
///         this fund makes against thin pools, that gap is material, so a derived
///         limit would spuriously revert swaps whose average price was fine. Instead
///         the swap is safe because it is atomic and net-measured:
///           1. The pool swap runs inside `unlock`; the adapter requires the input
///              actually spent to equal the input it requested, and the output
///              actually received to be at least `minAmountOut`, else the whole call
///              reverts and the pool swap rolls back with it. This is the same
///              guarantee V3's `amountOutMinimum` gives, enforced after the fact
///              rather than before it.
///           2. The Phase 3 facet independently re-measures the vault's balances,
///              enforces `minAmountOut` itself, and rejects any execution price
///              outside `maxDeviationBps` of the TWAP feed price (`_checkDeviation`).
///         A caller that wants a hard bound on the price excursion inside the swap
///         can still pass an explicit `sqrtPriceLimitX96` in `data`.
contract GenericV4RouterAdapter is IFundSwapRouter, IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;
    address public immutable weth;

    error BadAmount();
    error BadPair();
    error BadData();
    error BadPriceLimit();
    error PartialFill();
    error Slippage();
    error EthSendFailed();
    error NotPoolManager();

    constructor(address _poolManager, address _weth) {
        if (_poolManager == address(0) || _weth == address(0)) revert BadAmount();
        if (_poolManager.code.length == 0) revert BadAmount();
        poolManager = IPoolManager(_poolManager);
        weth = _weth;
    }

    /// @notice Called by the vault. Token input arrives as a transfer before the call;
    ///         ETH input arrives as `msg.value`. Output goes back to the caller. No
    ///         funds stay here. `data` carries the pool key (see the contract NatSpec).
    function swap(address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external
        payable
        override
        nonReentrant
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert BadAmount();
        if (data.length != 160) revert BadData();
        (address quote, uint24 fee, int24 tickSpacing, address hook, uint160 priceLimit) =
            abi.decode(data, (address, uint24, int24, address, uint160));
        if (fee != 0x800000 && fee > 1_000_000) revert BadData();
        if (tickSpacing <= 0) revert BadData();

        // Identify the pool's two currencies and the direction. The quote side is
        // the `quote` from `data`, with ETH and WETH interchangeable (the vault
        // holds both and the facet measures them together).
        bool inIsQuote = _isQuoteSide(assetIn, quote);
        bool outIsQuote = _isQuoteSide(assetOut, quote);
        if (inIsQuote == outIsQuote) revert BadPair();
        bool buying = inIsQuote;
        address asset = buying ? assetOut : assetIn;
        address poolIn = buying ? quote : asset;
        address poolOut = buying ? asset : quote;
        if (poolIn == poolOut) revert BadPair();

        PoolKey memory key = _key(poolIn, poolOut, fee, tickSpacing, hook);
        bool zeroForOne = poolIn == Currency.unwrap(key.currency0);
        uint160 sqrtPriceLimitX96 = _priceLimit(key, priceLimit, zeroForOne);

        // Bring the input into the pool's input currency. ETH and WETH convert
        // 1:1; any other currency must already match.
        uint256 actualIn = _fundInput(assetIn, poolIn, amountIn);

        (uint256 spent, uint256 got) = abi.decode(
            poolManager.unlock(abi.encode(key, zeroForOne, actualIn, sqrtPriceLimitX96)),
            (uint256, uint256)
        );
        // A price limit can only stop a swap early (partial fill), never over-fill
        // it. Refuse a partial fill outright: the adapter asked for `actualIn` of
        // input and must get all of it swapped, or the whole call reverts.
        if (spent != actualIn) revert PartialFill();
        if (got < minAmountOut) revert Slippage();
        amountOut = got;

        _payOutput(assetOut, poolOut, amountOut);
    }

    /// @notice Called by the PoolManager during `unlock`. Only the PoolManager may call it.
    ///         Settles the input (sync / transfer / settle, as in `PolydashBuybackVault`)
    ///         and takes the output to this adapter; `swap` forwards it to the caller.
    ///         The returned `got` is the output actually received (balance-measured
    ///         around the `take`), not the delta: a fee-on-transfer output token
    ///         delivers less than the delta, and the adapter only ever holds — and
    ///         only ever pays out — what actually arrived.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, uint160 sqrtPriceLimitX96) =
            abi.decode(data, (PoolKey, bool, uint256, uint160));
        BalanceDelta delta = poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
            ""
        );
        int128 deltaIn = zeroForOne ? delta.amount0() : delta.amount1();
        int128 deltaOut = zeroForOne ? delta.amount1() : delta.amount0();
        if (deltaIn >= 0 || deltaOut <= 0) revert Slippage();
        uint256 spent = uint256(uint128(-deltaIn));
        uint256 deltaGot = uint256(uint128(deltaOut));
        if (spent > amountIn) revert Slippage();
        address tokenIn = Currency.unwrap(zeroForOne ? key.currency0 : key.currency1);
        address tokenOut = Currency.unwrap(zeroForOne ? key.currency1 : key.currency0);
        _settle(tokenIn, spent);
        uint256 got = _takeMeasured(tokenOut, deltaGot);
        return abi.encode(spent, got);
    }

    /// @notice The pool key for a currency pair, fee, tick spacing and hook.
    /// @dev The currencies are sorted (native ETH, `address(0)`, sorts lowest), so
    ///      the caller never has to know which side a token is on.
    function poolKey(address currencyA, address currencyB, uint24 fee, int24 tickSpacing, address hook)
        public
        pure
        returns (PoolKey memory)
    {
        return _key(currencyA, currencyB, fee, tickSpacing, hook);
    }

    /// @notice Id of a pool key built by `poolKey`.
    function poolId(address currencyA, address currencyB, uint24 fee, int24 tickSpacing, address hook)
        external
        pure
        returns (bytes32)
    {
        return PoolId.unwrap(_key(currencyA, currencyB, fee, tickSpacing, hook).toId());
    }

    /// @notice Current pool sqrt price for a key, for off-chain `sqrtPriceLimitX96`
    ///         computation.
    function spotSqrtPriceX96(address currencyA, address currencyB, uint24 fee, int24 tickSpacing, address hook)
        public
        view
        returns (uint160 s)
    {
        (s,,,) = poolManager.getSlot0(_key(currencyA, currencyB, fee, tickSpacing, hook).toId());
    }

    function _key(address currencyA, address currencyB, uint24 fee, int24 tickSpacing, address hook)
        internal
        pure
        returns (PoolKey memory)
    {
        (address c0, address c1) = currencyA < currencyB ? (currencyA, currencyB) : (currencyB, currencyA);
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), fee, tickSpacing, IHooks(hook));
    }

    /// @notice True when `addr` is the pool's quote side: the quote itself, or ETH /
    ///         WETH when the quote is ETH or WETH (the two are the same asset here).
    function _isQuoteSide(address addr, address quote) internal view returns (bool) {
        if (addr == quote) return true;
        if (quote == address(0) || quote == weth) {
            return addr == address(0) || addr == weth;
        }
        return false;
    }

    /// @notice Bring the vault's input into the pool's input currency and return the
    ///         amount actually held. ETH input arrives as `msg.value`; ERC20 input
    ///         was transferred before the call and may be less than `amountIn` when
    ///         the token taxes the transfer — the adapter swaps what it holds.
    function _fundInput(address assetIn, address poolIn, uint256 amountIn) internal returns (uint256 actualIn) {
        if (assetIn == address(0)) {
            if (msg.value != amountIn) revert BadAmount();
            if (poolIn == address(0)) return amountIn;
            if (poolIn == weth) {
                IWETH(weth).deposit{value: amountIn}();
                return amountIn;
            }
            revert BadPair();
        }
        if (msg.value != 0) revert BadAmount();
        if (assetIn == poolIn) {
            uint256 bal = IERC20(assetIn).balanceOf(address(this));
            if (bal == 0) revert BadAmount();
            return bal < amountIn ? bal : amountIn;
        }
        // The vault sent WETH and the pool takes native ETH (or vice versa).
        if (assetIn == weth && poolIn == address(0)) {
            uint256 bal = IERC20(weth).balanceOf(address(this));
            if (bal < amountIn) revert BadAmount();
            IWETH(weth).withdraw(amountIn);
            return amountIn;
        }
        if (assetIn == address(0)) revert BadAmount(); // unreachable: handled above
        revert BadPair();
    }

    /// @notice Pay the output to the caller in the currency it asked for, converting
    ///         between ETH and WETH 1:1 when the pool paid the other one.
    function _payOutput(address assetOut, address poolOut, uint256 amountOut) internal {
        if (assetOut == poolOut) {
            if (assetOut == address(0)) {
                (bool ok,) = msg.sender.call{value: amountOut}("");
                if (!ok) revert EthSendFailed();
            } else {
                IERC20(poolOut).safeTransfer(msg.sender, amountOut);
            }
            return;
        }
        if (poolOut == address(0) && assetOut == weth) {
            IWETH(weth).deposit{value: amountOut}();
            IERC20(weth).safeTransfer(msg.sender, amountOut);
            return;
        }
        if (poolOut == weth && assetOut == address(0)) {
            IWETH(weth).withdraw(amountOut);
            (bool ok,) = msg.sender.call{value: amountOut}("");
            if (!ok) revert EthSendFailed();
            return;
        }
        revert BadPair();
    }

    /// @notice Settle the pool's input delta. Native ETH is paid as `msg.value`;
    ///         an ERC20 is transferred to the PoolManager first.
    function _settle(address tokenIn, uint256 spent) internal {
        poolManager.sync(Currency.wrap(tokenIn));
        if (tokenIn == address(0)) {
            poolManager.settle{value: spent}();
        } else {
            IERC20(tokenIn).safeTransfer(address(poolManager), spent);
            poolManager.settle();
        }
    }

    /// @notice Take `deltaGot` of `tokenOut` from the pool and return what actually
    ///         arrived (the balance increase), which is less than the delta when the
    ///         token taxes the transfer.
    function _takeMeasured(address tokenOut, uint256 deltaGot) internal returns (uint256 got) {
        uint256 before;
        if (tokenOut == address(0)) {
            before = address(this).balance;
            poolManager.take(Currency.wrap(tokenOut), address(this), deltaGot);
            got = address(this).balance - before;
        } else {
            before = IERC20(tokenOut).balanceOf(address(this));
            poolManager.take(Currency.wrap(tokenOut), address(this), deltaGot);
            got = IERC20(tokenOut).balanceOf(address(this)) - before;
        }
        if (got == 0) revert Slippage();
    }

    /// @notice Empty `data` price limit (0) means no limit. Otherwise the limit must
    ///         be strictly inside (MIN_SQRT_PRICE, MAX_SQRT_PRICE) and on the
    ///         executable side of the spot price (below spot for a buy, above spot for
    ///         a sell); a limit the price has already passed would fill zero and is
    ///         rejected here with a clear error instead.
    function _priceLimit(PoolKey memory key, uint160 priceLimit, bool zeroForOne)
        internal
        view
        returns (uint160)
    {
        if (priceLimit == 0) {
            return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        }
        if (priceLimit <= TickMath.MIN_SQRT_PRICE || priceLimit >= TickMath.MAX_SQRT_PRICE) {
            revert BadPriceLimit();
        }
        (uint160 spot,,,) = poolManager.getSlot0(key.toId());
        if (zeroForOne) {
            if (priceLimit >= spot) revert BadPriceLimit();
        } else {
            if (priceLimit <= spot) revert BadPriceLimit();
        }
        return priceLimit;
    }

    /// @notice Only WETH unwrapping and the PoolManager's ETH `take` pay this
    ///         contract. Plain ETH from anywhere else reverts.
    receive() external payable {
        if (msg.sender != weth && msg.sender != address(poolManager)) revert BadAmount();
    }
}
