// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployFundFactoryV2} from "../../script/DeployFundFactoryV2.s.sol";
import {FundAllowlistV2} from "../../src/fund/phase2v2/FundAllowlistV2.sol";
import {FundFactoryV2} from "../../src/fund/phase2v2/FundFactoryV2.sol";

contract DeployFundFactoryV2Test is Test {
    function test_script_requires_confirm_then_deploys() public {
        DeployFundFactoryV2 script = new DeployFundFactoryV2();
        vm.setEnv("CONFIRM_FUND_PHASE2_V2_DEPLOY", "no");
        vm.expectRevert(DeployFundFactoryV2.DeployNotConfirmed.selector);
        script.run();

        (address deployer, uint256 pk) = makeAddrAndKey("v2deployer");
        address feeRecipient = makeAddr("v2fee");
        address weth = makeAddr("v2weth");
        vm.setEnv("CONFIRM_FUND_PHASE2_V2_DEPLOY", "yes");
        vm.setEnv("FUND_V2_DEPLOY_PK", vm.toString(pk));
        vm.setEnv("FUND_V2_FEE_RECIPIENT", vm.toString(feeRecipient));
        vm.setEnv("FUND_V2_WETH", vm.toString(weth));
        vm.setEnv("FUND_V2_DELAY", vm.toString(uint256(2 days)));

        (FundFactoryV2 factory, FundAllowlistV2 allowlist,) = script.run();
        assertEq(factory.owner(), deployer);
        assertEq(allowlist.owner(), deployer);
        assertEq(factory.feeRecipient(), feeRecipient);
        assertEq(factory.weth(), weth);
        assertTrue(allowlist.assetAllowed(weth));
        assertEq(allowlist.routerCount(), 0);
        assertEq(factory.allFundsLength(), 0);
    }
}
