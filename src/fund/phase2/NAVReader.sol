// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFundAllowlist} from "./Interfaces.sol";

/// @title NAVReader
/// @notice Market NAV in ETH wei. ETH and WETH count at face balance.
///         Each other mandate asset is quoted by the allowlist feed.
///         A missing, stale, reverting, or out-of-bounds price reverts.
///         Cost basis is not an input. Integer division drops a remainder.
library NAVReader {
    function total(
        uint256 ethBalance,
        uint256 wethBalance,
        address[] storage assets,
        IFundAllowlist allowlist
    ) internal view returns (uint256 sum) {
        sum = ethBalance + wethBalance;
        uint256 n = assets.length;
        for (uint256 i; i < n; ++i) {
            address asset = assets[i];
            uint256 bal = IERC20(asset).balanceOf(address(this));
            if (bal == 0) continue;
            if (!allowlist.assetAllowed(asset)) revert IFundAllowlist.PriceUnavailable();
            sum += allowlist.quote(asset, bal);
        }
    }

    /// @notice `total()` minus unclaimed entry and protocol fees, floored at zero. Fees are still in
    ///         the contract, but they belong to the manager / protocol, not the LPs, so they are not
    ///         part of NAV. `spendableEth()` already excludes them; NAV now matches what an exit pays.
    function netTotal(
        uint256 ethBalance,
        uint256 wethBalance,
        address[] storage assets,
        IFundAllowlist allowlist,
        uint256 fees
    ) internal view returns (uint256) {
        uint256 sum = total(ethBalance, wethBalance, assets, allowlist);
        return sum <= fees ? 0 : sum - fees;
    }

    /// @notice `nav / outstanding`, or zero when nothing is outstanding.
    function perNft(uint256 nav, uint256 outstanding) internal pure returns (uint256) {
        if (outstanding == 0) return 0;
        return nav / outstanding;
    }

    /// @notice Quote wei per 1e18 raw token units, from a fill. Not a feed price.
    function executionPrice(uint256 quoteAmount, uint256 assetAmount) internal pure returns (uint256) {
        if (assetAmount == 0) return 0;
        return (quoteAmount * 1e18) / assetAmount;
    }
}
