// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PolydashStakingFactoryV2} from "../../src/v2/PolydashStakingFactoryV2.sol";

/// @notice Deploys a NEW PolydashStakingFactoryV2 carrying the fixed
///         PolydashStakingPoolV2 (fee-on-transfer claim fix, 2026-11-11/12).
///         The factory embeds the pool bytecode via `new PolydashStakingPoolV2`
///         in createPool(), so a new factory automatically creates fixed pools.
///         Live factory 0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0 and its 4 pools
///         are untouched — no migration, no change to existing pools.
/// @dev The deployer becomes the new factory's owner (constructor sets
///      owner = msg.sender). feeRecipient is a constructor arg: pass the
///      current recipient 0x351BDe628892Aeb055F717300DBd2848af178479 to keep
///      platform-fee flow unchanged, whichever wallet deploys.
///      After deploy, the front end must point new-pool creation at the new
///      factory address; the old factory stays live for its existing pools.
///      Required env:
///        CONFIRM_STAKING_V2_DEPLOY=yes
///        STAKING_FEE_RECIPIENT — 0x351BDe628892Aeb055F717300DBd2848af178479
///        PRIVATE_KEY — deployer signing key, transient only, never stored here.
///      Example:
///        CONFIRM_STAKING_V2_DEPLOY=yes STAKING_FEE_RECIPIENT=0x351B... PRIVATE_KEY=0x... \
///        forge script script/v2/DeployStakingFactoryV2.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast
///      Do NOT deploy from the manager wallet 0x9a21... before the Nov 12
///      Growth Fund creation unless it is funded: the wallet held 0.00436 ETH
///      on 2026-11-11 ~21:30 PST (up from 0.0004 ETH at midday — topped up
///      ~0.004 ETH) and the deploy costs ~0.0002 ETH at current gas, so the
///      deploy itself is affordable; but the wallet still needs 0.11 ETH total
///      for the Nov 12 skin mint, so it remains ~0.106 ETH short either way.
///      Deploy after Nov 12, or from the 0x351B wallet if Jon controls it
///      and it is funded.
contract DeployStakingFactoryV2 is Script {
    error DeployNotConfirmed();

    function run() external returns (PolydashStakingFactoryV2 factory) {
        if (keccak256(bytes(vm.envOr("CONFIRM_STAKING_V2_DEPLOY", string("")))) != keccak256("yes")) {
            revert DeployNotConfirmed();
        }
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address feeRecipient = vm.envAddress("STAKING_FEE_RECIPIENT");

        vm.startBroadcast(pk);
        factory = new PolydashStakingFactoryV2(feeRecipient);
        vm.stopBroadcast();

        console2.log("PolydashStakingFactoryV2:", address(factory));
        console2.log("owner:", factory.owner());
        console2.log("feeRecipient:", factory.feeRecipient());
    }
}
