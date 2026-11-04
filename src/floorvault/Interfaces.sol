// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @dev Read-only views on the live Polypad launch contracts. Only functions present in the deployed source.
interface ILaunchFactoryInfo {
    function launchOfToken(address token) external view returns (address);
    function isLaunch(address launch) external view returns (bool);
}

interface ILaunchInfo {
    function creator() external view returns (address);
    function token() external view returns (address);
    function hook() external view returns (address);
    function graduated() external view returns (bool);
}

interface IHookInfo {
    function poolKeyOf(address launch) external view returns (PoolKey memory);
}

interface IFeeWalletSource {
    function platformFeeWallet() external view returns (address);
}
