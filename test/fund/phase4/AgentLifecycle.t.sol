// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AgentExecutor} from "../../../src/fund/phase4/AgentExecutor.sol";
import {AgentRegistry} from "../../../src/fund/phase4/AgentRegistry.sol";
import {AgentStrategies} from "../../../src/fund/phase4/AgentStrategies.sol";
import {Instruction} from "../../../src/fund/phase4/AgentTypes.sol";
import {FundNFTInvest} from "../../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../../src/fund/phase2/FundVaultInvest.sol";
import {FundFactoryInvest} from "../../../src/fund/phase2/FundFactoryInvest.sol";
import {Phase4Setup} from "./Phase4Setup.sol";

/// @notice End-to-end: create a fund via the factory, close the raise, mint the manager skin,
///         enable investing, authorize the executor, let the agent trade, watch NAV move, and
///         let a holder exit for their share.
contract AgentLifecycleTest is Phase4Setup {
    function test_full_lifecycle_create_trade_profit_exit() public {
        FundFactoryInvest.Params memory p = _params();
        p.mintPrice = 0.5 ether;
        p.raiseCap = 2 ether;
        p.minSkinBps = 5000; // Skin is 2 of 4 units; the manager mints 2, Alice mints 2.
        FundNFTInvest nft = _create(p);
        FundVaultInvest vault = nft.vault();

        vm.prank(manager);
        nft.mint{value: 1 ether}(2);
        assertTrue(nft.publicOpen());
        vm.prank(alice);
        nft.mint{value: 1 ether}(2);
        assertEq(nft.balanceOf(manager), 2);
        assertEq(nft.balanceOf(alice), 2);
        assertEq(uint8(vault.status()), 1); // RaisingClosed.

        vm.prank(manager);
        vault.enableInvesting();
        assertEq(uint8(vault.status()), 2); // Investing.
        uint256 navBefore = vault.nav();

        AgentExecutor executor = _deployExecutor(vault, AgentStrategies.defaults(4, 1));
        vm.prank(manager);
        uint256 agentId = registry.registerAgent(
            AgentRegistry.Agent({
                fund: address(nft),
                vault: address(vault),
                executor: address(executor),
                creator: manager,
                agentKey: agentKey,
                name: "BalancedBot",
                logoURI: "ipfs://logo",
                description: "Keeps the mix",
                templateId: 4,
                runnerMode: 1,
                strategyHash: keccak256("balanced"),
                rulesHash: keccak256("rules"),
                createdAt: 0,
                active: false
            })
        );
        assertEq(agentId, 1);
        assertEq(registry.agentOfFund(address(nft)), 1);
        assertTrue(registry.getAgent(1).active);

        _authorize(vault, executor);

        // The agent buys 0.5 ETH of alpha.
        Instruction memory buy = _buyIx(executor, 0.5 ether, 0.5 ether);
        (bool ok,) = executor.validate(buy, _signAgent(executor, buy));
        assertTrue(ok);
        executor.execute(buy, _signAgent(executor, buy));
        assertEq(alpha.balanceOf(address(vault)), 0.5 ether);
        assertEq(vault.nav(), navBefore);

        // Alpha rises 50%; the agent sells the whole position for 0.75 ETH.
        vm.warp(block.timestamp + 12 hours);
        feed.setPrice(1.5 ether);
        router.setEthPerToken(1.5 ether);
        Instruction memory sell = _sellIx(executor, 0.5 ether, 0.75 ether);
        (ok,) = executor.validate(sell, _signAgent(executor, sell));
        assertTrue(ok);
        executor.execute(sell, _signAgent(executor, sell));
        assertEq(alpha.balanceOf(address(vault)), 0);
        assertGt(vault.nav(), navBefore);
        assertEq(vault.tradeCount(), 2);
        assertGt(executor.highWaterNavPerNft(), 0);

        // Alice exits both of her units (token ids 3 and 4) for her pro-rata share.
        uint256[] memory ids = new uint256[](2);
        ids[0] = 3;
        ids[1] = 4;
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        nft.exit(ids);
        uint256 paid = alice.balance - aliceBefore;
        assertEq(nft.balanceOf(alice), 0);
        assertEq(nft.outstanding(), 2);
        // NAV was ~2.2496 ETH for 4 units; two units pay just over 1.1 ETH.
        assertGt(paid, 1.1 ether);
        assertEq(address(vault).balance, vault.nav() + vault.claimableFees());
    }

    function test_manager_can_revoke_and_retire_the_agent_mid_lifecycle() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);
        AgentExecutor executor = _deployExecutor(vault, AgentStrategies.defaults(1, 1));
        vm.prank(manager);
        registry.registerAgent(
            AgentRegistry.Agent({
                fund: address(nft),
                vault: address(vault),
                executor: address(executor),
                creator: manager,
                agentKey: agentKey,
                name: "DipBot",
                logoURI: "",
                description: "",
                templateId: 1,
                runnerMode: 0,
                strategyHash: bytes32(0),
                rulesHash: bytes32(0),
                createdAt: 0,
                active: false
            })
        );
        _authorize(vault, executor);
        _executeBuy(executor, 0.1 ether, 0.1 ether);

        // One transaction each: revoke the executor, retire the executor, retire the registry entry.
        vm.prank(manager);
        vault.setExecutor(address(executor), false);
        vm.prank(manager);
        executor.retire();
        vm.prank(manager);
        registry.retireAgent(1);

        assertFalse(registry.getAgent(1).active);
        assertTrue(executor.retired());
        vm.warp(block.timestamp + 1 hours);
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        (bool ok, string memory reason) = executor.validate(ix, _signAgent(executor, ix));
        assertFalse(ok);
        assertEq(reason, "paused");
        vm.expectRevert(AgentExecutor.ExecutorPaused.selector);
        executor.execute(ix, _signAgent(executor, ix));
    }
}
