// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Read-only views on the live Polypad launch contracts (PolydashFactory 0x2c84...5db2,
///      PolydashLaunch impl 0xef76...8b70). Only functions that exist in the deployed source are used.
interface IPolydashFactoryInfo {
    function launchOfToken(address token) external view returns (address);
    function isLaunch(address launch) external view returns (bool);
}

interface IPolydashLaunchInfo {
    function creator() external view returns (address);
    function token() external view returns (address);
}

interface IBurnableERC20 {
    function burn(uint256 amount) external;
}
