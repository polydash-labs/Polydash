// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title NAVReader
/// @notice ETH-denominated NAV for one fund. ETH and WETH count at face balance.
///         Other allowlisted assets count at the ETH (or WETH, 1:1) spent to acquire them.
///         There is no market price and no external feed. Integer division drops a remainder.
library NAVReader {
    uint256 internal constant WAD = 1e18;

    function total(uint256 ethBalance, uint256 wethBalance, uint256 costBasis) internal pure returns (uint256) {
        return ethBalance + wethBalance + costBasis;
    }

    /// @notice `nav / minted`, or zero before the first mint. Leftover wei stay in the vault.
    function perNft(uint256 nav, uint256 minted) internal pure returns (uint256) {
        if (minted == 0) return 0;
        return nav / minted;
    }

    /// @notice Quote wei per 1e18 units of the asset. Zero when the asset amount is zero.
    function price(uint256 quoteAmount, uint256 assetAmount) internal pure returns (uint256) {
        if (assetAmount == 0) return 0;
        return (quoteAmount * WAD) / assetAmount;
    }
}
