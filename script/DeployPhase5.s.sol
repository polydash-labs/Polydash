// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FundPhase5} from "../src/fund/phase5/FundPhase5.sol";

/// @notice Phase 5 deploy script. It does not run unless CONFIRM_FUND_PHASE5_DEPLOY=yes.
///         One broadcast deploys `FundPhase5`. The constructor deploys the market, renderer,
///         carry token, conviction lock, and nav-floor queue. It does not call `createFund`.
///         Not audited. Not financial advice.
/// @dev Required env:
///      CONFIRM_FUND_PHASE5_DEPLOY=yes
///      PRIVATE_KEY, unless DEPLOY_FUND_PHASE5_PK is set. The unit test sets the latter.
///      Optional FUND_PHASE3_FACTORY. Default is the live Phase 3 factory on Robinhood Chain.
///      CONFIRM_FUND_PHASE5_DEPLOY=yes PRIVATE_KEY=0x... \
///      forge script script/DeployPhase5.s.sol --rpc-url robinhood --broadcast
contract DeployPhase5 is Script {
    error DeployNotConfirmed();

    address internal constant LIVE_PHASE3_FACTORY = 0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B;

    function run() external returns (FundPhase5 phase5) {
        if (keccak256(bytes(vm.envOr("CONFIRM_FUND_PHASE5_DEPLOY", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }
        address phase3 = vm.envOr("FUND_PHASE3_FACTORY", LIVE_PHASE3_FACTORY);
        uint256 pk = vm.envOr("DEPLOY_FUND_PHASE5_PK", uint256(0));
        if (pk == 0) pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);
        phase5 = new FundPhase5(phase3);
        vm.stopBroadcast();

        console2.log("FundPhase5", address(phase5));
        console2.log("FundSecondaryMarket", phase5.market());
        console2.log("FundShareRenderer", phase5.renderer());
        console2.log("FundConvictionLock", phase5.locks());
        console2.log("FundCarryRights", phase5.carry());
        console2.log("FundNavFloor", phase5.navFloor());
        console2.log("phase3", address(phase5.factory()));
    }
}
