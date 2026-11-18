// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FundLiquidityFacetPhase3} from "../src/fund/phase3/FundLiquidityFacetPhase3.sol";
import {FundStakeFacetPhase3} from "../src/fund/phase3/FundStakeFacetPhase3.sol";
import {FundFactoryPhase3V3} from "../src/fund/phase3/FundFactoryPhase3V3.sol";

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

/// @notice Deploy the LP-Dividend (Strategy #6) stack on Robinhood Chain and publish
///         the LP fee-menu strategies #6 (5%), #7 (0%), #8 (10%), #9 (20%) on the live
///         StrategyTemplate. Deploys ONLY new contracts — the live V2 factory, the live
///         swap facet, the live allowlist, and all live funds are untouched.
///
///         What it deploys:
///           1. `FundLiquidityFacetPhase3` — the LP facet (add/remove/harvest, V4).
///           2. `FundStakeFacetPhase3` — the stake facet (stake/unstake/claim, V2 pools).
///           3. `FundFactoryPhase3V3` — the new factory. It reuses the LIVE V2 swap
///              facet (0x7dC7...) and the live allowlist / StrategyTemplate / WETH, and
///              wires the new liquidity facet, the stake facet, the current + legacy
///              staking factories, POLYDASH as the stake token, and the canonical
///              PoolManager. A third `FundPhase5` deployment pointing at this factory
///              is a separate follow-up (secondary listings, conviction locks, NAV
///              floor, carry, renderer for V3 funds).
///           4. Strategies #6–#9 on the live StrategyTemplate (owner-only, deployer
///              0x9a21...776d0). All four clone Strategy #2's params exactly
///              (assets [POLYDASH], 8000/1000/500/2000/2592000) except `hwmFeeBps`:
///              #6 = 500 (5%, the Polyfund default), #7 = 0, #8 = 1000, #9 = 2000.
///              Strategy #6 is the LP strategy; the fee menu is per-strategy, NOT a
///              second axis. Each strategy's mandate is the Strategy #6 mandate file
///              with only the fee line changed; `mandateHash` is keccak256 of the exact
///              mandate file bytes, `mandateUri` is the `ipfs add` (dag-pb unixfs) CID
///              after pinning.
///
///         Mandate hashes (keccak256 of the exact file bytes, 2026-11-15 — updated
///         for the Strategy rename + thin-fee/flywheel paragraph + weekly-harvest fix):
///           #6 (5%):  0x2447ab812d6029a072adea55fabae85f8112dcb1f2c066c53615f993d9685f74
///           #7 (0%):  0xc484ef46644fd50e3a068ed10001e404e45dff32ab2a167785fd0a5a0ef75b7c
///           #8 (10%): 0xaa2e3d26f5445c7177d5debc6f66bd7a2a169e9a3f1e5cd490bc08479cf26366
///           #9 (20%): 0x037f447fd20bf375caf8d0205982229085b90c2b89270c4a68bdfe278149a50c
///         Mandate files: ~/workspace/goals/polypad-phase-2-tokenized-funds/files/
///         strategy-{6,7,8,9}-mandate.md. The URIs below MUST be the pinned IPFS CIDs
///         for those exact files — pass them in the environment; the script refuses to
///         run with a placeholder. (If a mandate file changes after pinning, its hash
///         changes too: recompute with `cast keccak 0x$(od -A n -v -t x1 file | tr -d ' \n')`.)
///
///         The script refuses to run if templateCount is not 5 (the menu would
///         double-publish on a re-run), and verifies the count is 9 and each
///         template's fee reads back correctly after publishing.
///
/// @dev Dry-run (no broadcast, no key needed — simulation only, nothing is sent):
///      CONFIRM_LP_DIVIDEND_DEPLOY=yes \
///      TEMPLATE6_URI=ipfs://<cid-6> TEMPLATE7_URI=ipfs://<cid-7> \
///      TEMPLATE8_URI=ipfs://<cid-8> TEMPLATE9_URI=ipfs://<cid-9> \
///      forge script script/DeployLPDividend.s.sol \
///        --rpc-url https://robinhood.drpc.org \
///        --sender 0x9a21c75aC263cC43125E70200636f6397f8776d0 --unlocked
///      Real run (deployer key required, never in chat or files):
///      ... same env ... forge script script/DeployLPDividend.s.sol \
///        --rpc-url https://robinhood.drpc.org --broadcast --private-key 0x...
contract DeployLPDividend is Script {
    error DeployNotConfirmed();
    error UnexpectedTemplateCount(uint256 count);
    error BadMandateUri(string uri);

    address internal constant STRATEGY_TEMPLATE = 0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba;
    address internal constant ALLOWLIST = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address internal constant SWAP_FACET_V2 = 0x7dC767E1D0B0AC89282cB72a784174Ce29CdDaC7;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant FEE_RECIPIENT = 0x9a21c75aC263cC43125E70200636f6397f8776d0;
    address internal constant STAKING_FACTORY = 0x4C87aff7009DE1c58E052FEe202349a10b28Be9c;
    address internal constant LEGACY_STAKING_FACTORY = 0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0;

    // keccak256 of the exact mandate file bytes (see header). The URIs come from env.
    bytes32 internal constant HASH_6 = 0x2447ab812d6029a072adea55fabae85f8112dcb1f2c066c53615f993d9685f74;
    bytes32 internal constant HASH_7 = 0xc484ef46644fd50e3a068ed10001e404e45dff32ab2a167785fd0a5a0ef75b7c;
    bytes32 internal constant HASH_8 = 0xaa2e3d26f5445c7177d5debc6f66bd7a2a169e9a3f1e5cd490bc08479cf26366;
    bytes32 internal constant HASH_9 = 0x037f447fd20bf375caf8d0205982229085b90c2b89270c4a68bdfe278149a50c;

    function run() external {
        if (keccak256(bytes(vm.envString("CONFIRM_LP_DIVIDEND_DEPLOY"))) != keccak256(bytes("yes"))) {
            revert DeployNotConfirmed();
        }
        string memory uri6 = vm.envString("TEMPLATE6_URI");
        string memory uri7 = vm.envString("TEMPLATE7_URI");
        string memory uri8 = vm.envString("TEMPLATE8_URI");
        string memory uri9 = vm.envString("TEMPLATE9_URI");
        _checkUri(uri6);
        _checkUri(uri7);
        _checkUri(uri8);
        _checkUri(uri9);

        IStrategyTemplate tmpl = IStrategyTemplate(STRATEGY_TEMPLATE);
        uint256 before = tmpl.templateCount();
        if (before != 5) revert UnexpectedTemplateCount(before);
        console2.log("templateCount before:", before);

        address[] memory assets = new address[](1);
        assets[0] = POLYDASH;

        vm.startBroadcast();
        FundLiquidityFacetPhase3 facet = new FundLiquidityFacetPhase3();
        console2.log("liquidity facet:", address(facet));
        FundStakeFacetPhase3 stakeFacet = new FundStakeFacetPhase3();
        console2.log("stake facet:", address(stakeFacet));
        FundFactoryPhase3V3 factory = new FundFactoryPhase3V3(
            FEE_RECIPIENT,
            ALLOWLIST,
            WETH,
            SWAP_FACET_V2,
            address(facet),
            STRATEGY_TEMPLATE,
            address(stakeFacet),
            STAKING_FACTORY,
            LEGACY_STAKING_FACTORY,
            POLYDASH,
            POOL_MANAGER
        );
        console2.log("V3 factory:", address(factory));
        uint256 id6 = tmpl.publish(HASH_6, uri6, assets, 8000, 1000, 500, 500, 2000, 2_592_000);
        uint256 id7 = tmpl.publish(HASH_7, uri7, assets, 8000, 1000, 500, 0, 2000, 2_592_000);
        uint256 id8 = tmpl.publish(HASH_8, uri8, assets, 8000, 1000, 500, 1000, 2000, 2_592_000);
        uint256 id9 = tmpl.publish(HASH_9, uri9, assets, 8000, 1000, 500, 2000, 2000, 2_592_000);
        vm.stopBroadcast();

        console2.log("published strategy ids:");
        console2.log(id6);
        console2.log(id7);
        console2.log(id8);
        console2.log(id9);
        require(id6 == 6 && id7 == 7 && id8 == 8 && id9 == 9, "unexpected ids");
        uint256 afterCount = tmpl.templateCount();
        require(afterCount == 9, "count not 9");
        console2.log("templateCount after:", afterCount);
        (,,,,, uint256 fee6,,) = tmpl.getTemplate(6);
        (,,,,, uint256 fee7,,) = tmpl.getTemplate(7);
        (,,,,, uint256 fee8,,) = tmpl.getTemplate(8);
        (,,,,, uint256 fee9,,) = tmpl.getTemplate(9);
        require(fee6 == 500 && fee7 == 0 && fee8 == 1000 && fee9 == 2000, "fee mismatch");
        console2.log("fees read back (bps):");
        console2.log(fee6);
        console2.log(fee7);
        console2.log(fee8);
        console2.log(fee9);
        require(factory.liquidityFacet() == address(facet), "factory facet mismatch");
        require(factory.poolManager() == POOL_MANAGER, "factory pool manager mismatch");
        require(factory.stakeFacet() == address(stakeFacet), "factory stake facet mismatch");
        require(factory.stakingFactory() == STAKING_FACTORY, "factory staking factory mismatch");
        require(factory.legacyStakingFactory() == LEGACY_STAKING_FACTORY, "factory legacy staking factory mismatch");
        require(factory.stakeToken() == POLYDASH, "factory stake token mismatch");
        require(factory.swapFacet() == SWAP_FACET_V2, "factory must reuse the live V2 swap facet");
        console2.log("LP-DIVIDEND DEPLOYED: facets + V3 factory + strategies 6 (5%), 7 (0%), 8 (10%), 9 (20%)");
        console2.log("NEXT: pin the 4 mandate files to IPFS (URIs above must match the pinned CIDs),");
        console2.log("verify all new contracts on Sourcify, deploy a third FundPhase5 for the V3 factory,");
        console2.log("then create the Polyfund from strategy 6 (PDGFUND, 0.01 ETH mint, 2 ETH cap, 30-day raise).");
    }

    function _checkUri(string memory uri) internal pure {
        bytes memory b = bytes(uri);
        if (
            b.length < 10 || b[0] != "i" || b[1] != "p" || b[2] != "f" || b[3] != "s" || b[4] != ":" || b[5] != "/"
                || b[6] != "/"
        ) revert BadMandateUri(uri);
        if (keccak256(b) == keccak256(bytes("ipfs://PENDING-PIN"))) revert BadMandateUri(uri);
    }
}
