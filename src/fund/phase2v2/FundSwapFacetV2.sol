// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundSwapRouterV2, IFundUnitV2, IWETHV2} from "./Interfaces.sol";
import {FundV2Store} from "./FundV2Store.sol";

/// @title FundSwapFacetV2 (not reviewed, not deployed)
/// @notice Swap body for a v2 vault. Direct calls revert. `navAfter` on `Trade` is quote NAV, not cost basis.
contract FundSwapFacetV2 is ReentrancyGuard, FundV2Store {
    using SafeERC20 for IERC20;

    address public immutable self;

    constructor() {
        self = address(this);
    }

    function swap(
        address router,
        address assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external {
        if (address(this) == self) revert DirectFacetCall();
        if (msg.sender != manager && !isExecutor[msg.sender]) revert NotAuthorized();
        if (status != Status.Investing) revert NotInvesting();
        if (swapsPaused || allowlist.paused()) revert Paused();
        if (amountIn == 0 || minAmountOut == 0) revert BadAmount();
        if (assetIn == assetOut) revert BadPair();

        bool inEth = assetIn == address(0);
        bool outEth = assetOut == address(0);
        bool inWeth = assetIn == weth;
        bool outWeth = assetOut == weth;
        if ((inEth || inWeth) && (outEth || outWeth)) {
            if (router != address(0)) revert BadRouter();
            if (!allowlist.assetAllowed(weth)) revert NotAllowlisted();
            if (inEth && outWeth) _wrap(amountIn, minAmountOut);
            else if (inWeth && outEth) _unwrap(amountIn, minAmountOut);
            else revert BadPair();
            return;
        }
        if (inEth == outEth && inWeth == outWeth) revert BadPair();
        bool buying = inEth || inWeth;
        address asset = buying ? assetOut : assetIn;
        if (!inMandate[asset]) revert NotInMandate();
        if (!allowlist.assetAllowed(asset) || !allowlist.routerAllowed(router)) revert NotAllowlisted();
        if (router == address(this) || router == nft || router == asset || router == weth || router.code.length == 0) {
            revert BadRouter();
        }
        _swap(router, assetIn, assetOut, asset, buying, amountIn, minAmountOut, data);
    }

    function _wrap(uint256 amountIn, uint256 minAmountOut) internal {
        if (_spendable() < amountIn) revert BadAmount();
        uint256 before = _weth();
        IWETHV2(weth).deposit{value: amountIn}();
        uint256 got = _weth() - before;
        if (got < minAmountOut) revert Slippage();
        _record(weth, SIDE_BUY, got, amountIn * 1e18 / got);
    }

    function _unwrap(uint256 amountIn, uint256 minAmountOut) internal {
        if (amountIn > _weth()) revert BadAmount();
        uint256 ethBefore = address(this).balance;
        inSwap = true;
        IWETHV2(weth).withdraw(amountIn);
        inSwap = false;
        uint256 got = address(this).balance - ethBefore;
        if (got < minAmountOut) revert Slippage();
        _record(weth, SIDE_SELL, amountIn, got * 1e18 / amountIn);
    }

    function _swap(
        address router,
        address assetIn,
        address assetOut,
        address asset,
        bool buying,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) internal {
        uint256 fees = _fees();
        if (assetIn == address(0) && _spendable() < amountIn) revert BadAmount();
        if (assetIn != address(0) && IERC20(assetIn).balanceOf(address(this)) < amountIn) revert BadAmount();
        uint256 quoteBefore = address(this).balance + _weth();
        uint256 assetBefore = IERC20(asset).balanceOf(address(this));
        if (assetIn != address(0)) IERC20(assetIn).safeTransfer(router, amountIn);
        inSwap = true;
        (bool ok,) = router.call{value: assetIn == address(0) ? amountIn : 0}(
            abi.encodeWithSelector(IFundSwapRouterV2.swap.selector, assetIn, assetOut, amountIn, minAmountOut, data)
        );
        inSwap = false;
        if (!ok) revert SwapFailed();
        if (address(this).balance < fees) revert FeesShort();
        uint256 quoteAfter = address(this).balance + _weth();
        uint256 assetAfter = IERC20(asset).balanceOf(address(this));
        if (buying) {
            if (quoteAfter >= quoteBefore) revert BadAmount();
            uint256 spent = quoteBefore - quoteAfter;
            if (spent == 0 || spent > amountIn) revert BadAmount();
            if (assetAfter <= assetBefore) revert Slippage();
            uint256 got = assetAfter - assetBefore;
            if (got < minAmountOut) revert Slippage();
            costBasis[asset] += spent;
            totalCostBasis += spent;
            _record(asset, SIDE_BUY, got, spent * 1e18 / got);
        } else {
            if (assetAfter >= assetBefore) revert BadAmount();
            uint256 sold = assetBefore - assetAfter;
            if (sold == 0 || sold > amountIn) revert BadAmount();
            if (quoteAfter <= quoteBefore) revert Slippage();
            uint256 got = quoteAfter - quoteBefore;
            if (got < minAmountOut) revert Slippage();
            uint256 basis = costBasis[asset];
            uint256 removed = sold == assetBefore ? basis : (basis * sold) / assetBefore;
            costBasis[asset] = basis - removed;
            totalCostBasis -= removed;
            _record(asset, SIDE_SELL, sold, got * 1e18 / sold);
        }
    }

    function _record(address asset, uint8 side, uint256 size, uint256 unitPrice) internal {
        uint256 live = nft == address(0) ? 0 : IFundUnitV2(nft).outstanding();
        uint256 navAfter = live == 0 ? 0 : (address(this).balance + _weth()) / live;
        trades[tradeCount % BLOT_CAP] = TradeRecord({
            asset: asset, side: side, timestamp: uint64(block.timestamp), size: size, price: unitPrice, navAfter: navAfter
        });
        tradeCount += 1;
        emit Trade(asset, side, size, unitPrice, navAfter);
    }

    function _weth() internal view returns (uint256) {
        return IERC20(weth).balanceOf(address(this));
    }

    function _fees() internal view returns (uint256) {
        return (entryFeeAccrued - entryFeeClaimed) + (protocolFeeAccrued - protocolFeeClaimed);
    }

    function _spendable() internal view returns (uint256) {
        uint256 fees = _fees();
        uint256 bal = address(this).balance;
        return bal <= fees ? 0 : bal - fees;
    }
}
