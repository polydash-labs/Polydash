// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FundPhase4} from "../src/fund/phase4/FundPhase4.sol";

/// @notice Phase 4 deploy script. It does not run unless CONFIRM_FUND_PHASE4_DEPLOY=yes.
///         One transaction deploys `FundPhase4`. The constructor deploys `FundShareAccount`.
///         It does not deploy an ERC-6551 registry and it does not call the live factories
///         except to read `weth()` during construction. Not audited. Not financial advice.
/// @dev Required env:
///      CONFIRM_FUND_PHASE4_DEPLOY=yes
///      PRIVATE_KEY, unless DEPLOY_FUND_PHASE4_PK is set. The unit test sets the latter.
///      Optional FUND_PHASE3_FACTORY. Default is the live Phase 3 factory on Robinhood Chain.
///      CONFIRM_FUND_PHASE4_DEPLOY=yes PRIVATE_KEY=0x... \
///      forge script script/DeployFundPhase4.s.sol --rpc-url robinhood --broadcast
contract DeployFundPhase4 is Script {
    error DeployNotConfirmed();

    address internal constant LIVE_PHASE3_FACTORY = 0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B;

    function run() external returns (FundPhase4 phase4) {
        if (keccak256(bytes(vm.envOr("CONFIRM_FUND_PHASE4_DEPLOY", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }
        address phase3 = vm.envOr("FUND_PHASE3_FACTORY", LIVE_PHASE3_FACTORY);
        uint256 pk = vm.envOr("DEPLOY_FUND_PHASE4_PK", uint256(0));
        if (pk == 0) pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);
        phase4 = new FundPhase4(phase3);
        vm.stopBroadcast();

        console2.log("FundPhase4:", address(phase4));
        console2.log("FundShareAccount:", phase4.shareAccount());
        console2.log("registry:", phase4.ERC6551_REGISTRY());
        console2.log("shareAccountsEnabled:", phase4.shareAccountsEnabled());
        console2.log("phase3:", address(phase4.factory()));
    }
}
