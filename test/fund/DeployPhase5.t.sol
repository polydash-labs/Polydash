// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployPhase5} from "../../script/DeployPhase5.s.sol";
import {FundPhase5} from "../../src/fund/phase5/FundPhase5.sol";

contract Phase5FactoryStub {
    address public weth;

    constructor(address nextWeth) {
        weth = nextWeth;
    }

    function isFund(address) external pure returns (bool) {
        return false;
    }
}

contract DeployPhase5Test is Test {
    function test_script_requires_confirm_then_deploys() public {
        DeployPhase5 script = new DeployPhase5();
        vm.setEnv("CONFIRM_FUND_PHASE5_DEPLOY", "no");
        vm.expectRevert(DeployPhase5.DeployNotConfirmed.selector);
        script.run();

        (address deployer, uint256 pk) = makeAddrAndKey("phase5Deployer");
        address weth = makeAddr("phase5Weth");
        Phase5FactoryStub stub = new Phase5FactoryStub(weth);
        vm.setEnv("CONFIRM_FUND_PHASE5_DEPLOY", "yes");
        vm.setEnv("DEPLOY_FUND_PHASE5_PK", vm.toString(pk));
        vm.setEnv("FUND_PHASE3_FACTORY", vm.toString(address(stub)));

        FundPhase5 phase5 = script.run();
        assertEq(address(phase5.factory()), address(stub));
        assertEq(phase5.factory().weth(), weth);
        assertGt(phase5.market().code.length, 0);
        assertGt(phase5.renderer().code.length, 0);
        assertGt(phase5.locks().code.length, 0);
        assertGt(phase5.carry().code.length, 0);
        assertGt(phase5.navFloor().code.length, 0);
        assertEq(vm.addr(pk), deployer);
    }

    function test_constructor_rejects_an_empty_factory() public {
        vm.expectRevert(FundPhase5.BadFactory.selector);
        new FundPhase5(address(0));
        vm.expectRevert(FundPhase5.BadFactory.selector);
        new FundPhase5(address(1));

        Phase5FactoryStub stub = new Phase5FactoryStub(address(0));
        vm.expectRevert(FundPhase5.BadFactory.selector);
        new FundPhase5(address(stub));
    }
}
