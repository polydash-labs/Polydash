// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundSwapRouter, IFundUnit, IWETH} from "../phase2/Interfaces.sol";
import {NAVReader} from "../phase2/NAVReader.sol";
import {FundVaultStore} from "../phase2/FundVaultStore.sol";
import {FundPhase3Store} from "./FundPhase3Store.sol";
import {FundProposalStore} from "./FundProposalStore.sol";

/// @title FundSwapFacetPhase3V2 (not reviewed, not deployed)
/// @notice Swap body for a Phase 3 V2 vault. A copy of `FundSwapFacetPhase3` with exactly two
///         behavior changes; everything else (trade cap, deviation check vs the feed, allowlist
///         and router checks, recording, drawdown brake via the vault) is identical:
///         (a) buys require `inMandate[asset]` (unchanged) AND pass the per-asset cap — the
///             post-buy position value must be at most `min(template maxPositionBps,
///             assetCap[asset])`, where `assetCap == 0` means "no proposal cap, use the
///             template cap" (template assets have no proposal, so their cap is 0);
///         (b) sells require `sellable[asset]` instead of `inMandate[asset]`, so an asset
///             removed from the mandate can still be sold. Sells still need the allowlist and
///             the feed (trade cap and deviation floor both read it), so a removed asset whose
///             feed was also removed from the allowlist cannot be sold — that is the allowlist
///             side failing closed, not the mandate side.
///         Inherits `FundProposalStore` in the same position as the V2 vault, so the
///         delegatecall sees one storage layout.
///         This contract is not deployed. Not a review. Not financial advice.
contract FundSwapFacetPhase3V2 is ReentrancyGuard, FundVaultStore, FundPhase3Store, FundProposalStore {
    using SafeERC20 for IERC20;

    address public immutable self;

    constructor() {
        self = address(this);
    }

    /// @notice Same signature as `FundVaultPhase3.swap`. The vault delegatecalls this.
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
        // (b) Buys need the mandate; sells need only "was ever in the mandate". Removal
        // clears `inMandate` but never clears `sellable`, so a removed asset stays sellable.
        if (buying) {
            if (!inMandate[asset]) revert NotInMandate();
        } else {
            if (!sellable[asset]) revert NotSellable();
        }
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
        if (got != amountIn || got < minAmountOut) revert Slippage();
        if (address(this).balance < _claimableFees()) revert FeesShort();
        _record(weth, SIDE_BUY, got, NAVReader.executionPrice(amountIn, got), _navTotal());
    }

    function _unwrap(uint256 amountIn, uint256 minAmountOut) internal {
        if (amountIn > _wethBalance()) revert BadAmount();
        uint256 ethBefore = address(this).balance;
        inSwap = true;
        IWETH(weth).withdraw(amountIn);
        inSwap = false;
        uint256 got = address(this).balance - ethBefore;
        if (got != amountIn || got < minAmountOut) revert Slippage();
        _record(weth, SIDE_SELL, amountIn, NAVReader.executionPrice(got, amountIn), _navTotal());
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

        uint256 navBefore = _navTotal();
        _checkTradeCap(asset, buying, amountIn, navBefore);

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
            uint256 execPrice = NAVReader.executionPrice(spent, got);
            _checkDeviation(asset, execPrice, true);
            uint256 navAfter = _navTotal();
            _checkPositionCap(asset, assetAfter, navAfter);
            costBasis[asset] += spent;
            totalCostBasis += spent;
            _record(asset, SIDE_BUY, got, execPrice, navAfter);
        } else {
            if (assetAfter >= assetBefore) revert BadAmount();
            uint256 sold = assetBefore - assetAfter;
            if (sold == 0 || sold > amountIn) revert BadAmount();
            if (quoteAfter <= quoteBefore) revert Slippage();
            uint256 got = quoteAfter - quoteBefore;
            if (got < minAmountOut) revert Slippage();
            uint256 execPrice = NAVReader.executionPrice(got, sold);
            _checkDeviation(asset, execPrice, false);
            uint256 basis = costBasis[asset];
            uint256 removed = sold == assetBefore ? basis : (basis * sold) / assetBefore;
            costBasis[asset] = basis - removed;
            totalCostBasis -= removed;
            _record(asset, SIDE_SELL, sold, execPrice, _navTotal());
        }
    }

    /// @notice Quote-side size of one trade must stay under `maxTradeBps` of pre-trade NAV.
    ///         Buys are measured by quote spent; sells by the feed value of the asset sold.
    ///         WETH wrap/unwrap never reaches this function (the quote asset has no cap).
    function _checkTradeCap(address asset, bool buying, uint256 amountIn, uint256 navBefore) internal view {
        uint256 quoteSize = buying ? amountIn : allowlist.quote(asset, amountIn);
        if (quoteSize > (navBefore * maxTradeBps) / BPS) revert TradeCap();
    }

    /// @notice A buy must not leave more than the effective position cap of post-trade NAV
    ///         in one asset. (a) The effective cap is `min(template maxPositionBps,
    ///         assetCap[asset])`; a proposal cap of 0 means "no proposal cap", so template
    ///         assets (cap 0) are governed by the template cap alone. Sells only shrink a
    ///         position, so they are not checked here.
    function _checkPositionCap(address asset, uint256 assetBalance, uint256 navAfter) internal view {
        uint256 cap = maxPositionBps;
        uint256 proposed = assetCap[asset];
        if (proposed != 0 && proposed < cap) cap = proposed;
        uint256 positionValue = allowlist.quote(asset, assetBalance);
        if (positionValue > (navAfter * cap) / BPS) revert PositionCap();
    }

    /// @notice Executed price must stay within `maxDeviationBps` of the feed price. A buy caps how
    ///         much above the feed the vault may pay; a sell floors how much below the feed it may
    ///         accept. The feed price is `allowlist.quote(asset, 1e18)`, ETH wei per 1e18 raw units.
    ///         Setting `maxDeviationBps` to 10000 removes the sell floor (0) and lets a buy pay up
    ///         to 2x the feed; that is an explicit opt-out, not a default.
    function _checkDeviation(address asset, uint256 execPrice, bool buying) internal view {
        uint256 feedPrice = allowlist.quote(asset, 1e18);
        if (buying) {
            if (execPrice > (feedPrice * (BPS + maxDeviationBps)) / BPS) revert Deviation();
        } else {
            if (execPrice < (feedPrice * (BPS - maxDeviationBps)) / BPS) revert Deviation();
        }
    }

    function _record(address asset, uint8 side, uint256 size, uint256 unitPrice, uint256 navTotal) internal {
        uint256 live = nft == address(0) ? 0 : IFundUnit(nft).outstanding();
        uint256 navAfter = NAVReader.perNft(navTotal, live);
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
        return (entryFeeAccrued - entryFeeClaimed) + (protocolFeeAccrued - protocolFeeClaimed)
            + (performanceFeeAccrued - performanceFeeClaimed) + distributionReserved;
    }

    function _spendableEth() internal view returns (uint256) {
        uint256 fees = _claimableFees();
        uint256 bal = address(this).balance;
        return bal <= fees ? 0 : bal - fees;
    }

    /// @notice Fee-excluded NAV total. The facet shares the vault's storage by delegatecall, so this
    ///         reads the same balances and fees as `FundVaultInvest.nav()`.
    function _navTotal() internal view returns (uint256) {
        return NAVReader.netTotal(
            address(this).balance, _wethBalance(), _mandateAssets, allowlist, _claimableFees()
        );
    }

    function _navPerNft() internal view returns (uint256) {
        uint256 live = nft == address(0) ? 0 : IFundUnit(nft).outstanding();
        return NAVReader.perNft(_navTotal(), live);
    }
}
