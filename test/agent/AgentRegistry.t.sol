// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../../src/agent/AgentRegistry.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract AgentRegistryTest is Test {
    AgentRegistry public registry;
    MockERC20 public polydash;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");
    address public accountA = makeAddr("accountA");
    address public accountB = makeAddr("accountB");

    uint256 public constant STAKE = 1_000 ether;

    event AgentRegistered(
        uint256 indexed agentId, address indexed wallet, address indexed agentAccount, string name
    );
    event AgentUpdated(
        uint256 indexed agentId, address indexed wallet, address indexed agentAccount, string name
    );
    event AgentUnregistered(uint256 indexed agentId, address indexed wallet, uint256 stakeReturned);
    event AgentSlashed(uint256 indexed agentId, uint256 amount, uint256 remainingStake);

    function setUp() public {
        polydash = new MockERC20("Polydash", "POLYDASH", 0);
        registry = new AgentRegistry(address(polydash), address(0));
        polydash.mint(alice, 100_000 ether);
        polydash.mint(bob, 100_000 ether);
        polydash.mint(carol, 100_000 ether);
    }

    function _registerAlice() internal returns (uint256) {
        vm.startPrank(alice);
        polydash.approve(address(registry), STAKE);
        uint256 id = registry.registerAgent("Atlas", alice, accountA);
        vm.stopPrank();
        return id;
    }

    function testRegister() public {
        vm.startPrank(alice);
        polydash.approve(address(registry), STAKE);
        vm.expectEmit(true, true, true, true);
        emit AgentRegistered(1, alice, accountA, "Atlas");
        uint256 id = registry.registerAgent("Atlas", alice, accountA);
        vm.stopPrank();
        assertEq(id, 1);
        assertEq(registry.agentCount(), 1);
        AgentRegistry.Agent memory a = registry.getAgent(1);
        assertEq(a.wallet, alice);
        assertEq(a.agentAccount, accountA);
        assertEq(a.name, "Atlas");
        assertEq(a.stake, STAKE);
        assertTrue(a.active);
        assertGt(a.registeredAt, 0);
        assertEq(registry.agentIdByWallet(alice), 1);
        assertEq(registry.agentIdByAccount(accountA), 1);
        assertTrue(registry.isRegistered(1));
        assertEq(polydash.balanceOf(address(registry)), STAKE);
        assertEq(polydash.balanceOf(alice), 100_000 ether - STAKE);
    }

    function testRegisterZeroAccountOk() public {
        vm.startPrank(bob);
        polydash.approve(address(registry), STAKE);
        uint256 id = registry.registerAgent("Bob", bob, address(0));
        vm.stopPrank();
        assertEq(id, 1);
        assertEq(registry.getAgent(1).agentAccount, address(0));
        assertTrue(registry.isRegistered(1));
    }

    function testRegisterRevertsWithoutApproval() public {
        vm.prank(bob);
        vm.expectRevert();
        registry.registerAgent("Bob", bob, accountB);
    }

    function testRegisterRevertsInsufficientBalance() public {
        address poor = makeAddr("poor");
        polydash.mint(poor, 10 ether);
        vm.startPrank(poor);
        polydash.approve(address(registry), STAKE);
        vm.expectRevert();
        registry.registerAgent("Poor", poor, address(0));
        vm.stopPrank();
    }

    function testRegisterRevertsEmptyName() public {
        vm.startPrank(bob);
        polydash.approve(address(registry), STAKE);
        vm.expectRevert(AgentRegistry.EmptyName.selector);
        registry.registerAgent("", bob, accountB);
        vm.stopPrank();
    }

    function testRegisterRevertsZeroWallet() public {
        vm.startPrank(bob);
        polydash.approve(address(registry), STAKE);
        vm.expectRevert(AgentRegistry.ZeroWallet.selector);
        registry.registerAgent("Bob", address(0), accountB);
        vm.stopPrank();
    }

    function testRegisterRevertsDuplicateWallet() public {
        _registerAlice();
        vm.startPrank(alice);
        polydash.approve(address(registry), STAKE);
        vm.expectRevert(AgentRegistry.AlreadyRegistered.selector);
        registry.registerAgent("Atlas2", alice, accountB);
        vm.stopPrank();
    }

    function testRegisterRevertsDuplicateAccount() public {
        _registerAlice();
        vm.startPrank(bob);
        polydash.approve(address(registry), STAKE);
        vm.expectRevert(AgentRegistry.AccountAlreadyRegistered.selector);
        registry.registerAgent("Bob", bob, accountA);
        vm.stopPrank();
    }

    function testUpdateAgent() public {
        uint256 id = _registerAlice();
        vm.expectEmit(true, true, true, true);
        emit AgentUpdated(id, alice, accountB, "Atlas v2");
        vm.prank(alice);
        registry.updateAgent(id, "Atlas v2", accountB);
        AgentRegistry.Agent memory a = registry.getAgent(id);
        assertEq(a.name, "Atlas v2");
        assertEq(a.agentAccount, accountB);
        assertEq(registry.agentIdByAccount(accountB), id);
        assertEq(registry.agentIdByAccount(accountA), 0);
    }

    function testUpdateAgentRevertsNonWallet() public {
        uint256 id = _registerAlice();
        vm.prank(bob);
        vm.expectRevert(AgentRegistry.NotAgentWallet.selector);
        registry.updateAgent(id, "Hacked", accountB);
    }

    function testUpdateAgentRevertsDuplicateAccount() public {
        uint256 id = _registerAlice();
        vm.startPrank(bob);
        polydash.approve(address(registry), STAKE);
        registry.registerAgent("Bob", bob, accountB);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.AccountAlreadyRegistered.selector);
        registry.updateAgent(id, "Atlas", accountB);
    }

    function testUnregisterReturnsStake() public {
        uint256 id = _registerAlice();
        uint256 before = polydash.balanceOf(alice);
        vm.expectEmit(true, true, false, true);
        emit AgentUnregistered(id, alice, STAKE);
        vm.prank(alice);
        registry.unregisterAgent(id);
        assertFalse(registry.isRegistered(id));
        assertEq(polydash.balanceOf(alice), before + STAKE);
        assertEq(polydash.balanceOf(address(registry)), 0);
        assertEq(registry.agentIdByWallet(alice), 0);
        // Wallet may register again as a new id.
        vm.startPrank(alice);
        polydash.approve(address(registry), STAKE);
        uint256 id2 = registry.registerAgent("Atlas", alice, accountA);
        vm.stopPrank();
        assertEq(id2, 2);
    }

    function testUnregisterRevertsNonWallet() public {
        uint256 id = _registerAlice();
        vm.prank(bob);
        vm.expectRevert(AgentRegistry.NotAgentWallet.selector);
        registry.unregisterAgent(id);
    }

    function testSlashPartial() public {
        uint256 id = _registerAlice();
        // Owner is the test contract; slashRecipient defaults to owner.
        // MockERC20 minted 1e30 to the test contract at deploy, so assert
        // the balance *increased* by the slashed amount.
        uint256 before = polydash.balanceOf(address(this));
        vm.expectEmit(true, false, false, true);
        emit AgentSlashed(id, 400 ether, 600 ether);
        registry.slashAgent(id, 400 ether);
        assertEq(registry.getAgent(id).stake, 600 ether);
        assertTrue(registry.isRegistered(id));
        assertEq(polydash.balanceOf(address(this)), before + 400 ether);
    }

    function testSlashFullDeactivates() public {
        uint256 id = _registerAlice();
        registry.slashAgent(id, STAKE);
        assertEq(registry.getAgent(id).stake, 0);
        assertFalse(registry.isRegistered(id));
        // Wallet stays bound and cannot re-register after a full slash.
        vm.startPrank(alice);
        polydash.approve(address(registry), STAKE);
        vm.expectRevert(AgentRegistry.AlreadyRegistered.selector);
        registry.registerAgent("Atlas", alice, accountA);
        vm.stopPrank();
    }

    function testSlashRevertsNonOwner() public {
        uint256 id = _registerAlice();
        vm.prank(bob);
        vm.expectRevert(AgentRegistry.NotOwner.selector);
        registry.slashAgent(id, 1 ether);
    }

    function testSlashRevertsMoreThanStake() public {
        uint256 id = _registerAlice();
        vm.expectRevert(AgentRegistry.InsufficientStake.selector);
        registry.slashAgent(id, STAKE + 1);
    }

    function testSlashRevertsZeroAmount() public {
        uint256 id = _registerAlice();
        vm.expectRevert(AgentRegistry.InsufficientStake.selector);
        registry.slashAgent(id, 0);
    }
}
