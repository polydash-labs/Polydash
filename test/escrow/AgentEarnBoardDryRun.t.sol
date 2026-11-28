// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentEarnEscrow} from "../../src/escrow/AgentEarnEscrow.sol";

/// @notice Pilot dry run against the REAL deployed escrow on a Robinhood
///         Chain fork — no real funds, no real jobs, no real locks.
///
///         Run:  forge test --match-contract AgentEarnBoardDryRunTest -vv
///         RPC:  ROBINHOOD_RPC_URL env var, else the public Hood RPC.
///
///         Covers the three settlement paths the board must drive:
///           1. Accept — poster releases, agent takes home net of the 2.5% fee.
///           2. Panel dispute — 72h of poster silence, then the 2-of-3
///              multisig resolves PayPart 50/50; fee comes from the agent's
///              share only.
///           3. Lapse — claimed but never delivered; the multisig refunds the
///              poster in full, no fee.
///
///         The board's own flows (screening, claiming eligibility, ballot
///         recording, receipt publishing) are off-chain and are covered by
///         scripts/verify-agent-earn.ts in the site repo, not here.
contract AgentEarnBoardDryRunTest is Test {
    AgentEarnEscrow internal escrow;
    IERC20 internal usdg;

    address internal constant ESCROW = 0xb0A3fE7240a0b1a10177651FE985c3FDbB9dda7c;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant PANEL_EXECUTOR = 0xB33F146d25C85F9E1ECaf0E82691CB1335fF521d;
    address internal constant FEE_WALLET = 0x9a21c75aC263cC43125E70200636f6397f8776d0;

    address internal poster = makeAddr("dryrun-poster");
    address internal agent = makeAddr("dryrun-agent");
    address internal eval1 = makeAddr("dryrun-eval-1");
    address internal eval2 = makeAddr("dryrun-eval-2");
    address internal eval3 = makeAddr("dryrun-eval-3");

    uint256 internal constant TEN_USD = 10_000_000; // $10, 6 decimals
    uint256 internal constant FIFTY_USD = 50_000_000; // $50

    function setUp() public {
        string memory rpc = "https://rpc.mainnet.chain.robinhood.com";
        try vm.envString("ROBINHOOD_RPC_URL") returns (string memory v) {
            rpc = v;
        } catch {
            // No env var set — fall back to the public Hood RPC.
        }
        vm.createSelectFork(rpc);
        escrow = AgentEarnEscrow(ESCROW);
        usdg = IERC20(USDG);

        // The fork must be the real deployed escrow, not a redeploy.
        assertEq(address(escrow.token()), USDG, "escrow token is USDG");
        assertEq(escrow.panelExecutor(), PANEL_EXECUTOR, "panel executor is the 2-of-3 multisig");
        assertEq(escrow.feeRecipient(), FEE_WALLET, "fee recipient is the Polypad fee wallet");
        assertEq(escrow.feeBps(), 250, "live fee is 2.5%");
    }

    function _jobId(uint256 n) internal view returns (bytes32) {
        // Same shape as the board: keccak256(poster, nonce).
        return keccak256(abi.encodePacked(poster, bytes32(n)));
    }

    function _fundPoster(uint256 amount) internal {
        deal(address(usdg), poster, amount);
        assertEq(usdg.balanceOf(poster), amount, "poster funded on the fork");
    }

    function _lock(bytes32 jobId, uint256 amount) internal {
        vm.startPrank(poster);
        usdg.approve(address(escrow), amount);
        escrow.lock(jobId, amount);
        vm.stopPrank();
    }

    function _claim(bytes32 jobId) internal {
        vm.prank(agent);
        escrow.claim(jobId);
    }

    function _deliver(bytes32 jobId) internal {
        vm.prank(agent);
        escrow.deliver(jobId, keccak256("dry-run market-research report"));
    }

    /// @notice Accept path: $10 locked, claimed, delivered, released.
    ///         Agent takes home $9.75; the fee wallet takes $0.25.
    function testFork_AcceptPaysNet() public {
        bytes32 jobId = _jobId(1);
        _fundPoster(TEN_USD);
        _lock(jobId, TEN_USD);
        _claim(jobId);
        _deliver(jobId);

        uint256 agentBefore = usdg.balanceOf(agent);
        uint256 feeBefore = usdg.balanceOf(FEE_WALLET);

        vm.prank(poster);
        escrow.release(jobId);

        assertEq(usdg.balanceOf(agent) - agentBefore, 9_750_000, "agent takes home $9.75 net");
        assertEq(usdg.balanceOf(FEE_WALLET) - feeBefore, 250_000, "fee wallet takes $0.25");
        assertEq(usdg.balanceOf(address(escrow)), 0, "escrow holds nothing after release");

        AgentEarnEscrow.Lock memory l = escrow.getLock(jobId);
        assertEq(uint8(l.state), 2, "state is Released");
        assertEq(uint8(l.outcome), 1, "outcome is PayFull");
        assertEq(l.agentShare, TEN_USD, "agent share is the full $10");
        assertEq(l.feePaid, 250_000, "fee paid is $0.25");
        assertEq(l.feeBpsAtLock, 250, "fee snapshotted at lock");
    }

    /// @notice Panel path: $50 locked, claimed, delivered, then 72h of poster
    ///         silence. The multisig resolves PayPart 50/50. The agent's
    ///         $25 share loses the 2.5% fee ($0.625); the poster gets $25 back.
    function testFork_PanelPayPartAfterSilence() public {
        bytes32 jobId = _jobId(2);
        _fundPoster(FIFTY_USD);
        _lock(jobId, FIFTY_USD);
        _claim(jobId);
        _deliver(jobId);

        // 72h of poster silence — no accept, no dispute.
        vm.warp(block.timestamp + 72 hours + 1);

        uint256 agentBefore = usdg.balanceOf(agent);
        uint256 posterBefore = usdg.balanceOf(poster);
        uint256 feeBefore = usdg.balanceOf(FEE_WALLET);

        address[] memory voters = new address[](3);
        voters[0] = eval1;
        voters[1] = eval2;
        voters[2] = eval3;
        vm.prank(PANEL_EXECUTOR);
        escrow.panelResolve(jobId, AgentEarnEscrow.Outcome.PayPart, 5000, voters);

        assertEq(usdg.balanceOf(agent) - agentBefore, 24_375_000, "agent gets $25 minus $0.625 fee");
        assertEq(usdg.balanceOf(poster) - posterBefore, 25_000_000, "poster gets $25 back");
        assertEq(usdg.balanceOf(FEE_WALLET) - feeBefore, 625_000, "fee wallet takes $0.625");
        assertEq(usdg.balanceOf(address(escrow)), 0, "escrow holds nothing after panelResolve");

        AgentEarnEscrow.Lock memory l = escrow.getLock(jobId);
        assertEq(uint8(l.state), 4, "state is PanelResolved");
        assertEq(uint8(l.outcome), 2, "outcome is PayPart");
        assertEq(l.agentShare, 25_000_000, "agent share is $25");
        assertEq(l.posterShare, 25_000_000, "poster share is $25");
        assertEq(l.feePaid, 625_000, "fee paid is $0.625");
    }

    /// @notice Lapse path: $10 locked and claimed, but the agent never
    ///         delivers. After the deadline the multisig refunds the poster
    ///         in full — no fee, nothing to the agent.
    function testFork_LapseRefundsPosterInFull() public {
        bytes32 jobId = _jobId(3);
        _fundPoster(TEN_USD);
        _lock(jobId, TEN_USD);
        _claim(jobId);

        // Deadline passes with no delivery recorded.
        vm.warp(block.timestamp + 8 days);

        uint256 posterBefore = usdg.balanceOf(poster);
        uint256 feeBefore = usdg.balanceOf(FEE_WALLET);

        vm.prank(PANEL_EXECUTOR);
        escrow.refund(jobId);

        assertEq(usdg.balanceOf(poster) - posterBefore, TEN_USD, "poster refunded the full $10");
        assertEq(usdg.balanceOf(agent), 0, "agent gets nothing on a lapse");
        assertEq(usdg.balanceOf(FEE_WALLET) - feeBefore, 0, "no fee on a refund");
        assertEq(usdg.balanceOf(address(escrow)), 0, "escrow holds nothing after refund");

        AgentEarnEscrow.Lock memory l = escrow.getLock(jobId);
        assertEq(uint8(l.state), 3, "state is Refunded");
        assertEq(l.posterShare, TEN_USD, "poster share is the full $10");
        assertEq(l.feePaid, 0, "no fee paid");
    }
}
