// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FundVaultPhase3V2} from "./FundVaultPhase3V2.sol";

/// @notice Deploys a Phase 3 V2 vault with `new`. Mirrors `FundVaultPhase3Deployer`, kept out
///         of the factory so the factory runtime stays under the 24576-byte limit. The NFT
///         deployer is reused unchanged from `FundPhase3Spawn` (`FundNFTPhase3` is the same
///         share for V1 and V2 funds). Not deployed. Not a review.
contract FundVaultPhase3V2Deployer {
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
    ) external returns (FundVaultPhase3V2 vault) {
        if (msg.sender != factory) revert NotFactory();
        vault = new FundVaultPhase3V2(
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
