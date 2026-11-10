// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployFundPhase4} from "../../script/DeployFundPhase4.s.sol";
import {FundPhase4} from "../../src/fund/phase4/FundPhase4.sol";

contract Phase4FactoryStub {
    address public weth;

    constructor(address nextWeth) {
        weth = nextWeth;
    }

    function isFund(address) external pure returns (bool) {
        return false;
    }
}

contract DeployFundPhase4Test is Test {
    function test_script_requires_confirm_then_deploys() public {
        DeployFundPhase4 script = new DeployFundPhase4();
        vm.setEnv("CONFIRM_FUND_PHASE4_DEPLOY", "no");
        vm.expectRevert(DeployFundPhase4.DeployNotConfirmed.selector);
        script.run();

        (address deployer, uint256 pk) = makeAddrAndKey("phase4Deployer");
        address weth = makeAddr("phase4Weth");
        Phase4FactoryStub stub = new Phase4FactoryStub(weth);
        vm.setEnv("CONFIRM_FUND_PHASE4_DEPLOY", "yes");
        vm.setEnv("DEPLOY_FUND_PHASE4_PK", vm.toString(pk));
        vm.setEnv("FUND_PHASE3_FACTORY", vm.toString(address(stub)));

        FundPhase4 phase4 = script.run();
        assertEq(address(phase4.factory()), address(stub));
        assertEq(phase4.weth(), weth);
        assertGt(phase4.shareAccount().code.length, 0);
        assertEq(phase4.ERC6551_REGISTRY(), 0x000000006551c19487814612e58FE06813775758);
        assertFalse(phase4.shareAccountsEnabled());
        assertEq(vm.addr(pk), deployer);
    }
}
