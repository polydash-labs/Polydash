// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FundNFTV2} from "./FundNFTV2.sol";
import {FundVaultV2} from "./FundVaultV2.sol";

/// @notice Deploys `FundVaultV2` outside the factory runtime so the factory stays within 24576 bytes.
contract FundVaultV2Deployer {
    address public immutable factory;

    error NotFactory();

    constructor() {
        factory = msg.sender;
    }

    function deploy(
        address manager,
        uint256 raiseCap,
        uint256 maxSupply,
        uint256 mintPrice,
        uint256 entryFeeBps,
        uint256 protocolFeeBps,
        uint64 raiseDeadline,
        address allowlist,
        address weth,
        bytes32 mandateHash,
        address[] memory assets,
        address swapFacet
    ) external returns (FundVaultV2 vault) {
        if (msg.sender != factory) revert NotFactory();
        vault = new FundVaultV2(
            manager,
            raiseCap,
            maxSupply,
            mintPrice,
            entryFeeBps,
            protocolFeeBps,
            raiseDeadline,
            allowlist,
            weth,
            mandateHash,
            assets,
            swapFacet,
            factory
        );
    }
}

/// @notice Deploys `FundNFTV2` outside the factory runtime.
contract FundNFTV2Deployer {
    address public immutable factory;

    error NotFactory();

    constructor() {
        factory = msg.sender;
    }

    function deploy(FundNFTV2.Init memory init) external returns (FundNFTV2 nft) {
        if (msg.sender != factory) revert NotFactory();
        nft = new FundNFTV2(init);
    }
}
