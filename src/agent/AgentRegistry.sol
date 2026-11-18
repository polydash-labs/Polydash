// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AgentRegistry
/// @notice Registry for AI agents operating on Polypad. An agent registers a
///         persistent identity (wallet + optional ERC-6551 token-bound
///         account) by bonding 1,000 POLYDASH. The bond deters Sybil
///         registrations and is slashable by the owner for proven
///         misbehavior. The agent's credit score is bound to this registry
///         entry and cannot be transferred to a new identity.
/// @dev New module for the Agent Credit Score (Phase 1 v1). Does not touch
///      any live contract. Contracts are unaudited (Slither only).
contract AgentRegistry {
    using SafeERC20 for IERC20;

    /// @notice POLYDASH token (18 decimals). The registration bond.
    IERC20 public immutable polydash;
    /// @notice Registration bond, in POLYDASH (18 decimals). 1,000 POLYDASH.
    uint256 public constant REGISTRATION_STAKE = 1_000 ether;
    /// @notice Owner (admin). Can slash and set the slash recipient.
    address public owner;
    /// @notice Where slashed bonds go. Defaults to the owner.
    address public slashRecipient;

    struct Agent {
        address wallet;
        address agentAccount;
        string name;
        uint256 stake;
        uint64 registeredAt;
        bool active;
    }

    uint256 public agentCount;
    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) public agentIdByWallet;
    mapping(address => uint256) public agentIdByAccount;

    event AgentRegistered(
        uint256 indexed agentId, address indexed wallet, address indexed agentAccount, string name
    );
    event AgentUpdated(
        uint256 indexed agentId, address indexed wallet, address indexed agentAccount, string name
    );
    event AgentUnregistered(uint256 indexed agentId, address indexed wallet, uint256 stakeReturned);
    event AgentSlashed(uint256 indexed agentId, uint256 amount, uint256 remainingStake);
    event SlashRecipientSet(address indexed recipient);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error EmptyName();
    error ZeroWallet();
    error ZeroAddress();
    error AlreadyRegistered();
    error AccountAlreadyRegistered();
    error NotRegistered();
    error NotAgentWallet();
    error NotOwner();
    error InsufficientStake();
    error InactiveAgent();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _polydash, address _slashRecipient) {
        if (_polydash == address(0)) revert ZeroAddress();
        polydash = IERC20(_polydash);
        owner = msg.sender;
        slashRecipient = _slashRecipient == address(0) ? msg.sender : _slashRecipient;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Register an agent. The caller funds the 1,000 POLYDASH bond
    ///         (must approve this contract first); the bond is attributed to
    ///         the agent. `wallet` is the address the agent controls and the
    ///         only address that may update or unregister the agent.
    ///         `agentAccount` is the agent's ERC-6551 token-bound account
    ///         and may be address(0) at registration, linked later.
    function registerAgent(string calldata name, address wallet, address agentAccount)
        external
        returns (uint256 agentId)
    {
        if (bytes(name).length == 0) revert EmptyName();
        if (wallet == address(0)) revert ZeroWallet();
        if (agentIdByWallet[wallet] != 0) revert AlreadyRegistered();
        if (agentAccount != address(0) && agentIdByAccount[agentAccount] != 0) {
            revert AccountAlreadyRegistered();
        }
        // Pull the bond. Caller must have approved this contract.
        polydash.safeTransferFrom(msg.sender, address(this), REGISTRATION_STAKE);
        agentId = ++agentCount;
        agents[agentId] = Agent({
            wallet: wallet,
            agentAccount: agentAccount,
            name: name,
            stake: REGISTRATION_STAKE,
            registeredAt: uint64(block.timestamp),
            active: true
        });
        agentIdByWallet[wallet] = agentId;
        if (agentAccount != address(0)) agentIdByAccount[agentAccount] = agentId;
        emit AgentRegistered(agentId, wallet, agentAccount, name);
    }

    /// @notice Update the agent's name and/or ERC-6551 account. Only the
    ///         agent's wallet may call. The score stays bound to the same
    ///         agent id; identity is never transferred.
    function updateAgent(uint256 agentId, string calldata name, address agentAccount) external {
        Agent storage a = agents[agentId];
        if (a.wallet == address(0)) revert NotRegistered();
        if (msg.sender != a.wallet) revert NotAgentWallet();
        if (bytes(name).length == 0) revert EmptyName();
        if (agentAccount != a.agentAccount) {
            if (agentAccount != address(0) && agentIdByAccount[agentAccount] != 0) {
                revert AccountAlreadyRegistered();
            }
            if (a.agentAccount != address(0)) delete agentIdByAccount[a.agentAccount];
            if (agentAccount != address(0)) agentIdByAccount[agentAccount] = agentId;
            a.agentAccount = agentAccount;
        }
        a.name = name;
        emit AgentUpdated(agentId, a.wallet, agentAccount, name);
    }

    /// @notice Unregister an agent and return the remaining bond to its
    ///         wallet. The wallet and account are freed and may register
    ///         again as a new agent id; the old id's score history is kept
    ///         in AgentScore and is not transferred.
    function unregisterAgent(uint256 agentId) external {
        Agent storage a = agents[agentId];
        if (a.wallet == address(0)) revert NotRegistered();
        if (msg.sender != a.wallet) revert NotAgentWallet();
        if (!a.active) revert InactiveAgent();
        uint256 stake = a.stake;
        a.active = false;
        delete agentIdByWallet[a.wallet];
        if (a.agentAccount != address(0)) delete agentIdByAccount[a.agentAccount];
        if (stake > 0) {
            a.stake = 0;
            polydash.safeTransfer(a.wallet, stake);
        }
        emit AgentUnregistered(agentId, a.wallet, stake);
    }

    /// @notice Slash part or all of an agent's bond for proven misbehavior.
    ///         A partial slash leaves the agent active; slashing the full
    ///         bond deactivates the agent permanently (its wallet cannot
    ///         re-register). Slashed funds go to the slash recipient.
    function slashAgent(uint256 agentId, uint256 amount) external onlyOwner {
        Agent storage a = agents[agentId];
        if (a.wallet == address(0)) revert NotRegistered();
        if (amount == 0 || amount > a.stake) revert InsufficientStake();
        a.stake -= amount;
        if (a.stake == 0) a.active = false;
        polydash.safeTransfer(slashRecipient, amount);
        emit AgentSlashed(agentId, amount, a.stake);
    }

    function setSlashRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        slashRecipient = recipient;
        emit SlashRecipientSet(recipient);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        address prev = owner;
        owner = next;
        emit OwnershipTransferred(prev, next);
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }

    /// @notice True only for an existing, active agent.
    function isRegistered(uint256 agentId) external view returns (bool) {
        Agent storage a = agents[agentId];
        return a.wallet != address(0) && a.active;
    }
}
