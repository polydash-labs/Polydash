// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TreasuryRules} from "./TreasuryRules.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IPolydashFactoryInfo, IPolydashLaunchInfo} from "../bond/IPolydashLaunchInfo.sol";

/// @title TreasuryRulesFactory (DRAFT - not deployed, not audited)
/// @notice Ownerless and permissionless. Deploys one TreasuryRules vault per Polypad launch token. Only the
///         launch's on-chain creator() can create the vault for its token; the creator owns it.
contract TreasuryRulesFactory {
    address public immutable launchFactoryA;
    address public immutable launchFactoryB;
    address public immutable stakingFactory;
    address public immutable poolManager;
    /// @notice TreasuryRules implementation (locked); every vault is an EIP-1167 clone of it.
    address public immutable implementation;

    address[] public allRules;
    mapping(address => address) public rulesOf; // token => vault
    mapping(address => bool) public isRules;
    mapping(address => address[]) internal _byCreator;

    event RulesCreated(address indexed rules, address indexed token, address indexed creator, address launch);

    error ZeroAddress();
    error NotPolydashToken();
    error NotTokenCreator();
    error AlreadyExists();

    constructor(address _launchFactoryA, address _launchFactoryB, address _stakingFactory, address _poolManager) {
        if (_launchFactoryA == address(0) || _stakingFactory == address(0) || _poolManager == address(0)) {
            revert ZeroAddress();
        }
        launchFactoryA = _launchFactoryA;
        launchFactoryB = _launchFactoryB;
        stakingFactory = _stakingFactory;
        poolManager = _poolManager;
        implementation = address(new TreasuryRules());
    }

    function launchOf(address token) public view returns (address launch) {
        launch = IPolydashFactoryInfo(launchFactoryA).launchOfToken(token);
        if (launch == address(0) && launchFactoryB != address(0)) {
            launch = IPolydashFactoryInfo(launchFactoryB).launchOfToken(token);
        }
    }

    function createRules(
        address token,
        TreasuryRules.Rules calldata rules,
        address[] calldata executors,
        uint64 timelockDelay
    ) external payable returns (address vault) {
        address launch = launchOf(token);
        if (launch == address(0) || IPolydashLaunchInfo(launch).token() != token) revert NotPolydashToken();
        if (IPolydashLaunchInfo(launch).creator() != msg.sender) revert NotTokenCreator();
        if (rulesOf[token] != address(0)) revert AlreadyExists();
        vault = Clones.cloneDeterministic(implementation, bytes32(uint256(uint160(token))));
        TreasuryRules(payable(vault)).initialize{value: msg.value}(
            msg.sender, token, launch, stakingFactory, poolManager, rules, executors, timelockDelay
        );
        allRules.push(vault);
        rulesOf[token] = vault;
        isRules[vault] = true;
        _byCreator[msg.sender].push(vault);
        emit RulesCreated(vault, token, msg.sender, launch);
    }

    function rulesCount() external view returns (uint256) {
        return allRules.length;
    }

    function rulesByCreator(address creator) external view returns (address[] memory) {
        return _byCreator[creator];
    }
}
