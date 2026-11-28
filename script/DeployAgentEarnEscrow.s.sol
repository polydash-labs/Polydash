// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentEarnEscrow} from "../src/escrow/AgentEarnEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys AgentEarnEscrow for the agent-earn pilot (Option A).
/// @dev Env: PRIVATE_KEY (deployer; transient only — never commit), PANEL_EXECUTOR
///      (the 2-of-3 multisig address; never a single EOA).
///      Fixed deploy params (Jon, Nov 27 — custody A, fees B, rate 2.5%):
///        token         USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
///        feeBps        250 (LITERAL — solc 0.8.24 cannot read DEFAULT_FEE_BPS
///                      off the contract type in a script; do not "fix" this
///                      by referencing the constant)
///        feeRecipient  0x9a21c75aC263cC43125E70200636f6397f8776d0
///      forge script script/DeployAgentEarnEscrow.s.sol --rpc-url robinhood --broadcast
///      Then Sourcify-verify exact match before the board points at the address,
///      and confirm on-chain: feeBps() == 250, token(), panelExecutor().
contract DeployAgentEarnEscrow is Script {
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant FEE_RECIPIENT = 0x9a21c75aC263cC43125E70200636f6397f8776d0;

    function run() external returns (AgentEarnEscrow escrow) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address panelExecutor = vm.envAddress("PANEL_EXECUTOR");
        require(panelExecutor != address(0), "PANEL_EXECUTOR unset");

        vm.startBroadcast(pk);
        // Literal 250 — see the solc quirk note above.
        escrow = new AgentEarnEscrow(IERC20(USDG), panelExecutor, 250, FEE_RECIPIENT);
        vm.stopBroadcast();

        console2.log("AgentEarnEscrow:", address(escrow));
        console2.log("token:", address(escrow.token()));
        console2.log("panelExecutor:", escrow.panelExecutor());
        console2.log("feeBps:", escrow.feeBps());
        console2.log("feeRecipient:", escrow.feeRecipient());
    }
}
