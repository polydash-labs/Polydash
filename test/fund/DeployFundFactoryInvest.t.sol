// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployFundFactoryInvest} from "../../script/DeployFundFactoryInvest.s.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../src/fund/phase2/FundFactoryInvest.sol";

contract DeployFundFactoryInvestTest is Test {
    function test_script_requires_confirm_then_deploys() public {
        DeployFundFactoryInvest script = new DeployFundFactoryInvest();
        vm.setEnv("CONFIRM_FUND_PHASE2_DEPLOY", "no");
        vm.expectRevert(DeployFundFactoryInvest.DeployNotConfirmed.selector);
        script.run();

        (address deployer, uint256 pk) = makeAddrAndKey("fundInvestDeployer");
        address feeRecipient = makeAddr("fundInvestFee");
        address weth = makeAddr("fundInvestWeth");
        vm.setEnv("CONFIRM_FUND_PHASE2_DEPLOY", "yes");
        vm.setEnv("DEPLOY_FUND_INVEST_PK", vm.toString(pk));
        vm.setEnv("FUND_INVEST_FEE_RECIPIENT", vm.toString(feeRecipient));
        vm.setEnv("FUND_INVEST_WETH", vm.toString(weth));
        vm.setEnv("FUND_INVEST_DELAY", vm.toString(uint256(2 days)));

        (FundFactoryInvest factory, FundAllowlist allowlist,) = script.run();

        assertEq(factory.owner(), deployer);
        assertEq(factory.feeRecipient(), feeRecipient);
        assertEq(factory.weth(), weth);
        assertEq(address(factory.allowlist()), address(allowlist));
        assertEq(allowlist.owner(), deployer);
        assertEq(allowlist.delay(), 2 days);
        assertTrue(allowlist.assetAllowed(weth));
        assertEq(allowlist.routerCount(), 0);
        assertEq(factory.allFundsLength(), 0);
    }
}
