// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FundNFTPhase3} from "./FundNFTPhase3.sol";
import {FundVaultPhase3} from "./FundVaultPhase3.sol";

/// @notice Deploys a Phase 3 vault with `new`. Kept out of the factory so the factory runtime
///         stays under the 24576-byte limit. Not deployed. Not a review.
contract FundVaultPhase3Deployer {
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
        uint64 raiseDeadline,
        string memory mandateUri,
        uint256 maxPositionBps,
        uint256 maxTradeBps,
        uint256 maxDeviationBps,
        uint256 templateId,
        uint256 hwmFeeBps,
        uint256 maxDrawdownBps
    ) external returns (FundVaultPhase3 vault) {
        if (msg.sender != factory) revert NotFactory();
        vault = new FundVaultPhase3(
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

/// @notice Deploys a Phase 3 NFT with `new`.
contract FundNFTPhase3Deployer {
    address public immutable factory;

    error NotFactory();

    constructor() {
        factory = msg.sender;
    }

    function deploy(FundNFTPhase3.Init memory init) external returns (FundNFTPhase3 nft) {
        if (msg.sender != factory) revert NotFactory();
        nft = new FundNFTPhase3(init);
    }
}
