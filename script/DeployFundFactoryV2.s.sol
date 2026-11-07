// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FundAllowlistV2} from "../src/fund/phase2v2/FundAllowlistV2.sol";
import {FundFactoryV2} from "../src/fund/phase2v2/FundFactoryV2.sol";
import {FundSwapFacetV2} from "../src/fund/phase2v2/FundSwapFacetV2.sol";

/// @notice Phase 2 v2 deploy. Reverts unless CONFIRM_FUND_PHASE2_V2_DEPLOY=yes.
///         Does not call Phase 1 FundFactory or the deployed Phase 2 v1 factory.
///         These contracts are unaudited. Not financial advice. Do not commit a key.
/// @dev FUND_V2_WETH is required. FEE_RECIPIENT or FUND_V2_FEE_RECIPIENT is required.
///      PRIVATE_KEY signs unless FUND_V2_DEPLOY_PK is set. Leave FUND_V2_DEPLOY_PK unset to broadcast.
///      The allowlist starts with WETH and no router. Later routers wait out the delay.
///      CONFIRM_FUND_PHASE2_V2_DEPLOY=yes FUND_V2_WETH=0x... FEE_RECIPIENT=0x... PRIVATE_KEY=0x... \
///      forge script script/DeployFundFactoryV2.s.sol --rpc-url robinhood --broadcast
contract DeployFundFactoryV2 is Script {
    error DeployNotConfirmed();

    function run() external returns (FundFactoryV2 factory, FundAllowlistV2 allowlist, FundSwapFacetV2 facet) {
        if (keccak256(bytes(vm.envOr("CONFIRM_FUND_PHASE2_V2_DEPLOY", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }
        uint256 pk = vm.envOr("FUND_V2_DEPLOY_PK", uint256(0));
        if (pk == 0) pk = vm.envUint("PRIVATE_KEY");
        address feeRecipient = vm.envOr("FUND_V2_FEE_RECIPIENT", address(0));
        if (feeRecipient == address(0)) feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address weth = vm.envAddress("FUND_V2_WETH");
        uint256 timelock = vm.envOr("FUND_V2_DELAY", uint256(2 days));
        address[] memory routers = new address[](0);
        address[] memory assets = new address[](1);
        assets[0] = weth;
        vm.startBroadcast(pk);
        facet = new FundSwapFacetV2();
        allowlist = new FundAllowlistV2(vm.addr(pk), timelock, routers, assets);
        factory = new FundFactoryV2(feeRecipient, address(allowlist), weth, address(facet));
        vm.stopBroadcast();
        console2.log("FundSwapFacetV2:", address(facet));
        console2.log("FundAllowlistV2:", address(allowlist));
        console2.log("FundFactoryV2:", address(factory));
        console2.log("owner:", factory.owner());
        console2.log("feeRecipient:", factory.feeRecipient());
        console2.log("weth:", factory.weth());
    }
}
