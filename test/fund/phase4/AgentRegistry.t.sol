// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AgentRegistry} from "../../../src/fund/phase4/AgentRegistry.sol";
import {AgentStrategies} from "../../../src/fund/phase4/AgentStrategies.sol";
import {StrategyParams} from "../../../src/fund/phase4/AgentTypes.sol";
import {FundNFTInvest} from "../../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../../src/fund/phase2/FundVaultInvest.sol";
import {Phase4Setup} from "./Phase4Setup.sol";

contract AgentRegistryTest is Phase4Setup {
    function _agent(FundNFTInvest nft, FundVaultInvest vault, string memory name)
        internal
        returns (AgentRegistry.Agent memory a)
    {
        a.fund = address(nft);
        a.vault = address(vault);
        a.executor = makeAddr("executor");
        a.creator = manager;
        a.agentKey = agentKey;
        a.name = name;
        a.logoURI = "ipfs://logo";
        a.description = "Buys the dips";
        a.templateId = 1;
        a.runnerMode = 0;
        a.strategyHash = keccak256("strategy");
        a.rulesHash = keccak256("rules");
    }

    function _register(string memory name) internal returns (uint256 agentId, FundNFTInvest nft) {
        nft = _create(_params());
        FundVaultInvest vault = nft.vault();
        vm.prank(manager);
        agentId = registry.registerAgent(_agent(nft, vault, name));
    }

    function test_register_stores_agent_and_lookups_work() public {
        (uint256 id, FundNFTInvest nft) = _register("DipBot");
        assertEq(id, 1);
        assertEq(registry.agentCount(), 1);
        assertEq(registry.agentOfFund(address(nft)), 1);

        AgentRegistry.Agent memory a = registry.getAgent(1);
        assertEq(a.fund, address(nft));
        assertEq(a.creator, manager);
        assertEq(a.agentKey, agentKey);
        assertEq(a.name, "DipBot");
        assertEq(a.logoURI, "ipfs://logo");
        assertEq(a.description, "Buys the dips");
        assertEq(a.templateId, 1);
        assertEq(a.runnerMode, 0);
        assertEq(a.strategyHash, keccak256("strategy"));
        assertEq(a.rulesHash, keccak256("rules"));
        assertEq(a.createdAt, uint64(block.timestamp));
        assertTrue(a.active);

        uint256[] memory mine = registry.agentsByCreator(manager);
        assertEq(mine.length, 1);
        assertEq(mine[0], 1);
        uint256[] memory active = registry.activeAgents(0, 10);
        assertEq(active.length, 1);
        assertEq(active[0], 1);
    }

    function test_register_requires_the_vault_manager() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = nft.vault();
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.NotManager.selector);
        registry.registerAgent(_agent(nft, vault, "Nope"));
    }

    function test_register_rejects_a_second_agent_for_the_same_fund() public {
        (uint256 id, FundNFTInvest nft) = _register("First");
        assertEq(id, 1);
        FundVaultInvest vault = nft.vault();
        vm.prank(manager);
        vm.expectRevert(AgentRegistry.AlreadyRegistered.selector);
        registry.registerAgent(_agent(nft, vault, "Second"));
    }

    function test_register_rejects_zero_addresses() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = nft.vault();
        AgentRegistry.Agent memory a = _agent(nft, vault, "Bad");
        a.fund = address(0);
        vm.prank(manager);
        vm.expectRevert(AgentRegistry.InvalidAgent.selector);
        registry.registerAgent(a);
    }

    function test_update_agent_creator_only() public {
        (uint256 id,) = _register("DipBot");
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.NotCreator.selector);
        registry.updateAgent(id, "ipfs://new", "New words", keccak256("new-rules"));

        vm.prank(manager);
        registry.updateAgent(id, "ipfs://new", "New words", keccak256("new-rules"));
        AgentRegistry.Agent memory a = registry.getAgent(id);
        assertEq(a.logoURI, "ipfs://new");
        assertEq(a.description, "New words");
        assertEq(a.rulesHash, keccak256("new-rules"));
        assertTrue(a.active);
    }

    function test_retire_agent_creator_only_and_drops_from_active_list() public {
        (uint256 first,) = _register("One");
        (uint256 second,) = _register("Two");
        assertEq(registry.agentCount(), 2);

        uint256[] memory active = registry.activeAgents(0, 10);
        assertEq(active.length, 2);
        assertEq(active[0], second); // Newest first.
        assertEq(active[1], first);

        uint256[] memory page = registry.activeAgents(1, 1);
        assertEq(page.length, 1);
        assertEq(page[0], first);
        assertEq(registry.activeAgents(2, 10).length, 0);
        assertEq(registry.activeAgents(0, 0).length, 0);

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.NotCreator.selector);
        registry.retireAgent(second);

        vm.prank(manager);
        registry.retireAgent(second);
        assertFalse(registry.getAgent(second).active);
        active = registry.activeAgents(0, 10);
        assertEq(active.length, 1);
        assertEq(active[0], first);
        // Retired agents stay listed under their creator.
        assertEq(registry.agentsByCreator(manager).length, 2);
    }

    function test_unknown_agent_reverts() public {
        vm.expectRevert(AgentRegistry.UnknownAgent.selector);
        registry.getAgent(1);
        vm.expectRevert(AgentRegistry.UnknownAgent.selector);
        registry.getAgent(99);
        vm.prank(manager);
        vm.expectRevert(AgentRegistry.UnknownAgent.selector);
        registry.updateAgent(1, "", "", bytes32(0));
        vm.prank(manager);
        vm.expectRevert(AgentRegistry.UnknownAgent.selector);
        registry.retireAgent(1);
    }
}

