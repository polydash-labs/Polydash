// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../src/fund/phase2/FundFactoryInvest.sol";
import {FundSwapFacet} from "../../src/fund/phase2/FundSwapFacet.sol";
import {FundNFTInvest} from "../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../src/fund/phase2/FundVaultInvest.sol";
import {FundVaultStore} from "../../src/fund/phase2/FundVaultStore.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed, MockWETH, RateRouter} from "./InvestMocks.sol";

/// @notice Phase 2 finish: fee-excluded NAV, per-fund swap caps, published mandate, hourly checkpoint.
contract FundNavCapsTest is Test {
    FundAllowlist allowlist;
    FundFactoryInvest factory;
    MockWETH weth;
    MockERC20 alpha;
    RateRouter router;

    address manager = makeAddr("manager");
    address alice = makeAddr("alice");
    address feeTo = makeAddr("fee");

    function setUp() public {
        weth = new MockWETH();
        alpha = new MockERC20("Alpha", "ALP", 0);
        router = new RateRouter(1e18, 1e18);

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        MockFeed feed = new MockFeed();
        FundAllowlist.AssetInit[] memory assets = new FundAllowlist.AssetInit[](2);
        assets[0] = FundAllowlist.AssetInit(address(weth), true, address(0), 0, 0, 0);
        assets[1] = FundAllowlist.AssetInit(address(alpha), false, address(feed), 1 hours, 0.5 ether, 1.5 ether);
        allowlist = new FundAllowlist(address(this), 2 days, routers, assets);
        factory = new FundFactoryInvest(feeTo, address(allowlist), address(weth), address(new FundSwapFacet()));

        vm.deal(manager, 1000 ether);
        vm.deal(alice, 1000 ether);
        alpha.transfer(address(router), 1_000_000 ether);
        vm.deal(address(router), 1000 ether);
    }

    function _params() internal view returns (FundFactoryInvest.Params memory p) {
        p.name = "Caps Fund";
        p.symbol = "CF";
        p.imageUri = "ipfs://image";
        p.baseURI = "ipfs://base/";
        p.mintPrice = 1 ether;
        p.raiseCap = 2 ether;
        p.entryFeeBps = 0;
        p.minSkinBps = 10_000;
        p.raiseDuration = 7 days;
        p.mandateHash = keccak256("caps-mandate");
        p.mandateUri = "ipfs://caps-mandate";
        p.maxPositionBps = 0;
        p.maxTradeBps = 0;
        p.maxDeviationBps = 0;
        p.assets = new address[](1);
        p.assets[0] = address(alpha);
    }

    function _create(FundFactoryInvest.Params memory p) internal returns (FundNFTInvest nft) {
        vm.prank(manager);
        nft = FundNFTInvest(factory.createFund(p));
    }

    function _fill(FundNFTInvest nft) internal {
        uint256 price = nft.mintPrice();
        if (!nft.publicOpen()) {
            uint256 skin = nft.skinRequired() - nft.managerMinted();
            vm.prank(manager);
            nft.mint{value: price * skin}(skin);
        }
        uint256 left = nft.maxSupply() - nft.totalSupply();
        if (left == 0) return;
        vm.prank(alice);
        nft.mint{value: price * left}(left);
    }

    function _ready(FundNFTInvest nft) internal returns (FundVaultInvest vault) {
        _fill(nft);
        vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
    }

    function _allowRouter(address next) internal {
        uint256 id = allowlist.propose(next, true, true);
        vm.warp(block.timestamp + allowlist.delay());
        allowlist.execute(id);
    }

    function test_nav_excludes_unclaimed_fees() public {
        FundFactoryInvest.Params memory p = _params();
        p.entryFeeBps = 500; // 5% entry fee, plus the fixed 0.2% protocol fee.
        FundNFTInvest nft = _create(p);
        FundVaultInvest vault = nft.vault();
        vm.prank(manager);
        nft.mint{value: 2 ether}(2);

        uint256 fees = vault.claimableFees();
        assertEq(fees, 2 ether * 520 / 10_000);
        assertEq(vault.nav(), address(vault).balance - fees);
        assertEq(vault.navPerNft(), vault.nav() / 2);
        // With only ETH held, NAV equals what an exit pays: spendable ETH.
        assertEq(vault.nav(), vault.spendableEth());
        assertEq(vault.nav(), 2 ether - fees);

        // Withdrawing the fees drops the balance by the fees and leaves NAV unchanged.
        uint256 navBefore = vault.nav();
        vault.withdrawProtocolFee();
        vm.prank(manager);
        vault.withdrawEntryFee();
        assertEq(vault.claimableFees(), 0);
        assertEq(address(vault).balance, 2 ether - fees);
        assertEq(vault.nav(), navBefore);
    }

    function test_explicit_caps_are_stored_and_zero_means_default() public {
        FundFactoryInvest.Params memory p = _params();
        p.maxPositionBps = 6000;
        p.maxTradeBps = 4000;
        p.maxDeviationBps = 2500;
        FundVaultInvest vault = _create(p).vault();
        assertEq(vault.maxPositionBps(), 6000);
        assertEq(vault.maxTradeBps(), 4000);
        assertEq(vault.maxDeviationBps(), 2500);

        FundVaultInvest defaults = _create(_params()).vault();
        assertEq(defaults.maxPositionBps(), 7500);
        assertEq(defaults.maxTradeBps(), 7500);
        assertEq(defaults.maxDeviationBps(), 5000);
    }

    function test_position_cap_blocks_an_overweight_buy() public {
        FundFactoryInvest.Params memory p = _params();
        p.maxPositionBps = 6000; // at most 60% of NAV in one asset.
        FundNFTInvest nft = _create(p);
        FundVaultInvest vault = _ready(nft);

        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 1 ether, 1 ether, "");
        assertEq(alpha.balanceOf(address(vault)), 1 ether);

        // A second buy would leave 1.3 ETH of alpha against ~2 ETH of NAV (65% > 60%).
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.PositionCap.selector);
        vault.swap(address(router), address(0), address(alpha), 0.3 ether, 0.3 ether, "");
        assertEq(alpha.balanceOf(address(vault)), 1 ether);
        assertEq(vault.tradeCount(), 1);
    }

    function test_trade_cap_blocks_an_oversized_trade() public {
        FundFactoryInvest.Params memory p = _params();
        p.maxTradeBps = 2500; // at most a quarter of NAV in one trade.
        FundNFTInvest nft = _create(p);
        FundVaultInvest vault = _ready(nft);

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.TradeCap.selector);
        vault.swap(address(router), address(0), address(alpha), 0.6 ether, 0.6 ether, "");
        assertEq(alpha.balanceOf(address(vault)), 0);

        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 0.4 ether, 0.4 ether, "");
        assertEq(alpha.balanceOf(address(vault)), 0.4 ether);
    }

    function test_deviation_blocks_a_bad_buy_and_a_bad_sell() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);

        // This router pays 0.5 alpha per ETH, so a buy executes at 2.0 ETH per token
        // against a 1.0 feed price: 100% deviation, over the 50% default.
        RateRouter badBuy = new RateRouter(0.5 ether, 1e18);
        alpha.transfer(address(badBuy), 100 ether);
        _allowRouter(address(badBuy));
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Deviation.selector);
        vault.swap(address(badBuy), address(0), address(alpha), 0.1 ether, 0.05 ether, "");
        assertEq(alpha.balanceOf(address(vault)), 0);

        // Buy at 1:1, then sell at 0.4 ETH per token against a 1.0 feed price (60% deviation).
        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 0.5 ether, 0.5 ether, "");
        router.setEthPerToken(0.4 ether);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Deviation.selector);
        vault.swap(address(router), address(alpha), address(0), 0.5 ether, 1, "");
        assertEq(alpha.balanceOf(address(vault)), 0.5 ether);
    }

    function test_mandate_uri_is_published_with_the_hash() public {
        bytes32 hash = keccak256("phase-2 mandate text");
        FundFactoryInvest.Params memory p = _params();
        p.mandateHash = hash;
        p.mandateUri = "ipfs://QmMandateText";
        vm.recordLogs();
        FundNFTInvest nft = _create(p);
        FundVaultInvest vault = nft.vault();
        assertEq(vault.mandateHash(), hash);
        assertEq(vault.mandateUri(), "ipfs://QmMandateText");

        bytes32 topic = keccak256("MandatePublished(bytes32,string)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length > 1 && logs[i].topics[0] == topic && logs[i].topics[1] == hash) found = true;
        }
        assertTrue(found);
    }

    function test_checkpoint_nav_records_an_hourly_point() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = nft.vault();

        // Checkpoint works while still raising.
        vault.checkpointNav();
        assertEq(vault.lastNavCheckpoint(), block.timestamp);
        assertEq(vault.lastCheckpointNavPerNft(), vault.navPerNft());

        vm.expectRevert(FundVaultStore.TooSoon.selector);
        vault.checkpointNav();

        _ready(nft);
        vm.warp(block.timestamp + 1 hours);
        vault.checkpointNav();
        assertEq(vault.lastNavCheckpoint(), block.timestamp);
        assertEq(vault.lastCheckpointNavPerNft(), vault.navPerNft());
    }

    function test_create_rejects_an_empty_mandate_uri_and_a_cap_over_100_percent() public {
        FundFactoryInvest.Params memory p = _params();
        p.mandateUri = "";
        vm.prank(manager);
        vm.expectRevert(FundFactoryInvest.InvalidParams.selector);
        factory.createFund(p);

        p = _params();
        p.maxPositionBps = 10_001;
        vm.prank(manager);
        vm.expectRevert(FundFactoryInvest.InvalidParams.selector);
        factory.createFund(p);
    }
}
