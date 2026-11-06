// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FundFactory} from "../src/fund/FundFactory.sol";

/// @notice Deploys FundFactory only. createFund deploys one FundVault and one FundNFT per fund.
/// @dev Env: PRIVATE_KEY and FEE_RECIPIENT. Both are required for a broadcast. This script does not
///      choose a recipient. If the recipient should be the launchpad platform fee wallet recorded in
///      deployments/robinhood-chain.json, set FEE_RECIPIENT to
///      0x9a21c75aC263cC43125E70200636f6397f8776d0 before broadcasting.
///      DEPLOY_FUND_FACTORY_PK overrides PRIVATE_KEY when it is set. Leave it unset for a broadcast.
///      The unit test sets it so this script does not share PRIVATE_KEY with script/Deploy.s.sol.
///      These contracts are unaudited. Not financial advice.
///      ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
///      forge script script/DeployFundFactory.s.sol --rpc-url robinhood --broadcast
contract DeployFundFactory is Script {
    function run() external returns (FundFactory factory) {
        uint256 pk = vm.envOr("DEPLOY_FUND_FACTORY_PK", uint256(0));
        if (pk == 0) pk = vm.envUint("PRIVATE_KEY");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");

        vm.startBroadcast(pk);
        factory = new FundFactory(feeRecipient);
        vm.stopBroadcast();

        console2.log("FundFactory:", address(factory));
        console2.log("owner:", factory.owner());
        console2.log("feeRecipient:", factory.feeRecipient());
    }
}
