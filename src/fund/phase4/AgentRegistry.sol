// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title AgentRegistry (not reviewed, not deployed)
/// @notice A DIRECTORY of AI-agent funds, not a security boundary. Safety lives in the
///         `AgentExecutor` + vault: the executor verifies every signed instruction and the
///         vault manager can pause swaps or revoke the executor with one transaction.
///         This registry only records what the front-end publishes (name, logo, strategy),
///         so the leaderboard and agent cards have something to read. One agent per fund.
contract AgentRegistry {
    struct Agent {
        address fund;
        address vault;
        address executor;
        address creator;
        address agentKey;
        string name;
        string logoURI;
        string description;
        uint8 templateId;
        uint8 runnerMode; // 0 = self-hosted, 1 = Polypad-hosted
        bytes32 strategyHash;
        bytes32 rulesHash;
        uint64 createdAt;
        bool active;
    }

    mapping(uint256 => Agent) private _agents;
    mapping(address => uint256) public agentOfFund;
    mapping(address => uint256[]) private _byCreator;

    uint256 public agentCount;

    event AgentRegistered(uint256 indexed agentId, address indexed fund, address indexed executor, address creator);
    event AgentUpdated(uint256 indexed agentId, string logoURI, string description, bytes32 rulesHash);
    event AgentRetired(uint256 indexed agentId, address indexed fund);

    error NotManager();
    error NotCreator();
    error UnknownAgent();
    error AlreadyRegistered();
    error InvalidAgent();

    /// @notice The vault's manager registers the agent for their fund. The stored creator is
    ///         always the caller (the manager), whatever `creator` the input struct carries.
    ///         One agent per fund: a second registration for the same fund reverts.
    /// @return agentId The new agent id (ids start at 1; 0 means "no agent").
    function registerAgent(Agent memory a) external returns (uint256 agentId) {
        if (a.fund == address(0) || a.vault == address(0) || a.executor == address(0)) revert InvalidAgent();
        if (IAgentVaultManager(a.vault).manager() != msg.sender) revert NotManager();
        if (agentOfFund[a.fund] != 0) revert AlreadyRegistered();
        agentId = ++agentCount;
        a.creator = msg.sender;
        a.createdAt = uint64(block.timestamp);
        a.active = true;
        _agents[agentId] = a;
        agentOfFund[a.fund] = agentId;
        _byCreator[msg.sender].push(agentId);
        emit AgentRegistered(agentId, a.fund, a.executor, msg.sender);
    }

    /// @notice Creator-only: update the published logo, description, and rules hash.
    function updateAgent(uint256 agentId, string calldata logoURI, string calldata description, bytes32 rulesHash)
        external
    {
        Agent storage a = _get(agentId);
        if (a.creator != msg.sender) revert NotCreator();
        a.logoURI = logoURI;
        a.description = description;
        a.rulesHash = rulesHash;
        emit AgentUpdated(agentId, logoURI, description, rulesHash);
    }

    /// @notice Creator-only: mark the agent inactive. This only updates the directory; the
    ///         manager must also call `vault.setExecutor(executor, false)` (and
    ///         `executor.retire()` when the executor itself should stop) to end trading.
    function retireAgent(uint256 agentId) external {
        Agent storage a = _get(agentId);
        if (a.creator != msg.sender) revert NotCreator();
        a.active = false;
        emit AgentRetired(agentId, a.fund);
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return _get(agentId);
    }

    function agentsByCreator(address creator) external view returns (uint256[] memory) {
        return _byCreator[creator];
    }

    /// @notice Active agent ids, newest first, paginated by `offset`/`limit`.
    function activeAgents(uint256 offset, uint256 limit) external view returns (uint256[] memory ids) {
        uint256 total;
        for (uint256 i = agentCount; i > 0; --i) {
            if (_agents[i].active) total += 1;
        }
        if (total <= offset || limit == 0) return new uint256[](0);
        uint256 n = total - offset;
        if (n > limit) n = limit;
        ids = new uint256[](n);
        uint256 skipped;
        uint256 filled;
        for (uint256 i = agentCount; i > 0 && filled < n; --i) {
            if (!_agents[i].active) continue;
            if (skipped < offset) {
                skipped += 1;
                continue;
            }
            ids[filled] = i;
            filled += 1;
        }
    }

    function _get(uint256 agentId) internal view returns (Agent storage a) {
        if (agentId == 0 || agentId > agentCount) revert UnknownAgent();
        a = _agents[agentId];
    }
}

/// @notice The one vault read the registry needs: who manages this vault.
interface IAgentVaultManager {
    function manager() external view returns (address);
}
