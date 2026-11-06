// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FundAllowlist} from "../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../src/fund/phase2/FundFactoryInvest.sol";
import {FundSwapFacet} from "../src/fund/phase2/FundSwapFacet.sol";

/// @notice Phase 2b deploy script. It does not run unless CONFIRM_FUND_PHASE2_DEPLOY=yes.
///         Do not broadcast this against Robinhood Chain until that deploy is intended.
///         The live Phase 1a FundFactory is a different contract and this script does not call it.
/// @dev Required env:
///      CONFIRM_FUND_PHASE2_DEPLOY=yes
///      FUND_INVEST_WETH — WETH on the target chain. One reference is `weth()` on
///      PolydashBuybackVault 0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193. This script has no default.
///      FEE_RECIPIENT, or FUND_INVEST_FEE_RECIPIENT. No default recipient.
///      PRIVATE_KEY, unless DEPLOY_FUND_INVEST_PK is set. Leave DEPLOY_FUND_INVEST_PK unset to broadcast.
///      The unit test sets DEPLOY_FUND_INVEST_PK so it does not share PRIVATE_KEY with other deploy tests.
///      Optional FUND_INVEST_DELAY seconds. Default is 2 days. Minimum is 1 day.
///      The allowlist starts with WETH only. Routers and other assets are added later through `propose`
///      and wait out the delay. Assets are the addresses the owner adds. There is no price feed.
///      These contracts are unaudited. Not financial advice.
///      CONFIRM_FUND_PHASE2_DEPLOY=yes FUND_INVEST_WETH=0x... FEE_RECIPIENT=0x... PRIVATE_KEY=0x... \
///      forge script script/DeployFundFactoryInvest.s.sol --rpc-url robinhood --broadcast
contract DeployFundFactoryInvest is Script {
    error DeployNotConfirmed();

    function run() external returns (FundFactoryInvest factory, FundAllowlist allowlist, FundSwapFacet facet) {
        if (keccak256(bytes(vm.envOr("CONFIRM_FUND_PHASE2_DEPLOY", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }

        uint256 pk = vm.envOr("DEPLOY_FUND_INVEST_PK", uint256(0));
        if (pk == 0) pk = vm.envUint("PRIVATE_KEY");

        address feeRecipient = vm.envOr("FUND_INVEST_FEE_RECIPIENT", address(0));
        if (feeRecipient == address(0)) feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address weth = vm.envAddress("FUND_INVEST_WETH");
        uint256 timelock = vm.envOr("FUND_INVEST_DELAY", uint256(2 days));

        address[] memory routers = new address[](0);
        address[] memory assets = new address[](1);
        assets[0] = weth;

        vm.startBroadcast(pk);
        facet = new FundSwapFacet();
        allowlist = new FundAllowlist(vm.addr(pk), timelock, routers, assets);
        factory = new FundFactoryInvest(feeRecipient, address(allowlist), weth, address(facet));
        vm.stopBroadcast();

        console2.log("FundSwapFacet:", address(facet));
        console2.log("FundAllowlist:", address(allowlist));
        console2.log("FundFactoryInvest:", address(factory));
        console2.log("owner:", factory.owner());
        console2.log("feeRecipient:", factory.feeRecipient());
        console2.log("weth:", factory.weth());
        console2.log("delay:", allowlist.delay());
    }
}
