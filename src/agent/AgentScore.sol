// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AgentRegistry} from "./AgentRegistry.sol";

/// @title AgentScore
/// @notice On-chain store for the Agent Credit Score (a FICO for agents,
///         300-850). The score is computed off-chain by the scorer keeper
///         from verifiable on-chain behavior and posted here by the
///         authorized updater, together with the five components and a hash
///         of the inputs used (so anyone can audit/recompute it). The
///         contract enforces that the posted score is exactly the weighted
///         sum of the posted components, so the keeper cannot post an
///         arbitrary score.
/// @dev New module for the Agent Credit Score (Phase 1 v1). Component
///      order: [performance, history, activity, stake, conduct]. Weights:
///      Performance 35, History 20, Activity 15, Stake 15, Conduct 15.
///      Each component is 0-1000. Score = 300 + (weighted sum * 550)/100000.
///      Vouching (others staking on an agent) is deferred to Phase 2 and is
///      NOT part of the v1 Stake component. Contracts are unaudited (Slither only).
contract AgentScore {
    AgentRegistry public immutable registry;
    address public owner;
    address public updater;

    uint16 public constant MIN_SCORE = 300;
    uint16 public constant MAX_SCORE = 850;
    uint16 public constant MAX_COMPONENT = 1000;

    uint256 public constant WEIGHT_PERFORMANCE = 35;
    uint256 public constant WEIGHT_HISTORY = 20;
    uint256 public constant WEIGHT_ACTIVITY = 15;
    uint256 public constant WEIGHT_STAKE = 15;
    uint256 public constant WEIGHT_CONDUCT = 15;

    /// @notice components are [performance, history, activity, stake, conduct].
    struct Score {
        uint16 score;
        uint16 performance;
        uint16 history;
        uint16 activity;
        uint16 stake;
        uint16 conduct;
        uint64 updatedAt;
        bytes32 inputsHash;
        bool exists;
    }

    mapping(uint256 => Score) public scores;

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
    event UpdaterSet(address indexed updater);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotUpdater();
    error AgentNotRegistered();
    error ScoreOutOfRange();
    error ComponentOutOfRange();
    error ScoreMismatch();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyUpdater() {
        if (msg.sender != updater) revert NotUpdater();
        _;
    }

    constructor(address _registry, address _updater) {
        if (_registry == address(0) || _updater == address(0)) revert ZeroAddress();
        registry = AgentRegistry(_registry);
        updater = _updater;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        emit UpdaterSet(_updater);
    }

    /// @notice Canonical score from the five components (each 0-1000).
    ///         Score = 300 + (35*perf + 20*hist + 15*act + 15*stake + 15*conduct) * 550 / 100000.
    ///         All-zero components give 300; all-1000 give 850.
    function weightedScore(uint16 performance, uint16 history, uint16 activity, uint16 stake, uint16 conduct)
        public
        pure
        returns (uint16)
    {
        uint256 w = WEIGHT_PERFORMANCE * uint256(performance) + WEIGHT_HISTORY * uint256(history)
            + WEIGHT_ACTIVITY * uint256(activity) + WEIGHT_STAKE * uint256(stake)
            + WEIGHT_CONDUCT * uint256(conduct);
        return uint16(MIN_SCORE + (w * 550) / 100_000);
    }

    /// @notice Post an agent's score. Only the authorized updater (keeper)
    ///         may call. The agent must be registered and active, the score
    ///         must be 300-850, each component 0-1000, and the score must
    ///         equal `weightedScore(components)` exactly.
    function updateScore(uint256 agentId, uint16 score, uint16[5] calldata components, bytes32 inputsHash)
        external
        onlyUpdater
    {
        if (!registry.isRegistered(agentId)) revert AgentNotRegistered();
        if (score < MIN_SCORE || score > MAX_SCORE) revert ScoreOutOfRange();
        for (uint256 i = 0; i < 5; i++) {
            if (components[i] > MAX_COMPONENT) revert ComponentOutOfRange();
        }
        uint16 expected =
            weightedScore(components[0], components[1], components[2], components[3], components[4]);
        if (score != expected) revert ScoreMismatch();
        scores[agentId] = Score({
            score: score,
            performance: components[0],
            history: components[1],
            activity: components[2],
            stake: components[3],
            conduct: components[4],
            updatedAt: uint64(block.timestamp),
            inputsHash: inputsHash,
            exists: true
        });
        emit ScoreUpdated(
            agentId,
            score,
            components[0],
            components[1],
            components[2],
            components[3],
            components[4],
            inputsHash,
            uint64(block.timestamp)
        );
    }

    function setUpdater(address _updater) external onlyOwner {
        if (_updater == address(0)) revert ZeroAddress();
        updater = _updater;
        emit UpdaterSet(_updater);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        address prev = owner;
        owner = next;
        emit OwnershipTransferred(prev, next);
    }

    function getScore(uint256 agentId) external view returns (Score memory) {
        return scores[agentId];
    }

    /// @notice 0 when the agent has never been scored.
    function scoreOf(uint256 agentId) external view returns (uint16) {
        return scores[agentId].score;
    }

    /// @notice Band for a score: 0 New (<500), 1 Building (500-599),
    ///         2 Standard (600-699), 3 Prime (700-799), 4 Elite (800-850).
    function bandForScore(uint16 score) public pure returns (uint8) {
        if (score >= 800) return 4;
        if (score >= 700) return 3;
        if (score >= 600) return 2;
        if (score >= 500) return 1;
        return 0;
    }

    function bandOf(uint256 agentId) external view returns (uint8) {
        return bandForScore(scores[agentId].score);
    }
}
