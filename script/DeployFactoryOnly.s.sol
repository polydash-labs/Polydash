// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FundFactoryInvest} from "../src/fund/phase2/FundFactoryInvest.sol";

/// @notice Deploys ONLY FundFactoryInvest, reusing the allowlist / facet
///         already deployed on Robinhood mainnet on 2026-11-09.
///         The full deploy script ran out of gas funds after deploying
///         facet, adapter and allowlist (nonce 34 -> 37), before the
///         factory transaction. Re-running the full script would redeploy
///         all four contracts and waste the ~12M gas already spent.
/// @dev Required env:
///      CONFIRM_FUND_PHASE2_DEPLOY=yes
///      FEE_RECIPIENT — 0x9a21c75aC263cC43125E70200636f6397f8776d0
///      FUND_INVEST_WETH — 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
///      FUND_INVEST_ALLOWLIST — 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19
///      FUND_INVEST_FACET — 0xA2620b14d1A39d4afbEAA4b87a7E7871050b50a0
///      PRIVATE_KEY — deployer signing key, transient only, never stored here.
///      CONFIRM_FUND_PHASE2_DEPLOY=yes FEE_RECIPIENT=0x... FUND_INVEST_WETH=0x... \
///      FUND_INVEST_ALLOWLIST=0x... FUND_INVEST_FACET=0x... PRIVATE_KEY=0x... \
///      forge script script/DeployFactoryOnly.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast
contract DeployFactoryOnly is Script {
    error DeployNotConfirmed();

    function run() external returns (FundFactoryInvest factory) {
        if (keccak256(bytes(vm.envOr("CONFIRM_FUND_PHASE2_DEPLOY", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address weth = vm.envAddress("FUND_INVEST_WETH");
        address allowlist = vm.envAddress("FUND_INVEST_ALLOWLIST");
        address facet = vm.envAddress("FUND_INVEST_FACET");

        vm.startBroadcast(pk);
        factory = new FundFactoryInvest(feeRecipient, allowlist, weth, facet);
        vm.stopBroadcast();

        console2.log("FundFactoryInvest:", address(factory));
        console2.log("owner:", factory.owner());
        console2.log("feeRecipient:", factory.feeRecipient());
        console2.log("weth:", factory.weth());
        console2.log("allowlist:", address(factory.allowlist()));
    }
}
