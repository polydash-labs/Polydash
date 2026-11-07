// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IFundAllowlistV2 {
    function paused() external view returns (bool);
    function delay() external view returns (uint256);
    function routerAllowed(address router) external view returns (bool);
    function assetAllowed(address asset) external view returns (bool);
}

interface IFundSwapRouterV2 {
    function swap(address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external
        payable
        returns (uint256 amountOut);
}

interface IFundUnitV2 {
    function totalMinted() external view returns (uint256);
    function outstanding() external view returns (uint256);
    function managerMinted() external view returns (uint256);
    function skinRequired() external view returns (uint256);
    function publicOpen() external view returns (bool);
}

interface IWETHV2 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice Optional quote. Disabled when the vault's oracle is the zero address.
///         `quotePerWad` is ETH wei per 1e18 raw token units. It is not used by `nav()`.
interface IFundOracleV2 {
    function price(address asset) external view returns (uint256 quotePerWad, uint256 updatedAt);
}
