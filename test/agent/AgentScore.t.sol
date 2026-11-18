// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../../src/agent/AgentRegistry.sol";
import {AgentScore} from "../../src/agent/AgentScore.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract AgentScoreTest is Test {
    AgentRegistry public registry;
    AgentScore public score;
    MockERC20 public polydash;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public updater = makeAddr("updater");
    address public accountA = makeAddr("accountA");

    uint256 public constant STAKE = 1000 ether;

    event ScoreUpdated(
        uint256 indexed agentId,
        uint16 score,
        uint16 performance,
        uint16 history,
        uint16 activity,
        uint16 stake,
        uint16 conduct,
        bytes32 inputsHash,
        uint64 updatedAt
    );

    // Components that give a score of 738:
    // W = 35*800 + 20*900 + 15*700 + 15*600 + 15*950 = 79,750
    // score = 300 + 79,750*550/100,000 = 300 + 438 = 738.
    uint16[5] public goodComponents = [uint16(800), uint16(900), uint16(700), uint16(600), uint16(950)];

    function setUp() public {
        polydash = new MockERC20("Polydash", "POLYDASH", 0);
        registry = new AgentRegistry(address(polydash), address(0));
        score = new AgentScore(address(registry), updater);
        polydash.mint(alice, 100_000 ether);
        polydash.mint(bob, 100_000 ether);
        vm.startPrank(alice);
        polydash.approve(address(registry), STAKE);
        registry.registerAgent("Atlas", alice, accountA);
        vm.stopPrank();
    }

    function testWeightedScoreBounds() public view {
        assertEq(score.weightedScore(0, 0, 0, 0, 0), 300);
        assertEq(score.weightedScore(1000, 1000, 1000, 1000, 1000), 850);
    }

    function testWeightedScoreExample() public view {
        assertEq(score.weightedScore(800, 900, 700, 600, 950), 738);
    }

    function testWeightedScoreSingleComponent() public view {
        // Only performance at max: 300 + 35*1000*550/100,000 = 300 + 192 = 492.
        assertEq(score.weightedScore(1000, 0, 0, 0, 0), 492);
        // Only history at max: 300 + 20*1000*550/100,000 = 300 + 110 = 410.
        assertEq(score.weightedScore(0, 1000, 0, 0, 0), 410);
        // All at 500: 300 + 50,000*550/100,000 = 300 + 275 = 575.
        assertEq(score.weightedScore(500, 500, 500, 500, 500), 575);
    }

    function testUpdateScore() public {
        bytes32 inputsHash = keccak256("atlas-inputs-v1");
        vm.expectEmit(true, false, false, false);
        emit ScoreUpdated(1, 738, 800, 900, 700, 600, 950, inputsHash, uint64(block.timestamp));
        vm.prank(updater);
        score.updateScore(1, 738, goodComponents, inputsHash);
        AgentScore.Score memory s = score.getScore(1);
        assertEq(s.score, 738);
        assertEq(s.performance, 800);
        assertEq(s.history, 900);
        assertEq(s.activity, 700);
        assertEq(s.stake, 600);
        assertEq(s.conduct, 950);
        assertEq(s.inputsHash, inputsHash);
        assertTrue(s.exists);
        assertGt(s.updatedAt, 0);
        assertEq(score.scoreOf(1), 738);
        assertEq(score.bandOf(1), 3); // 738 is Prime (700-799).
    }

    function testUpdateScoreRevertsNonUpdater() public {
        vm.prank(bob);
        vm.expectRevert(AgentScore.NotUpdater.selector);
        score.updateScore(1, 738, goodComponents, bytes32(0));
    }

    function testUpdateScoreRevertsUnregisteredAgent() public {
        vm.prank(updater);
        vm.expectRevert(AgentScore.AgentNotRegistered.selector);
        score.updateScore(999, 738, goodComponents, bytes32(0));
    }

    function testUpdateScoreRevertsScoreOutOfRange() public {
        vm.startPrank(updater);
        vm.expectRevert(AgentScore.ScoreOutOfRange.selector);
        score.updateScore(1, 851, goodComponents, bytes32(0));
        vm.expectRevert(AgentScore.ScoreOutOfRange.selector);
        score.updateScore(1, 299, goodComponents, bytes32(0));
        vm.stopPrank();
    }

    function testUpdateScoreRevertsComponentOutOfRange() public {
        uint16[5] memory bad = [uint16(1001), uint16(900), uint16(700), uint16(600), uint16(950)];
        vm.prank(updater);
        vm.expectRevert(AgentScore.ComponentOutOfRange.selector);
        score.updateScore(1, 738, bad, bytes32(0));
    }

    function testUpdateScoreRevertsScoreMismatch() public {
        vm.prank(updater);
        vm.expectRevert(AgentScore.ScoreMismatch.selector);
        score.updateScore(1, 700, goodComponents, bytes32(0));
    }

    function testSetUpdater() public {
        address next = makeAddr("updater2");
        score.setUpdater(next);
        assertEq(score.updater(), next);
        // Old updater can no longer post.
        vm.prank(updater);
        vm.expectRevert(AgentScore.NotUpdater.selector);
        score.updateScore(1, 738, goodComponents, bytes32(0));
        // New updater can.
        vm.prank(next);
        score.updateScore(1, 738, goodComponents, bytes32(0));
        assertEq(score.scoreOf(1), 738);
    }

    function testSetUpdaterRevertsNonOwner() public {
        vm.prank(bob);
        vm.expectRevert(AgentScore.NotOwner.selector);
        score.setUpdater(bob);
    }

    function testBandForScoreBoundaries() public view {
        assertEq(score.bandForScore(300), 0); // New
        assertEq(score.bandForScore(499), 0);
        assertEq(score.bandForScore(500), 1); // Building
        assertEq(score.bandForScore(599), 1);
        assertEq(score.bandForScore(600), 2); // Standard
        assertEq(score.bandForScore(699), 2);
        assertEq(score.bandForScore(700), 3); // Prime
        assertEq(score.bandForScore(799), 3);
        assertEq(score.bandForScore(800), 4); // Elite
        assertEq(score.bandForScore(850), 4);
    }

    function testScoreOfUnscored() public view {
        assertEq(score.scoreOf(1), 0);
        assertEq(score.bandOf(1), 0);
        assertFalse(score.getScore(1).exists);
    }

    function testUpdateScoreAfterUnregisterReverts() public {
        vm.prank(alice);
        registry.unregisterAgent(1);
        vm.prank(updater);
        vm.expectRevert(AgentScore.AgentNotRegistered.selector);
        score.updateScore(1, 738, goodComponents, bytes32(0));
    }
}
