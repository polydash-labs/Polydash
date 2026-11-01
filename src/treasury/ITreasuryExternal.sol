// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Minimal views/calls on live Robinhood Chain contracts used by TreasuryRules.
interface ITLaunch {
    function creator() external view returns (address);
    function token() external view returns (address);
    function hook() external view returns (address);
    function graduated() external view returns (bool);
    function buy(uint256 minTokensOut) external payable returns (uint256 tokensOut);
}

/// @dev Uniswap V4 core types (Robinhood Chain PoolManager 0x8366a39CC670B4001A1121B8F6A443A643e40951).
struct TPoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct TSwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface ITPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(TPoolKey memory key, TSwapParams memory params, bytes calldata hookData) external returns (int256 delta);
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
    function extsload(bytes32 slot) external view returns (bytes32);
}

interface ITUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

/// @dev PolydashStakingFactoryV2 0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0 (no reward top-up on existing pools).
interface ITStakingFactoryV2 {
    function createPool(
        address stakeToken,
        address rewardToken,
        uint256 rewardAmount,
        uint256 startTime,
        uint256 duration,
        uint256 maxTotalStake,
        uint256 claimFeeBps,
        string calldata name,
        string calldata description
    ) external returns (address pool);
}

interface ITStakingPoolV2 {
    function collectCreatorFees() external;
    function recoverUnallocated() external;
}

struct TFees {
    uint256 platform;
    uint256 creator;
    uint256 tax;
    uint256 total;
}

interface ITLaunchQuote {
    function quoteBuy(uint256 ethIn) external view returns (uint256 tokensOut, TFees memory fees);
}
