// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/agent/AgentRegistry.sol";
import {AgentScore} from "../src/agent/AgentScore.sol";

/// @notice Deploy the Agent Credit Score (Phase 1 v1) on Robinhood Chain:
///         AgentRegistry + AgentScore. Deploys ONLY these two new contracts —
///         no live contract is touched. The registry takes a 1,000 POLYDASH
///         bond per agent; the score contract stores the 300-850 score plus
///         its five components and an audit inputs hash, posted by the
///         authorized updater (the scorer keeper).
///
///         What it deploys:
///           1. `AgentRegistry` — registerAgent(name, wallet, agentAccount)
///              with the 1,000 POLYDASH bond (REGISTRATION_STAKE). Owner is
///              the deployer; slash recipient defaults to the deployer.
///           2. `AgentScore` — updateScore(agentId, score, components,
///              inputsHash), only callable by the updater. The updater is
///              the scorer keeper wallet (SCORE_UPDATER env); if unset it
///              defaults to the deployer, who can later call setUpdater.
///
///         After deploy, set these in the scorer's .env (see
///         agent-credit-score-scorer/.env.example):
///           REGISTRY_ADDRESS=<registry>  SCORE_ADDRESS=<score>
///         and fund the keeper wallet with enough ETH for daily updateScore
///         calls (one tx per registered agent per day).
///
/// @dev Dry-run (no broadcast, no key needed — simulation only, nothing is sent):
///      CONFIRM_AGENT_CREDIT_SCORE_DEPLOY=yes \
///      SCORE_UPDATER=0x<keeper> \
///      forge script script/DeployAgentCreditScore.s.sol \
///        --rpc-url https://robinhood.drpc.org \
///        --sender 0x9a21c75aC263cC43125E70200636f6397f8776d0 --unlocked
///      Real run (deployer key required, never in chat or files):
///      ... same env ... forge script script/DeployAgentCreditScore.s.sol \
///        --rpc-url https://robinhood.drpc.org --broadcast --private-key 0x...
contract DeployAgentCreditScore is Script {
    error DeployNotConfirmed();

    address internal constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;

    function run() external {
        if (keccak256(bytes(vm.envString("CONFIRM_AGENT_CREDIT_SCORE_DEPLOY"))) != keccak256(bytes("yes"))) {
            revert DeployNotConfirmed();
        }
        address updater = vm.envOr("SCORE_UPDATER", msg.sender);
        address slashRecipient = vm.envOr("SLASH_RECIPIENT", msg.sender);

        vm.startBroadcast();
        AgentRegistry registry = new AgentRegistry(POLYDASH, slashRecipient);
        AgentScore score = new AgentScore(address(registry), updater);
        vm.stopBroadcast();

        console2.log("AgentRegistry:", address(registry));
        console2.log("AgentScore:   ", address(score));
        console2.log("Registry owner:", registry.owner());
        console2.log("Score updater:", score.updater());
        console2.log("Registration stake (POLYDASH):", registry.REGISTRATION_STAKE());
        console2.log("Score range:", score.MIN_SCORE(), "-", score.MAX_SCORE());
        console2.log("Set in the scorer .env:");
        console2.log("  REGISTRY_ADDRESS=", address(registry));
        console2.log("  SCORE_ADDRESS=", address(score));
    }
}
