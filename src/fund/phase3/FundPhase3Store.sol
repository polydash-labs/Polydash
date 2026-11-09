// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Storage appended after `FundVaultStore` for a Phase 3 vault and its swap facet.
///         Both contracts inherit it in the same position so a delegatecall sees one layout.
///         These variables are not on the live Phase 2 vault. The live facet is not used here.
abstract contract FundPhase3Store {
    uint256 public constant PHASE3_BPS = 10_000;

    /// @notice Template this fund was created from. There is no function that points it at another template.
    uint256 public templateId;
    /// @notice Performance fee, in bps of the gain above `hwmPerNft`. Fixed at creation.
    uint256 public hwmFeeBps;
    /// @notice Buy of a non-quote asset reverts when the drop from `peakNavPerNft` reaches this bps. 0 disables it.
    uint256 public maxDrawdownBps;
    /// @notice Highest net NAV per outstanding NFT observed after a swap, a checkpoint, or the open.
    uint256 public peakNavPerNft;
    /// @notice High-water mark of net NAV per outstanding NFT. The performance fee uses this, not the peak.
    uint256 public hwmPerNft;

    uint256 public performanceFeeAccrued;
    uint256 public performanceFeeClaimed;

    /// @notice ETH set aside for distribution rounds. Swaps cannot spend it.
    uint256 public distributionReserved;
    uint256 public distRound;

    struct DistRound {
        uint256 perUnit;
        uint256 pot;
    }

    mapping(uint256 => DistRound) public rounds;
    /// @dev round => tokenId => already paid.
    mapping(uint256 => mapping(uint256 => bool)) public distributionClaimed;

    event PerformanceFeeAccrued(uint256 amount, uint256 hwmPerNft);
    event PerformanceFeeWithdrawn(address indexed to, uint256 amount);
    event Distributed(uint256 indexed roundId, uint256 pot, uint256 perUnit);
    event DistributionClaimed(address indexed to, uint256 amount);
    event NavTape(uint64 indexed timestamp, uint256 nav, uint256 navPerNft, uint256 hwmPerNft, uint256 drawdownBps);
    event DrawdownBrake(uint256 drawdownBps);

    error DrawdownBrakeActive();
    error SkinLocked();
    error TemplateLocked();
}
