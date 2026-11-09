// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFundSwapRouter, IWETH} from "./Interfaces.sol";

/// @notice The part of Uniswap V3 SwapRouter02 this adapter uses.
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function WETH9() external view returns (address);
}

/// @title UniswapV3RouterAdapter (not reviewed, not deployed)
/// @notice Adapts Uniswap V3 SwapRouter02 to the vault's narrow `IFundSwapRouter.swap` interface.
///         SwapRouter02 has no `swap(address,address,uint256,uint256,bytes)` function, so the vault
///         cannot call it directly; it calls this adapter instead, and the adapter calls
///         `exactInputSingle` on the pool. The vault measures its own balances after the call and
///         does not trust the return value, so this adapter only has to deliver the output to the
///         caller (the vault).
///         `data` is `abi.encode(uint24 poolFee)` when non-empty; empty means 3000 (0.3%). The fee
///         must match a pool that exists for the pair, or the swap reverts. Native ETH (`address(0)`)
///         is wrapped to WETH for the pool call and unwrapped on the way back.
contract UniswapV3RouterAdapter is IFundSwapRouter {
    using SafeERC20 for IERC20;

    ISwapRouter02 public immutable router;
    address public immutable weth;

    error BadFee();
    error BadPair();
    error BadAmount();
    error EthSendFailed();

    constructor(address _router, address _weth) {
        if (_router == address(0) || _weth == address(0)) revert BadAmount();
        if (_router.code.length == 0) revert BadAmount();
        router = ISwapRouter02(_router);
        weth = _weth;
        if (router.WETH9() != _weth) revert BadPair();
    }

    /// @notice Called by the vault. Token input arrives as a transfer before the call; ETH input
    ///         arrives as `msg.value`. Output goes back to the caller. No funds stay here.
    function swap(address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        uint24 fee = data.length == 0 ? 3000 : abi.decode(data, (uint24));
        if (fee == 0) revert BadFee();
        address tokenIn = assetIn == address(0) ? weth : assetIn;
        address tokenOut = assetOut == address(0) ? weth : assetOut;
        if (tokenIn == tokenOut) revert BadPair();

        if (assetIn == address(0)) {
            if (msg.value != amountIn) revert BadAmount();
            IWETH(weth).deposit{value: amountIn}();
        } else {
            if (msg.value != 0) revert BadAmount();
            if (IERC20(tokenIn).balanceOf(address(this)) < amountIn) revert BadAmount();
        }
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        amountOut = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );
        if (assetOut == address(0)) {
            IWETH(weth).withdraw(amountOut);
            (bool ok,) = msg.sender.call{value: amountOut}("");
            if (!ok) revert EthSendFailed();
        } else {
            IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        }
    }

    /// @notice Only WETH unwrapping pays this contract. Plain ETH from anywhere else reverts.
    receive() external payable {
        if (msg.sender != weth) revert BadAmount();
    }
}
