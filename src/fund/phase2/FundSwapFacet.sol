// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundSwapRouter, IFundUnit, IWETH} from "./Interfaces.sol";
import {NAVReader} from "./NAVReader.sol";
import {FundVaultStore} from "./FundVaultStore.sol";

/// @title FundSwapFacet (not reviewed, not deployed)
/// @notice Swap body for a fund vault. The vault delegatecalls here so this code is not copied into every factory.
///         A direct call uses this contract's own empty storage and reverts. Holdings stay on the vault.
contract FundSwapFacet is ReentrancyGuard, FundVaultStore {
    using SafeERC20 for IERC20;

    address public immutable self;

    constructor() {
        self = address(this);
    }

    /// @notice Same signature as `FundVaultInvest.swap`. The vault delegatecalls this.
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
        allowlist.checkPrice(asset);
        if (router == address(this) || router == nft || router == asset || router == weth || router.code.length == 0) {
            revert BadRouter();
        }
        _swap(router, assetIn, assetOut, asset, buying, amountIn, minAmountOut, data);
    }

    function _wrap(uint256 amountIn, uint256 minAmountOut) internal {
        if (_spendableEth() < amountIn) revert BadAmount();
        uint256 before = _wethBalance();
        IWETH(weth).deposit{value: amountIn}();
        uint256 got = _wethBalance() - before;
        if (got < minAmountOut) revert Slippage();
        if (address(this).balance < _claimableFees()) revert FeesShort();
        _record(weth, SIDE_BUY, got, NAVReader.executionPrice(amountIn, got));
    }

    function _unwrap(uint256 amountIn, uint256 minAmountOut) internal {
        if (amountIn > _wethBalance()) revert BadAmount();
        uint256 ethBefore = address(this).balance;
        inSwap = true;
        IWETH(weth).withdraw(amountIn);
        inSwap = false;
        uint256 got = address(this).balance - ethBefore;
        if (got < minAmountOut) revert Slippage();
        _record(weth, SIDE_SELL, amountIn, NAVReader.executionPrice(got, amountIn));
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
        uint256 fees = _claimableFees();
        if (assetIn == address(0) && _spendableEth() < amountIn) revert BadAmount();
        if (assetIn != address(0) && IERC20(assetIn).balanceOf(address(this)) < amountIn) revert BadAmount();

        uint256 quoteBefore = address(this).balance + _wethBalance();
        uint256 assetBefore = IERC20(asset).balanceOf(address(this));
        if (assetIn != address(0)) IERC20(assetIn).safeTransfer(router, amountIn);

        inSwap = true;
        (bool ok,) = router.call{value: assetIn == address(0) ? amountIn : 0}(
            abi.encodeWithSelector(IFundSwapRouter.swap.selector, assetIn, assetOut, amountIn, minAmountOut, data)
        );
        inSwap = false;
        if (!ok) revert SwapFailed();
        if (address(this).balance < fees) revert FeesShort();

        uint256 quoteAfter = address(this).balance + _wethBalance();
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
            _record(asset, SIDE_BUY, got, NAVReader.executionPrice(spent, got));
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
            _record(asset, SIDE_SELL, sold, NAVReader.executionPrice(got, sold));
        }
    }

    function _record(address asset, uint8 side, uint256 size, uint256 unitPrice) internal {
        uint256 navAfter = _navPerNft();
        trades[tradeCount % BLOT_CAP] = TradeRecord({
            asset: asset, side: side, timestamp: uint64(block.timestamp), size: size, price: unitPrice, navAfter: navAfter
        });
        tradeCount += 1;
        emit Trade(asset, side, size, unitPrice, navAfter);
    }

    function _wethBalance() internal view returns (uint256) {
        return IERC20(weth).balanceOf(address(this));
    }

    function _claimableFees() internal view returns (uint256) {
        return (entryFeeAccrued - entryFeeClaimed) + (protocolFeeAccrued - protocolFeeClaimed);
    }

    function _spendableEth() internal view returns (uint256) {
        uint256 fees = _claimableFees();
        uint256 bal = address(this).balance;
        return bal <= fees ? 0 : bal - fees;
    }

    function _navPerNft() internal view returns (uint256) {
        uint256 live = nft == address(0) ? 0 : IFundUnit(nft).outstanding();
        return NAVReader.perNft(
            NAVReader.total(address(this).balance, _wethBalance(), _mandateAssets, allowlist), live
        );
    }
}
