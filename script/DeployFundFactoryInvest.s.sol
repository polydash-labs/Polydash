// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FundAllowlist} from "../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../src/fund/phase2/FundFactoryInvest.sol";
import {FundSwapFacet} from "../src/fund/phase2/FundSwapFacet.sol";
import {UniswapV3RouterAdapter} from "../src/fund/phase2/UniswapV3RouterAdapter.sol";

/// @notice Phase 2b deploy script. It does not run unless CONFIRM_FUND_PHASE2_DEPLOY=yes.
///         Do not broadcast this against Robinhood Chain until that deploy is intended.
///         The live Phase 1a FundFactory is a different contract and this script does not call it.
///         Finalized launch (2026-11-09, Jon go-ahead): WETH-only, no non-WETH asset at deploy.
///         Fee recipient: 0x9a21c75aC263cC43125E70200636f6397f8776d0. Timelock 2 days.
///         Router: SwapRouter02 0xCaf681a66D020601342297493863E78C959E5cb2 via
///         UniswapV3RouterAdapter. Post-deploy: transfer ownership to a 2-of-3 multisig
///         Jon controls, with the fee-recipient wallet as one signer. Signing requires the
///         deployer private key / hardware wallet — not in this environment, never invent one.
/// @dev Required env:
///      CONFIRM_FUND_PHASE2_DEPLOY=yes
///      FUND_INVEST_WETH — WETH on the target chain. Finalized: 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73.
///      FEE_RECIPIENT, or FUND_INVEST_FEE_RECIPIENT. Finalized: 0x9a21c75aC263cC43125E70200636f6397f8776d0.
///      PRIVATE_KEY, unless DEPLOY_FUND_INVEST_PK is set. Leave DEPLOY_FUND_INVEST_PK unset to broadcast.
///      The unit test sets DEPLOY_FUND_INVEST_PK so it does not share PRIVATE_KEY with other deploy tests.
///      Optional FUND_INVEST_DELAY seconds. Default is 2 days. Minimum is 1 day.
///      Optional FUND_INVEST_SWAP_ROUTER02 — Uniswap V3 SwapRouter02 on the target chain. When set,
///      this script also deploys a UniswapV3RouterAdapter for it and seeds the adapter as the only
///      initial router. SwapRouter02 itself is NOT allowlisted: it has no
///      `swap(address,address,uint256,uint256,bytes)` function, so the vault cannot call it directly.
///      When the env is unset, no router is seeded and swaps stay disabled until a router is
///      proposed through the timelock. Do not allowlist UniversalRouter from this script.
///      The allowlist starts with WETH as the quote and no other asset. This script does not set a
///      Chainlink proxy, a sequencer feed, or a Uniswap router. Per-asset proxy, heartbeat, and
///      denomination were not in the official table when this was written. That is not a finding
///      that feeds do not exist. Do not invent them. Do not allowlist UniversalRouter from this script.
///      A non-quote asset stays disabled until `proposeAsset` is given a reviewed feed and the delay elapses.
///      These contracts are unaudited. Not financial advice.
///      CONFIRM_FUND_PHASE2_DEPLOY=yes FUND_INVEST_WETH=0x... FEE_RECIPIENT=0x... PRIVATE_KEY=0x... \
///      forge script script/DeployFundFactoryInvest.s.sol --rpc-url robinhood --broadcast
contract DeployFundFactoryInvest is Script {
    error DeployNotConfirmed();

    function run() external returns (FundFactoryInvest factory, FundAllowlist allowlist, FundSwapFacet facet) {
        if (keccak256(bytes(vm.envOr("CONFIRM_FUND_PHASE2_DEPLOY", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }

        uint256 pk = vm.envOr("DEPLOY_FUND_INVEST_PK", uint256(0));
        if (pk == 0) pk = vm.envUint("PRIVATE_KEY");

        address feeRecipient = vm.envOr("FUND_INVEST_FEE_RECIPIENT", address(0));
        if (feeRecipient == address(0)) feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address weth = vm.envAddress("FUND_INVEST_WETH");
        uint256 timelock = vm.envOr("FUND_INVEST_DELAY", uint256(2 days));
        address swapRouter02 = vm.envOr("FUND_INVEST_SWAP_ROUTER02", address(0));

        address[] memory routers = new address[](swapRouter02 == address(0) ? 0 : 1);
        FundAllowlist.AssetInit[] memory assets = new FundAllowlist.AssetInit[](1);
        assets[0] = FundAllowlist.AssetInit({
            asset: weth, quote: true, feed: address(0), maxStale: 0, minPriceX18: 0, maxPriceX18: 0
        });

        vm.startBroadcast(pk);
        facet = new FundSwapFacet();
        if (swapRouter02 != address(0)) {
            UniswapV3RouterAdapter adapter = new UniswapV3RouterAdapter(swapRouter02, weth);
            routers[0] = address(adapter);
            console2.log("UniswapV3RouterAdapter:", address(adapter));
            console2.log("SwapRouter02:", swapRouter02);
        }
        allowlist = new FundAllowlist(vm.addr(pk), timelock, routers, assets);
        factory = new FundFactoryInvest(feeRecipient, address(allowlist), weth, address(facet));
        vm.stopBroadcast();

        console2.log("FundSwapFacet:", address(facet));
        console2.log("FundAllowlist:", address(allowlist));
        console2.log("FundFactoryInvest:", address(factory));
        console2.log("owner:", factory.owner());
        console2.log("feeRecipient:", factory.feeRecipient());
        console2.log("weth:", factory.weth());
        console2.log("delay:", allowlist.delay());
    }
}
