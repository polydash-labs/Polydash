// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundAllowlist} from "../../../src/fund/phase2/FundAllowlist.sol";
import {IFundAllowlist} from "../../../src/fund/phase2/Interfaces.sol";
import {FundVaultStore} from "../../../src/fund/phase2/FundVaultStore.sol";
import {FundFactoryPhase3V2} from "../../../src/fund/phase3/FundFactoryPhase3V2.sol";
import {FundNFTPhase3} from "../../../src/fund/phase3/FundNFTPhase3.sol";
import {FundProposalStore} from "../../../src/fund/phase3/FundProposalStore.sol";
import {FundSwapFacetPhase3V2} from "../../../src/fund/phase3/FundSwapFacetPhase3V2.sol";
import {FundVaultPhase3V2} from "../../../src/fund/phase3/FundVaultPhase3V2.sol";
import {StrategyTemplate} from "../../../src/fund/phase3/StrategyTemplate.sol";
import {MockERC20} from "../../mocks/MockERC20.sol";
import {MockFeed, MockWETH, RateRouter} from "../InvestMocks.sol";

/// @title ManagerProposedAssetsTest (not reviewed, not deployed)
/// @notice Local unit tests for the Option 3 proposal mechanism on `FundVaultPhase3V2` /
///         `FundSwapFacetPhase3V2` / `FundFactoryPhase3V2`. No fork: mock WETH, mock assets at
///         a fixed 1:1 rate, and a fresh allowlist + template + V2 factory. The fund holds
///         2 ETH of NAV (2 shares at 1 ETH), template caps 8000 max position / 7500 max trade
///         / 5000 max deviation, drawdown brake off (0), so cap arithmetic is exact.
contract ManagerProposedAssetsTest is Test {
    MockWETH weth;
    MockERC20 assetA; // template asset: in the mandate from creation, cap 0 (template cap only)
    MockERC20 assetB; // proposed asset: added via propose -> wait -> execute
    MockERC20 assetC; // never allowlisted: execute must fail closed
    MockFeed feedA;
    MockFeed feedB;
    RateRouter router;
    FundAllowlist allow;
    StrategyTemplate templates;
    FundFactoryPhase3V2 factory;
    uint256 templateId;

    address manager = makeAddr("manager");
    address buyer = makeAddr("buyer");

    function setUp() public {
        weth = new MockWETH();
        assetA = new MockERC20("Alpha", "ALP", 0);
        assetB = new MockERC20("Beta", "BET", 0);
        assetC = new MockERC20("Gamma", "GAM", 0);
        feedA = new MockFeed();
        feedA.setPrice(1e18);
        feedB = new MockFeed();
        feedB.setPrice(1e18);
        router = new RateRouter(1e18, 1e18);
        assetA.transfer(address(router), 1000 ether);
        assetB.transfer(address(router), 1000 ether);
        vm.deal(address(router), 100 ether);
        vm.deal(manager, 50 ether);
        vm.deal(buyer, 50 ether);

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        FundAllowlist.AssetInit[] memory seeded = new FundAllowlist.AssetInit[](3);
        seeded[0] = FundAllowlist.AssetInit(address(weth), true, address(0), 0, 0, 0);
        seeded[1] = FundAllowlist.AssetInit(address(assetA), false, address(feedA), 1 hours, 0.1e18, 10e18);
        seeded[2] = FundAllowlist.AssetInit(address(assetB), false, address(feedB), 1 hours, 0.1e18, 10e18);
        allow = new FundAllowlist(address(this), 1 days, routers, seeded);

        templates = new StrategyTemplate(address(this));
        address[] memory universe = new address[](1);
        universe[0] = address(assetA);
        templateId = templates.publish(
            keccak256("mandate-v2"), "ipfs://phase3-v2-mandate", universe, 8000, 7500, 5000, 500, 0, 7 days
        );
        factory = new FundFactoryPhase3V2(
            address(this), address(allow), address(weth), address(new FundSwapFacetPhase3V2()), address(templates)
        );
    }

    // --- Full happy path ---

    function test_buy_before_execute_reverts() public {
        (, FundVaultPhase3V2 vault) = _open();
        vm.prank(manager);
        vault.proposeAsset(address(assetB), 3000, "Beta is growing", "ipfs://thesis-beta");
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotInMandate.selector);
        vault.swap(address(router), address(0), address(assetB), 0.1 ether, 1, "");
    }

    function test_early_execute_reverts_then_execute_works() public {
        (, FundVaultPhase3V2 vault) = _open();
        vm.prank(manager);
        uint256 id = vault.proposeAsset(address(assetB), 3000, "Beta is growing", "ipfs://thesis-beta");
        vm.warp(vm.getBlockTimestamp() + 2 days - 1);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.TooEarly.selector);
        vault.executeAsset(id);
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.prank(manager);
        vault.executeAsset(id);
        assertTrue(vault.inMandate(address(assetB)));
        assertTrue(vault.sellable(address(assetB)));
        assertEq(vault.assetCap(address(assetB)), 3000);
        assertEq(vault.mandateAssetCount(), 2);
        assertEq(vault.mandateAssets(1), address(assetB));
        assertEq(uint8(vault.getProposal(id).status), uint8(FundProposalStore.ProposalStatus.Executed));

        vm.prank(manager);
        vault.swap(address(router), address(0), address(assetB), 0.5 ether, 1, "");
        assertEq(IERC20(address(assetB)).balanceOf(address(vault)), 0.5 ether);
        uint256 held = IERC20(address(assetB)).balanceOf(address(vault));
        vm.prank(manager);
        vault.swap(address(router), address(assetB), address(0), held / 2, 1, "");
        assertEq(IERC20(address(assetB)).balanceOf(address(vault)), held / 2);
    }

    // --- Access control ---

    function test_nonManager_propose_execute_cancel_remove_revert() public {
        (, FundVaultPhase3V2 vault) = _open();
        vm.prank(buyer);
        vm.expectRevert(FundVaultStore.NotManager.selector);
        vault.proposeAsset(address(assetB), 3000, "Beta is growing", "ipfs://thesis-beta");
        vm.prank(manager);
        uint256 id = vault.proposeAsset(address(assetB), 3000, "Beta is growing", "ipfs://thesis-beta");
        vm.prank(buyer);
        vm.expectRevert(FundVaultStore.NotManager.selector);
        vault.executeAsset(id);
        vm.prank(buyer);
        vm.expectRevert(FundVaultStore.NotManager.selector);
        vault.cancelProposal(id);
        vm.prank(buyer);
        vm.expectRevert(FundVaultStore.NotManager.selector);
        vault.proposeRemoval(address(assetA));
    }

    // --- Cancel ---

    function test_cancel_works_and_cannot_execute_after() public {
        (, FundVaultPhase3V2 vault) = _open();
        vm.prank(manager);
        uint256 id = vault.proposeAsset(address(assetB), 3000, "Beta is growing", "ipfs://thesis-beta");
        vm.prank(manager);
        vault.cancelProposal(id);
        assertEq(uint8(vault.getProposal(id).status), uint8(FundProposalStore.ProposalStatus.Cancelled));
        vm.warp(vm.getBlockTimestamp() + 3 days);
        vm.prank(manager);
        vm.expectRevert(FundProposalStore.NotPending.selector);
        vault.executeAsset(id);
        vm.prank(manager);
        vm.expectRevert(FundProposalStore.NotPending.selector);
        vault.cancelProposal(id);
        assertFalse(vault.inMandate(address(assetB)));
    }

    // --- Proposal validation ---

    function test_propose_validation() public {
        (, FundVaultPhase3V2 vault) = _open();
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadPair.selector);
        vault.proposeAsset(address(0), 3000, "Why", "ipfs://x");
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadPair.selector);
        vault.proposeAsset(address(weth), 3000, "Why", "ipfs://x");
        // A cap of 0 means "use the default": the proposal stores 3000 (30%).
        vm.prank(manager);
        uint256 defaultId = vault.proposeAsset(address(assetB), 0, "Why", "ipfs://x");
        assertEq(vault.getProposal(defaultId).maxPositionBps, 3000);
        assertEq(vault.assetCap(address(assetB)), 0); // cap applies only on execution
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadValue.selector);
        vault.proposeAsset(address(assetB), 10_001, "Why", "ipfs://x");
        // A reason longer than 512 bytes reverts; an empty reason is allowed.
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadUri.selector);
        vault.proposeAsset(address(assetB), 3000, string(new bytes(513)), "ipfs://x");
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadUri.selector);
        vault.proposeAsset(address(assetB), 3000, "Why", "");
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadUri.selector);
        vault.proposeAsset(address(assetB), 3000, "Why", string(new bytes(513)));
        // An asset already in the mandate (template asset) cannot be proposed.
        vm.prank(manager);
        vm.expectRevert(FundProposalStore.AlreadyInMandate.selector);
        vault.proposeAsset(address(assetA), 3000, "Why", "ipfs://x");
        // Unknown proposal ids revert.
        vm.prank(manager);
        vm.expectRevert(FundProposalStore.BadProposal.selector);
        vault.executeAsset(99);
        vm.prank(manager);
        vm.expectRevert(FundProposalStore.BadProposal.selector);
        vault.getProposal(0);
    }

    // --- Execution requires the allowlist side ---

    function test_execute_requires_allowlisted_asset() public {
        (, FundVaultPhase3V2 vault) = _open();
        // assetC is a real token with no allowlist entry and no feed. The vault-side
        // proposal succeeds; execution must fail closed until the allowlist side is live.
        vm.prank(manager);
        uint256 id = vault.proposeAsset(address(assetC), 3000, "Gamma is new", "ipfs://thesis-gamma");
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotAllowlisted.selector);
        vault.executeAsset(id);
    }

    // --- Per-asset cap vs template cap ---

    function test_perAssetCap_binds_below_template_cap() public {
        (, FundVaultPhase3V2 vault) = _open();
        _executeAdd(vault, address(assetB), 2000, "ipfs://thesis-beta");
        // NAV ~2 ETH. 0.3 ETH is 15% (under the 20% proposal cap); a second 0.3 ETH buy
        // would take the position to 30%, over the proposal cap but under the 80% template cap.
        vm.prank(manager);
        vault.swap(address(router), address(0), address(assetB), 0.3 ether, 1, "");
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.PositionCap.selector);
        vault.swap(address(router), address(0), address(assetB), 0.3 ether, 1, "");
        assertEq(IERC20(address(assetB)).balanceOf(address(vault)), 0.3 ether);
    }

    function test_proposalCap_above_template_cap_leaves_template_cap_binding() public {
        (, FundVaultPhase3V2 vault) = _open();
        _executeAdd(vault, address(assetB), 9000, "ipfs://thesis-beta");
        // Effective cap is min(8000 template, 9000 proposal) = 8000. Four 0.4 ETH buys
        // reach 1.6 ETH = 80.02% of NAV; the fourth must revert on the template cap.
        // (0.5 ETH buys do not work here: after three of them only 0.5 ETH of spendable
        // ETH is left, so a fourth reverts on funding before it reaches the cap check.)
        for (uint256 i; i < 3; ++i) {
            vm.prank(manager);
            vault.swap(address(router), address(0), address(assetB), 0.4 ether, 1, "");
        }
        assertEq(IERC20(address(assetB)).balanceOf(address(vault)), 1.2 ether);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.PositionCap.selector);
        vault.swap(address(router), address(0), address(assetB), 0.4 ether, 1, "");
    }

    function test_templateAsset_with_no_proposal_cap_uses_template_cap() public {
        (, FundVaultPhase3V2 vault) = _open();
        // assetA is a template asset: assetCap == 0, so only the 80% template cap applies.
        assertEq(vault.assetCap(address(assetA)), 0);
        for (uint256 i; i < 3; ++i) {
            vm.prank(manager);
            vault.swap(address(router), address(0), address(assetA), 0.4 ether, 1, "");
        }
        assertEq(IERC20(address(assetA)).balanceOf(address(vault)), 1.2 ether);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.PositionCap.selector);
        vault.swap(address(router), address(0), address(assetA), 0.4 ether, 1, "");
    }

    function test_templateAsset_can_be_sold() public {
        (, FundVaultPhase3V2 vault) = _open();
        // Regression: the facet gates sells on `sellable`, not `inMandate`, so a
        // template asset must be marked sellable at construction — otherwise the
        // fund could buy it and never sell it. Buy 0.5 ETH of assetA, sell half.
        assertTrue(vault.sellable(address(assetA)));
        vm.prank(manager);
        vault.swap(address(router), address(0), address(assetA), 0.5 ether, 1, "");
        assertEq(IERC20(address(assetA)).balanceOf(address(vault)), 0.5 ether);
        vm.prank(manager);
        vault.swap(address(router), address(assetA), address(0), 0.25 ether, 1, "");
        assertEq(IERC20(address(assetA)).balanceOf(address(vault)), 0.25 ether);
    }

    // --- Removal: blocks buys, never blocks sells (the critical rule) ---

    function test_remove_blocks_buys_not_sells() public {
        (, FundVaultPhase3V2 vault) = _open();
        _executeAdd(vault, address(assetB), 3000, "ipfs://thesis-beta");
        vm.prank(manager);
        vault.swap(address(router), address(0), address(assetB), 0.5 ether, 1, "");
        uint256 navBefore = vault.nav();
        assertGt(navBefore, 0);

        vm.prank(manager);
        uint256 rid = vault.proposeRemoval(address(assetB));
        assertEq(uint8(vault.getProposal(rid).kind), uint8(FundProposalStore.ProposalKind.Remove));
        vm.warp(vm.getBlockTimestamp() + 2 days - 1);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.TooEarly.selector);
        vault.executeRemoval(rid);
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.prank(manager);
        vault.executeRemoval(rid);

        assertFalse(vault.inMandate(address(assetB)));
        assertTrue(vault.sellable(address(assetB)));
        // The asset stays in _mandateAssets, so nav() still values the holding.
        assertEq(vault.mandateAssetCount(), 2);
        assertEq(vault.mandateAssets(1), address(assetB));
        assertEq(vault.nav(), navBefore);

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotInMandate.selector);
        vault.swap(address(router), address(0), address(assetB), 0.1 ether, 1, "");

        // Selling the removed asset MUST succeed, in full.
        uint256 held = IERC20(address(assetB)).balanceOf(address(vault));
        vm.prank(manager);
        vault.swap(address(router), address(assetB), address(0), held, 1, "");
        assertEq(IERC20(address(assetB)).balanceOf(address(vault)), 0);
    }

    function test_exit_after_removal_still_pays_the_holding() public {
        (FundNFTPhase3 nft, FundVaultPhase3V2 vault) = _open();
        _executeAdd(vault, address(assetB), 3000, "ipfs://thesis-beta");
        vm.prank(manager);
        vault.swap(address(router), address(0), address(assetB), 0.5 ether, 1, "");
        vm.prank(manager);
        uint256 rid = vault.proposeRemoval(address(assetB));
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        vault.executeRemoval(rid);

        // The buyer exits one of two shares and must receive half the removed asset in kind.
        uint256[] memory ids = new uint256[](1);
        ids[0] = 2;
        vm.prank(buyer);
        nft.exit(ids);
        assertEq(IERC20(address(assetB)).balanceOf(buyer), 0.25 ether);
        assertEq(nft.balanceOf(buyer), 0);
    }

    function test_sell_never_mandated_asset_reverts() public {
        (, FundVaultPhase3V2 vault) = _open();
        // assetC was never in the mandate: no sell path exists for it.
        assetC.transfer(address(vault), 1 ether);
        vm.prank(manager);
        vm.expectRevert(FundProposalStore.NotSellable.selector);
        vault.swap(address(router), address(assetC), address(0), 1 ether, 1, "");
    }

    function test_proposeRemoval_requires_inMandate() public {
        (, FundVaultPhase3V2 vault) = _open();
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotInMandate.selector);
        vault.proposeRemoval(address(assetB));
    }

    function test_executeRemoval_wrong_kind_reverts() public {
        (, FundVaultPhase3V2 vault) = _open();
        vm.prank(manager);
        uint256 id = vault.proposeAsset(address(assetB), 3000, "Beta is growing", "ipfs://thesis-beta");
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        vm.expectRevert(FundProposalStore.BadProposal.selector);
        vault.executeRemoval(id);
        vm.prank(manager);
        vm.expectRevert(FundProposalStore.BadProposal.selector);
        vault.executeAsset(0);
    }

    // --- Re-add after removal must not duplicate the mandate list ---

    function test_readd_after_removal_does_not_duplicate_mandate_list() public {
        (, FundVaultPhase3V2 vault) = _open();
        _executeAdd(vault, address(assetB), 3000, "ipfs://thesis-beta");
        vm.prank(manager);
        uint256 rid = vault.proposeRemoval(address(assetB));
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        vault.executeRemoval(rid);
        assertEq(vault.mandateAssetCount(), 2);

        _executeAdd(vault, address(assetB), 4000, "ipfs://thesis-beta-v2");
        assertEq(vault.mandateAssetCount(), 2);
        assertEq(vault.assetCap(address(assetB)), 4000);
        assertTrue(vault.inMandate(address(assetB)));
        vm.prank(manager);
        vault.swap(address(router), address(0), address(assetB), 0.1 ether, 1, "");
        assertEq(IERC20(address(assetB)).balanceOf(address(vault)), 0.1 ether);
    }

    // --- MAX_ASSETS guard ---

    function test_execute_reverts_when_mandate_is_full() public {
        // A template with all 16 mandate slots filled: a 17th asset cannot be added.
        MockERC20[] memory many = new MockERC20[](16);
        MockFeed[] memory feeds = new MockFeed[](16);
        address[] memory assets = new address[](16);
        FundAllowlist.AssetInit[] memory seeded = new FundAllowlist.AssetInit[](18);
        seeded[0] = FundAllowlist.AssetInit(address(weth), true, address(0), 0, 0, 0);
        for (uint256 i; i < 16; ++i) {
            many[i] = new MockERC20("Many", "MNY", 0);
            feeds[i] = new MockFeed();
            feeds[i].setPrice(1e18);
            assets[i] = address(many[i]);
            seeded[i + 1] = FundAllowlist.AssetInit(address(many[i]), false, address(feeds[i]), 1 hours, 0.1e18, 10e18);
        }
        // assetB must be allowlisted too, so execution reaches the mandate-size check
        // instead of failing closed on the allowlist check first.
        seeded[17] = FundAllowlist.AssetInit(address(assetB), false, address(feedB), 1 hours, 0.1e18, 10e18);
        address[] memory routers = new address[](1);
        routers[0] = address(router);
        FundAllowlist fullAllow = new FundAllowlist(address(this), 1 days, routers, seeded);
        StrategyTemplate fullTemplates = new StrategyTemplate(address(this));
        uint256 fullId =
            fullTemplates.publish(keccak256("full"), "ipfs://full", assets, 8000, 7500, 5000, 500, 0, 7 days);
        FundFactoryPhase3V2 fullFactory = new FundFactoryPhase3V2(
            address(this),
            address(fullAllow),
            address(weth),
            address(new FundSwapFacetPhase3V2()),
            address(fullTemplates)
        );
        vm.prank(manager);
        FundNFTPhase3 nft = FundNFTPhase3(
            fullFactory.createFund(
                FundFactoryPhase3V2.Params({
                    templateId: fullId,
                    name: "Full",
                    symbol: "FULL",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 1 ether,
                    raiseCap: 2 ether,
                    entryFeeBps: 0,
                    minSkinBps: 5000,
                    raiseDuration: 30 days
                })
            )
        );
        FundVaultPhase3V2 vault = FundVaultPhase3V2(payable(address(nft.vault())));
        assertEq(vault.mandateAssetCount(), 16);
        vm.prank(manager);
        uint256 id = vault.proposeAsset(address(assetB), 3000, "Beta is growing", "ipfs://thesis-beta");
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.TooMany.selector);
        vault.executeAsset(id);
    }

    // --- Views ---

    function test_proposal_views_paginate() public {
        (, FundVaultPhase3V2 vault) = _open();
        vm.prank(manager);
        vault.proposeAsset(address(assetB), 3000, "First asset", "ipfs://one");
        vm.prank(manager);
        vault.proposeAsset(address(assetC), 4000, "Second asset", "ipfs://two");
        assertEq(vault.proposalCount(), 2);
        uint256[] memory page = vault.proposalIds(0, 10);
        assertEq(page.length, 2);
        assertEq(page[0], 1);
        assertEq(page[1], 2);
        assertEq(vault.proposalIds(1, 10).length, 1);
        assertEq(vault.proposalIds(1, 10)[0], 2);
        assertEq(vault.proposalIds(2, 10).length, 0);
        assertEq(vault.proposalIds(0, 0).length, 0);
        assertEq(vault.getProposal(2).asset, address(assetC));
    }

    // --- Allowlist removal edge: sells need the allowlist side live ---

    function test_sell_after_allowlist_removal_reverts() public {
        (, FundVaultPhase3V2 vault) = _open();
        _executeAdd(vault, address(assetB), 3000, "ipfs://thesis-beta");
        vm.prank(manager);
        vault.swap(address(router), address(0), address(assetB), 0.5 ether, 1, "");
        uint256 held = IERC20(address(assetB)).balanceOf(address(vault));
        vm.prank(manager);
        vault.swap(address(router), address(assetB), address(0), held, 1, "");
        // Zero balance now, so nav() skips the asset. Remove it from the allowlist.
        uint256 pid = allow.propose(address(assetB), false, false);
        vm.warp(vm.getBlockTimestamp() + 1 days + 1);
        allow.execute(pid);
        assertFalse(allow.assetAllowed(address(assetB)));
        // The mandate still lists it and it is still sellable — but the facet's
        // allowlist check fails closed, so neither a buy nor a sell can run.
        assertTrue(vault.sellable(address(assetB)));
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotAllowlisted.selector);
        vault.swap(address(router), address(0), address(assetB), 0.1 ether, 1, "");
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotAllowlisted.selector);
        vault.swap(address(router), address(assetB), address(0), 0.1 ether, 1, "");
    }

    function test_nav_reverts_when_a_held_asset_leaves_the_allowlist() public {
        (, FundVaultPhase3V2 vault) = _open();
        _executeAdd(vault, address(assetB), 3000, "ipfs://thesis-beta");
        vm.prank(manager);
        vault.swap(address(router), address(0), address(assetB), 0.5 ether, 1, "");
        // Pre-existing NAVReader rule (not V2-specific): nav() reverts when a mandate
        // asset with a nonzero balance is not allowlisted. The allowlist owner must
        // never remove a held asset — it freezes exits until the asset is re-allowlisted.
        uint256 pid = allow.propose(address(assetB), false, false);
        vm.warp(vm.getBlockTimestamp() + 1 days + 1);
        allow.execute(pid);
        vm.expectRevert(IFundAllowlist.PriceUnavailable.selector);
        vault.nav();
    }

    // --- Helpers ---

    function _open() internal returns (FundNFTPhase3 nft, FundVaultPhase3V2 vault) {
        (nft, vault) = _raise();
        vm.prank(manager);
        vault.enableInvesting();
    }

    function _raise() internal returns (FundNFTPhase3 nft, FundVaultPhase3V2 vault) {
        nft = _create(1 ether, 2 ether, 0, 5000, 30 days);
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        // FundNFTPhase3 declares `vault` as the V1 type; the V2 factory deploys a V2
        // vault, so the address is cast here (same pattern the front end must use).
        vault = FundVaultPhase3V2(payable(address(nft.vault())));
    }

    function _create(uint256 price, uint256 cap, uint256 entryBps, uint256 skinBps, uint256 duration)
        internal
        returns (FundNFTPhase3 nft)
    {
        vm.prank(manager);
        nft = FundNFTPhase3(
            factory.createFund(
                FundFactoryPhase3V2.Params({
                    templateId: templateId,
                    name: "Phase3V2",
                    symbol: "P3V2",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: price,
                    raiseCap: cap,
                    entryFeeBps: entryBps,
                    minSkinBps: skinBps,
                    raiseDuration: duration
                })
            )
        );
    }

    /// @dev Propose + warp + execute an add proposal, as the manager.
    function _executeAdd(FundVaultPhase3V2 vault, address asset, uint256 capBps, string memory thesis) internal {
        vm.prank(manager);
        uint256 id = vault.proposeAsset(asset, capBps, "Thesis", thesis);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        vault.executeAsset(id);
    }
}
