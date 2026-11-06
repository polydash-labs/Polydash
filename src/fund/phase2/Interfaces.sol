// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Global router and asset registry read by each investing vault.
interface IFundAllowlist {
    error PriceUnavailable();
    error PriceStale();
    error PriceRejected();

    function paused() external view returns (bool);
    function delay() external view returns (uint256);
    function routerAllowed(address router) external view returns (bool);
    function assetAllowed(address asset) external view returns (bool);
    function quoteAsset() external view returns (address);
    function feedOf(address asset)
        external
        view
        returns (address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18);
    /// @notice ETH wei for `amount` of `asset` at the feed. Reverts when the feed cannot be used.
    function quote(address asset, uint256 amount) external view returns (uint256);
    function checkPrice(address asset) external view;
}

/// @notice Narrow router surface. The vault measures its own balances and does not trust the return value.
///         `address(0)` is native ETH. Proceeds must arrive at the vault.
interface IFundSwapRouter {
    function swap(address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external
        payable
        returns (uint256 amountOut);
}

/// @notice Mint accounting the vault reads from its FundNFTInvest. Views only.
interface IFundUnit {
    function totalMinted() external view returns (uint256);
    function outstanding() external view returns (uint256);
    function managerMinted() external view returns (uint256);
    function skinRequired() external view returns (uint256);
    function publicOpen() external view returns (bool);
}

/// @notice Feed used for mandate assets other than the quote. `priceX18` is ETH wei per 1e18 raw units.
interface IFundPriceFeed {
    function latestPrice(address asset) external view returns (uint256 priceX18, uint64 updatedAt);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
