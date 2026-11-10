// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FundFactoryPhase3} from "../phase3/FundFactoryPhase3.sol";
import {FundCarryRights} from "./FundCarryRights.sol";
import {FundConvictionLock} from "./FundConvictionLock.sol";
import {FundNavFloor} from "./FundNavFloor.sol";
import {FundSecondaryMarket} from "./FundSecondaryMarket.sol";
import {FundShareRenderer} from "./FundShareRenderer.sol";

/// @title FundPhase5
/// @notice Add-on for funds created by a Phase 3 factory. One deployment creates the market, the
///         share renderer, the conviction lock, the carry token, and the nav-floor queue.
///         It does not replace `FundFactoryPhase3` and it does not change a vault, a facet, or a template.
///         Not audited. Not a review. Not financial advice.
contract FundPhase5 {
    FundFactoryPhase3 public immutable factory;
    address public immutable market;
    address public immutable renderer;
    address public immutable locks;
    address public immutable carry;
    address public immutable navFloor;

    error BadFactory();

    constructor(address phase3Factory) {
        if (phase3Factory == address(0) || phase3Factory.code.length == 0) revert BadFactory();
        factory = FundFactoryPhase3(phase3Factory);
        if (factory.weth() == address(0)) revert BadFactory();
        market = address(new FundSecondaryMarket(phase3Factory, address(this)));
        renderer = address(new FundShareRenderer(phase3Factory, address(this)));
        carry = address(new FundCarryRights(phase3Factory, address(this)));
        locks = address(new FundConvictionLock(phase3Factory, address(this)));
        navFloor = address(new FundNavFloor(phase3Factory, address(this)));
    }
}
