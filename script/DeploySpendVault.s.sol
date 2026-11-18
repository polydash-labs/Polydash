// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PolypadSpendVault} from "../src/x402/PolypadSpendVault.sol";

/// @notice Deploy the PolypadSpendVault (x402 layer v1) on Robinhood Chain.
///         Deploys ONLY this one new contract — no live contract is touched.
///         The vault is the tab-model spending layer: depositors keep their
///         funds, agents get spending keys with per-payment + daily caps,
///         allowlists and expiry, and the facilitator settles signed
///         EIP-712 spend authorizations. Owner is the deployer; the
///         facilitator is the x402 facilitator wallet (FACILITATOR env, or
///         the deployer by default — point it at the dedicated facilitator
///         wallet before going live).
///
/// @dev Dry-run (no broadcast, no key needed — simulation only):
///      CONFIRM_SPEND_VAULT_DEPLOY=yes \
///      FACILITATOR=0x<facilitator> \
///      forge script script/DeploySpendVault.s.sol \
///        --rpc-url https://robinhood.drpc.org \
///        --sender 0x9a21c75aC263cC43125E70200636f6397f8776d0 --unlocked
///      Real run (deployer key required, never in chat or files):
///      ... same env ... forge script script/DeploySpendVault.s.sol \
///        --rpc-url https://robinhood.drpc.org --broadcast --private-key 0x...
contract DeploySpendVault is Script {
    error DeployNotConfirmed();

    function run() external {
        if (keccak256(bytes(vm.envString("CONFIRM_SPEND_VAULT_DEPLOY"))) != keccak256(bytes("yes"))) {
            revert DeployNotConfirmed();
        }
        address facilitator = vm.envOr("FACILITATOR", msg.sender);
        vm.startBroadcast();
        PolypadSpendVault vault = new PolypadSpendVault();
        vault.setFacilitator(facilitator);
        vm.stopBroadcast();
        console2.log("PolypadSpendVault:", address(vault));
        console2.log("owner:", vault.owner());
        console2.log("facilitator:", vault.facilitator());
    }
}