/// @notice External wrapper around the internal `AgentStrategies` library, so tests can
///         observe its reverts with `vm.expectRevert` (inlined internal calls revert at the
///         same depth as the cheatcode call, which `expectRevert` cannot catch).
contract StrategiesHarness {
    function templateName(uint8 templateId) external pure returns (string memory) {
        return AgentStrategies.templateName(templateId);
    }

    function defaults(uint8 templateId, uint8 riskLevel) external pure returns (StrategyParams memory) {
        return AgentStrategies.defaults(templateId, riskLevel);
    }
}

contract AgentStrategiesTest is Phase4Setup {
    StrategiesHarness internal harness;

    function setUp() public override {
        super.setUp();
        harness = new StrategiesHarness();
    }

    function test_template_names() public {
        assertEq(AgentStrategies.templateName(0), "Momentum");
        assertEq(AgentStrategies.templateName(1), "DipBuyer");
        assertEq(AgentStrategies.templateName(2), "Defensive");
        assertEq(AgentStrategies.templateName(3), "Dca");
        assertEq(AgentStrategies.templateName(4), "Balanced");
        assertEq(AgentStrategies.templateName(5), "Custom");
        vm.expectRevert(AgentStrategies.InvalidTemplate.selector);
        harness.templateName(6);
    }

    function test_defaults_conservative_momentum() public {
        StrategyParams memory p = AgentStrategies.defaults(0, 0);
        assertEq(p.templateId, 0);
        assertEq(p.riskLevel, 0);
        assertEq(p.maxPositionBps, 3000);
        assertEq(p.maxTradeBps, 2000);
        assertEq(p.maxDeviationBps, 0);
        assertEq(p.dailyTradeLimit, 3);
        assertEq(p.circuitBreakerBps, 500);
        assertEq(p.rebalanceIntervalSeconds, 4 hours);
        assertEq(p.rulesHash, bytes32(0));
    }

    function test_defaults_balanced_dip_buyer() public {
        StrategyParams memory p = AgentStrategies.defaults(1, 1);
        assertEq(p.maxPositionBps, 5000);
        assertEq(p.maxTradeBps, 5000);
        assertEq(p.dailyTradeLimit, 6);
        assertEq(p.circuitBreakerBps, 1000);
        assertEq(p.rebalanceIntervalSeconds, 1 hours);
    }

    function test_defaults_aggressive_defensive_and_dca() public {
        StrategyParams memory p = AgentStrategies.defaults(2, 2);
        assertEq(p.maxPositionBps, 7500);
        assertEq(p.maxTradeBps, 7500);
        assertEq(p.dailyTradeLimit, 12);
        assertEq(p.circuitBreakerBps, 2000);
        assertEq(p.rebalanceIntervalSeconds, 24 hours);

        p = AgentStrategies.defaults(3, 1);
        assertEq(p.rebalanceIntervalSeconds, 24 hours);
        p = AgentStrategies.defaults(4, 1);
        assertEq(p.rebalanceIntervalSeconds, 12 hours);
        p = AgentStrategies.defaults(5, 0);
        assertEq(p.rebalanceIntervalSeconds, 12 hours);
        assertEq(p.maxPositionBps, 3000);
    }

    function test_defaults_reject_bad_template_and_risk() public {
        vm.expectRevert(AgentStrategies.InvalidTemplate.selector);
        harness.defaults(6, 1);
        vm.expectRevert(AgentStrategies.InvalidRiskLevel.selector);
        harness.defaults(0, 3);
    }
}
