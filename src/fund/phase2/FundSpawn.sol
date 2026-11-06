// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FundNFTInvest} from "./FundNFTInvest.sol";
import {FundVaultInvest} from "./FundVaultInvest.sol";

/// @notice Deploys FundVaultInvest with `new`. Kept out of the factory so the factory runtime
///         stays under the 24576-byte limit. The factory is the only caller.
contract FundVaultDeployer {
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
        uint64 raiseDeadline
    ) external returns (FundVaultInvest vault) {
        if (msg.sender != factory) revert NotFactory();
        vault = new FundVaultInvest(
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
            factory
        );
    }
}

/// @notice Deploys FundNFTInvest with `new`. Same size split as FundVaultDeployer.
contract FundNFTDeployer {
    address public immutable factory;

    error NotFactory();

    constructor() {
        factory = msg.sender;
    }

    function deploy(FundNFTInvest.Init memory init) external returns (FundNFTInvest nft) {
        if (msg.sender != factory) revert NotFactory();
        nft = new FundNFTInvest(init);
    }
}
