// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployFundFactory} from "../../script/DeployFundFactory.s.sol";
import {FundFactory} from "../../src/fund/FundFactory.sol";

contract DeployFundFactoryTest is Test {
    function test_deployScript() public {
        (address deployer, uint256 pk) = makeAddrAndKey("fundDeployer"); // throwaway test key
        // FEE_RECIPIENT is process-global. Keep it equal to test/Deploy.t.sol.
        address feeRecipient = address(0xBEEF);
        // Distinct from PRIVATE_KEY so this test does not race script/Deploy.s.sol in one forge process.
        vm.setEnv("DEPLOY_FUND_FACTORY_PK", vm.toString(pk));
        vm.setEnv("FEE_RECIPIENT", vm.toString(feeRecipient));

        FundFactory factory = new DeployFundFactory().run();

        assertEq(factory.owner(), deployer);
        assertEq(factory.feeRecipient(), feeRecipient);
        assertEq(factory.allFundsLength(), 0);
    }
}
