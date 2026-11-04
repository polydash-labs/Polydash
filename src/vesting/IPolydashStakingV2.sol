// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Subset of the deployed PolydashStakingPoolV2 interface used by the vesting vault.
interface IPolydashStakingPoolV2 {
    function stakeToken() external view returns (address);
    function rewardToken() external view returns (address);
    function endTime() external view returns (uint256);
    function funded() external view returns (bool);
    function balanceOf(address) external view returns (uint256);
    function sharesToAmount(uint256 shares) external view returns (uint256);
    function claimable(address account) external view returns (uint256);
    function stake(uint256 amount) external;
    function withdraw(uint256 shares) external;
    function claim() external;
    function emergencyWithdraw() external;
}

/// @notice Subset of the deployed PolydashStakingFactoryV2 interface.
interface IPolydashStakingFactoryV2View {
    function isPool(address pool) external view returns (bool);
}
