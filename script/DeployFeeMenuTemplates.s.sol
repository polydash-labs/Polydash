// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/// @notice Minimal StrategyTemplate interface (publish + reads only).
interface IStrategyTemplate {
    function publish(
        bytes32 mandateHash,
        string calldata mandateUri,
        address[] calldata assets,
        uint256 maxPositionBps,
        uint256 maxTradeBps,
        uint256 maxDeviationBps,
        uint256 hwmFeeBps,
        uint256 maxDrawdownBps,
        uint64 skinLock
    ) external returns (uint256 id);
    function templateCount() external view returns (uint256);
    function getTemplate(uint256 id)
        external
        view
        returns (
            bytes32 mandateHash,
            string memory mandateUri,
            uint256 maxPositionBps,
            uint256 maxTradeBps,
            uint256 maxDeviationBps,
            uint256 hwmFeeBps,
            uint256 maxDrawdownBps,
            uint64 skinLock
        );
}

/// @notice Publish the performance-fee menu: Templates #3 (0%), #4 (10%) and
///         #5 (20%) on the live StrategyTemplate. All three clone Template #2's
///         params exactly (assets [POLYDASH], 8000/1000/500/2000/2592000) except
///         hwmFeeBps. Template #2 (5%) stays as-is, so the menu is 0/5/10/20%.
///         Each template's mandate is a copy of the Template #2 mandate with
///         only the fee line changed; mandateHash is keccak256 of the mandate
///         file, mandateUri is the standard `ipfs add` (dag-pb unixfs) CID.
///         Publishing is owner-only (deployer 0x9a21...776d0) and each publish is
///         one transaction, gas only. There is no 2-day wait for publishing a
///         template; the new templates are usable as soon as the front-end
///         wizard offers them.
///         The script refuses to run if templateCount is not 2 (the menu would
///         double-publish on a re-run), and verifies the count is 5 and each
///         template's fee reads back correctly after publishing.
/// @dev Dry-run (no broadcast, no key needed):
///      CONFIRM_FEE_MENU_DEPLOY=yes forge script script/DeployFeeMenuTemplates.s.sol
///        --rpc-url https://robinhood.drpc.org
///        --sender 0x9a21c75aC263cC43125E70200636f6397f8776d0 --unlocked
///      Real run (deployer key required, never in chat or files):
///      CONFIRM_FEE_MENU_DEPLOY=yes forge script script/DeployFeeMenuTemplates.s.sol
///        --rpc-url https://robinhood.drpc.org --broadcast --private-key 0x...
contract DeployFeeMenuTemplates is Script {
    error DeployNotConfirmed();
    error UnexpectedTemplateCount(uint256 count);

    address internal constant STRATEGY_TEMPLATE = 0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba;
    address internal constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;

    // Template #3 — 0% performance fee.
    bytes32 internal constant HASH_3 = 0x68df4cdec4822f0035090fd2bf637453236e82bfdbd9ffa74df9bc0082770a10;
    string internal constant URI_3 = "ipfs://bafybeiec5tvugkpmzhrnzsx4dgbbsnfxh4t4cqqnetca6xeoetm6liquhm";
    // Template #4 — 10% performance fee.
    bytes32 internal constant HASH_4 = 0xfc734273b2aa3a6edf8ec03a58b6adbb32767d1e8e6bd0a27cc8fd6117552796;
    string internal constant URI_4 = "ipfs://bafybeicug6lgvloamdsg5eju3hk23efvah5yuiqteuyrxstjx2fma2g4hy";
    // Template #5 — 20% performance fee.
    bytes32 internal constant HASH_5 = 0x11fe08a0fd4528a0ecda7e1f771192e922c441d0199568258f3f93165a1f687b;
    string internal constant URI_5 = "ipfs://bafybeibvdjvhttfrgsxpuwosgqbvsimvuppzsg562kbv26lfzk5vqan5r4";

    function run() external {
        if (keccak256(bytes(vm.envString("CONFIRM_FEE_MENU_DEPLOY"))) != keccak256(bytes("yes"))) {
            revert DeployNotConfirmed();
        }
        IStrategyTemplate tmpl = IStrategyTemplate(STRATEGY_TEMPLATE);
        uint256 before = tmpl.templateCount();
        if (before != 2) revert UnexpectedTemplateCount(before);
        console2.log("templateCount before:", before);

        address[] memory assets = new address[](1);
        assets[0] = POLYDASH;

        vm.startBroadcast();
        uint256 id3 = tmpl.publish(HASH_3, URI_3, assets, 8000, 1000, 500, 0, 2000, 2592000);
        uint256 id4 = tmpl.publish(HASH_4, URI_4, assets, 8000, 1000, 500, 1000, 2000, 2592000);
        uint256 id5 = tmpl.publish(HASH_5, URI_5, assets, 8000, 1000, 500, 2000, 2000, 2592000);
        vm.stopBroadcast();

        console2.log("published template ids:", id3, id4, id5);
        require(id3 == 3 && id4 == 4 && id5 == 5, "unexpected ids");
        uint256 afterCount = tmpl.templateCount();
        require(afterCount == 5, "count not 5");
        console2.log("templateCount after:", afterCount);
        (,,,,, uint256 fee3,,) = tmpl.getTemplate(3);
        (,,,,, uint256 fee4,,) = tmpl.getTemplate(4);
        (,,,,, uint256 fee5,,) = tmpl.getTemplate(5);
        require(fee3 == 0 && fee4 == 1000 && fee5 == 2000, "fee mismatch");
        console2.log("fees read back (bps):", fee3, fee4, fee5);
        console2.log("FEE MENU PUBLISHED: 0% = template 3, 5% = template 2, 10% = template 4, 20% = template 5");
    }
}
