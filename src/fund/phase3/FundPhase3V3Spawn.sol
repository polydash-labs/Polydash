// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FundVaultPhase3V3} from "./FundVaultPhase3V3.sol";

/// @notice Deploys a Phase 3 V3 vault with `new`. Mirrors `FundVaultPhase3V3Deployer`,
///         kept out of the factory so the factory runtime stays under the 24576-byte limit.
///         The NFT deployer is reused unchanged from `FundPhase3Spawn` (`FundNFTPhase3` is
///         the same share for V1, V2, and V3 funds). The liquidity facet, the optional
///         stake facet (may be zero — the manager sets it later via `setStakeFacet`),
///         and the V4 PoolManager are passed through. Not deployed. Not a review.
contract FundVaultPhase3V3Deployer {
    address public immutable factory;

    error NotFactory();

    constructor() {
        factory = msg.sender;
    }

    function deploy(
        address manager,
        uint256 raiseCap,
        uint256 maxSupply,
        uint256 entryFeeBps,
        uint256 protocolFeeBps,
        address allowlist,
        address weth,
        bytes32 mandateHash,
        address[] memory assets,
        address swapFacet,
        address liquidityFacet,
        address stakeFacet,
        address stakingFactory,
        address legacyStakingFactory,
        address stakeToken,
        address poolManager,
        uint64 raiseDeadline,
        string memory mandateUri,
        uint256 maxPositionBps,
        uint256 maxTradeBps,
        uint256 maxDeviationBps,
        uint256 templateId,
        uint256 hwmFeeBps,
        uint256 maxDrawdownBps
    ) external returns (FundVaultPhase3V3 vault) {
        if (msg.sender != factory) revert NotFactory();
        vault = new FundVaultPhase3V3(
            manager,
            raiseCap,
            maxSupply,
            entryFeeBps,
            protocolFeeBps,
            allowlist,
            weth,
            mandateHash,
            assets,
            swapFacet,
            liquidityFacet,
            stakeFacet,
            stakingFactory,
            legacyStakingFactory,
            stakeToken,
            poolManager,
            raiseDeadline,
            factory,
            mandateUri,
            maxPositionBps,
            maxTradeBps,
            maxDeviationBps,
            templateId,
            hwmFeeBps,
            maxDrawdownBps
        );
    }
}
