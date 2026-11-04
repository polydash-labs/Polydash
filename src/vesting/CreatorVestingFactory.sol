// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CreatorVestingVault, ICreatorVestingFactoryIndex} from "./CreatorVestingVault.sol";
import {IPolydashFactoryInfo} from "../bond/IPolydashLaunchInfo.sol";

/// @title CreatorVestingFactory (DRAFT - not reviewed, not deployed)
/// @notice Permissionless, ownerless. Anyone deposits an allocation for a beneficiary (usually
///         themselves). Indexes vaults by token and beneficiary for PolyCTO / badge reads.
contract CreatorVestingFactory is ReentrancyGuard, ICreatorVestingFactoryIndex {
    using SafeERC20 for IERC20;

    uint64 public constant MIN_DURATION = 1 days;
    uint64 public constant MAX_DURATION = 3650 days;

    address public immutable stakingFactory; // PolydashStakingFactoryV2
    /// @notice Polypad launch factories whose tokens may get vaults (launchOfToken != 0).
    address public immutable launchFactoryA; // current PolydashFactory 0xfDfD...08c2
    address public immutable launchFactoryB; // earlier PolydashFactory 0x2C84...5dB2 (or 0)

    address[] public allVaults;
    mapping(address => bool) public isVault;
    mapping(address => address[]) internal _byToken;
    mapping(address => address[]) internal _byBeneficiary;

    event VaultCreated(
        address indexed vault,
        address indexed token,
        address indexed beneficiary,
        address depositor,
        uint256 allocation,
        uint64 start,
        uint64 cliffDuration,
        uint64 duration,
        address pool
    );

    event BeneficiaryIndexUpdated(address indexed vault, address indexed previous, address indexed next);

    error InvalidParams();
    error TokenNotLaunched();
    error NotVault();

    constructor(address _stakingFactory, address _launchFactoryA, address _launchFactoryB) {
        if (_stakingFactory == address(0) || _launchFactoryA == address(0)) revert InvalidParams();
        stakingFactory = _stakingFactory;
        launchFactoryA = _launchFactoryA;
        launchFactoryB = _launchFactoryB;
    }

    /// @notice True if `token` was launched by one of the Polypad launch factories.
    function isPolypadToken(address token) public view returns (bool) {
        if (IPolydashFactoryInfo(launchFactoryA).launchOfToken(token) != address(0)) return true;
        return launchFactoryB != address(0) && IPolydashFactoryInfo(launchFactoryB).launchOfToken(token) != address(0);
    }

    /// @notice Badge helper: vault is ours and its schedule meets the 30d cliff / 180d duration minimum.
    function vaultMeetsBadgeMinimum(address vault) external view returns (bool) {
        return isVault[vault] && CreatorVestingVault(vault).meetsBadgeMinimum();
    }

    /// @dev Called by a vault after a completed two-step beneficiary transfer.
    function onBeneficiaryChanged(address prev, address next) external {
        if (!isVault[msg.sender]) revert NotVault();
        address[] storage a = _byBeneficiary[prev];
        uint256 n = a.length;
        for (uint256 i; i < n; ++i) {
            if (a[i] == msg.sender) {
                a[i] = a[n - 1];
                a.pop();
                break;
            }
        }
        _byBeneficiary[next].push(msg.sender);
        emit BeneficiaryIndexUpdated(msg.sender, prev, next);
    }

    /// @param start  schedule start; 0 = now. Must not be in the past.
    /// @param pool   V2 pool for `token` to stake into, or address(0) for an unstaked lock.
    function createVault(
        address token,
        address beneficiary,
        uint256 amount,
        uint64 start,
        uint64 cliffDuration,
        uint64 duration,
        address pool
    ) external nonReentrant returns (address vault) {
        if (amount == 0 || token == address(0) || beneficiary == address(0)) revert InvalidParams();
        if (!isPolypadToken(token)) revert TokenNotLaunched();
        if (duration < MIN_DURATION || duration > MAX_DURATION || cliffDuration > duration) revert InvalidParams();
        if (start == 0) start = uint64(block.timestamp);
        if (start < block.timestamp || start > block.timestamp + 365 days) revert InvalidParams();

        vault = address(new CreatorVestingVault(stakingFactory, token, beneficiary, start, cliffDuration, duration));
        isVault[vault] = true;
        allVaults.push(vault);
        _byToken[token].push(vault);
        _byBeneficiary[beneficiary].push(vault);

        // straight from depositor to vault; the vault records what actually arrived
        IERC20(token).safeTransferFrom(msg.sender, vault, amount);
        CreatorVestingVault(vault).initialize(pool);

        emit VaultCreated(
            vault, token, beneficiary, msg.sender, CreatorVestingVault(vault).totalAllocation(), start, cliffDuration, duration, pool
        );
    }

    function allVaultsLength() external view returns (uint256) {
        return allVaults.length;
    }

    function vaultsByToken(address token) external view returns (address[] memory) {
        return _byToken[token];
    }

    function vaultsByBeneficiary(address b) external view returns (address[] memory) {
        return _byBeneficiary[b];
    }

    /// @notice Sum of schedule-locked amounts across all vaults for `token` (badge helper).
    function totalLockedForToken(address token) external view returns (uint256 sum) {
        address[] storage vs = _byToken[token];
        for (uint256 i; i < vs.length; ++i) {
            sum += CreatorVestingVault(vs[i]).lockedAmount();
        }
    }
}
