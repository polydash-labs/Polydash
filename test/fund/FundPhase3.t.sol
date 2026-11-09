// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryPhase3} from "../../src/fund/phase3/FundFactoryPhase3.sol";
import {FundNFTPhase3} from "../../src/fund/phase3/FundNFTPhase3.sol";
import {FundSwapFacetPhase3} from "../../src/fund/phase3/FundSwapFacetPhase3.sol";
import {FundVaultPhase3} from "../../src/fund/phase3/FundVaultPhase3.sol";
import {FundPhase3Store} from "../../src/fund/phase3/FundPhase3Store.sol";
import {StrategyTemplate} from "../../src/fund/phase3/StrategyTemplate.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed, MockWETH, RateRouter} from "./InvestMocks.sol";

contract FundPhase3Test is Test {
    MockWETH weth;
    MockERC20 asset;
    MockFeed feed;
    RateRouter router;
    FundAllowlist allow;
    StrategyTemplate templates;
    FundFactoryPhase3 factory;
    uint256 templateId;

    address manager = makeAddr("manager");
    address buyer = makeAddr("buyer");

    function setUp() public {
        weth = new MockWETH();
        asset = new MockERC20("Alpha", "ALP", 0);
        feed = new MockFeed();
        feed.setPrice(1e18);
        router = new RateRouter(1e18, 1e18);
        asset.transfer(address(router), 1000 ether);
        vm.deal(address(router), 100 ether);
        vm.deal(manager, 50 ether);
        vm.deal(buyer, 50 ether);

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        FundAllowlist.AssetInit[] memory seeded = new FundAllowlist.AssetInit[](2);
        seeded[0] = FundAllowlist.AssetInit(address(weth), true, address(0), 0, 0, 0);
        seeded[1] = FundAllowlist.AssetInit(address(asset), false, address(feed), 1 hours, 0.1e18, 10e18);
        allow = new FundAllowlist(address(this), 1 days, routers, seeded);

        templates = new StrategyTemplate(address(this));
        address[] memory universe = new address[](1);
        universe[0] = address(asset);
        templateId = templates.publish(
            keccak256("mandate"), "ipfs://phase3-mandate", universe, 7500, 7500, 5000, 1000, 1000, 7 days
        );
        factory = new FundFactoryPhase3(
            address(this), address(allow), address(weth), address(new FundSwapFacetPhase3()), address(templates)
        );
    }

    function test_template_values_stay_put() public view {
        (bytes32 hash, string memory uri,,,,, uint256 drawdown, uint64 lock) = templates.getTemplate(templateId);
        assertEq(hash, keccak256("mandate"));
        assertEq(uri, "ipfs://phase3-mandate");
        assertEq(drawdown, 1000);
        assertEq(lock, 7 days);
        assertEq(templates.assetsOf(templateId)[0], address(asset));
        assertEq(templates.templateCount(), 1);
    }

    function test_skin_cannot_transfer_and_can_burn() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        vm.prank(manager);
        vm.expectRevert(FundNFTPhase3.SkinLocked.selector);
        nft.transferFrom(manager, buyer, 1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(manager);
        nft.exit(ids);
        assertEq(nft.balanceOf(manager), 0);
        assertGt(vault.nav(), 0);
    }

    function test_skin_unlocks() public {
        (FundNFTPhase3 nft,) = _raise();
        vm.warp(nft.skinUnlockTime());
        vm.prank(manager);
        nft.transferFrom(manager, buyer, 1);
        assertEq(nft.ownerOf(1), buyer);
    }

    function test_high_water_mark_charges_the_gain_only() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        vm.prank(manager);
        vault.swap(address(router), address(0), address(asset), 0.5 ether, 1, "");
        uint256 marked = vault.hwmPerNft();
        feed.setPrice(2e18);
        uint256 lifted = vault.navPerNft();
        assertGt(lifted, marked);
        uint256 expected = ((lifted - marked) * nft.outstanding() * 1000) / 10_000;
        assertEq(vault.harvest(), expected);
        assertEq(vault.claimablePerformanceFee(), expected);
        assertEq(vault.hwmPerNft(), vault.navPerNft());
        assertEq(vault.harvest(), 0);
        uint256 managerBefore = manager.balance;
        vm.prank(manager);
        vault.withdrawPerformanceFee();
        assertEq(manager.balance - managerBefore, expected);
        assertEq(vault.claimablePerformanceFee(), 0);
    }

    function test_drawdown_brake_blocks_buys_and_allows_sells() public {
        (, FundVaultPhase3 vault) = _open();
        vm.prank(manager);
        vault.swap(address(router), address(0), address(asset), 0.5 ether, 1, "");
        feed.setPrice(0.5e18);
        router.setEthPerToken(0.5e18);
        assertGe(vault.navPerNft() < vault.peakNavPerNft() ? 1 : 0, 1);
        vm.prank(manager);
        vm.expectRevert(FundPhase3Store.DrawdownBrakeActive.selector);
        vault.swap(address(router), address(0), address(asset), 0.1 ether, 1, "");
        uint256 held = IERC20(address(asset)).balanceOf(address(vault));
        vm.prank(manager);
        vault.swap(address(router), address(asset), address(0), held, 1, "");
        assertEq(IERC20(address(asset)).balanceOf(address(vault)), 0);
    }

    function test_distribution_is_pro_rata_and_reserved() public {
        (, FundVaultPhase3 vault) = _open();
        uint256 amount = 0.2 ether;
        vm.prank(manager);
        uint256 roundId = vault.distribute(amount);
        assertEq(roundId, 1);
        assertEq(vault.distributionReserved(), 0.2 ether);
        uint256 spendable = vault.spendableEth();
        vm.prank(manager);
        vm.expectRevert();
        vault.swap(address(0), address(0), address(weth), spendable + 1, 1, "");

        uint256[] memory buyerId = new uint256[](1);
        buyerId[0] = 2;
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        vault.claim(buyerId);
        assertEq(buyer.balance - buyerBefore, 0.1 ether);
        assertEq(vault.distributionReserved(), 0.1 ether);
    }

    function test_distribution_exit_pays_the_round_then_the_share() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        vm.prank(manager);
        vault.distribute(0.2 ether);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 2;
        uint256 before = buyer.balance;
        uint256 spendable = vault.spendableEth();
        vm.prank(buyer);
        nft.exit(ids);
        assertEq(buyer.balance - before, 0.1 ether + spendable / 2);
        assertEq(nft.balanceOf(buyer), 0);
    }

    function testFuzz_protocol_fee_is_20_bps(uint96 price) public {
        price = uint96(bound(price, 0.001 ether, 5 ether));
        FundNFTPhase3 nft = _create(price, price, 0, 10_000, 1 hours);
        vm.prank(manager);
        nft.mint{value: price}(1);
        assertEq(nft.vault().claimableProtocolFee(), (uint256(price) * 20) / 10_000);
        assertEq(nft.vault().protocolFeeBps(), 20);
    }

    function testFuzz_distribution_conserves(uint96 amount) public {
        amount = uint96(bound(amount, 2, 0.4 ether));
        (, FundVaultPhase3 vault) = _open();
        vm.prank(manager);
        vault.distribute(amount);
        uint256 pot = vault.distributionReserved();
        uint256[] memory a = new uint256[](1);
        a[0] = 1;
        uint256[] memory b = new uint256[](1);
        b[0] = 2;
        uint256 before = manager.balance + buyer.balance;
        vm.prank(manager);
        vault.claim(a);
        vm.prank(buyer);
        vault.claim(b);
        assertEq((manager.balance + buyer.balance) - before, pot);
        assertEq(vault.distributionReserved(), 0);
    }

    function _raise() internal returns (FundNFTPhase3 nft, FundVaultPhase3 vault) {
        nft = _create(1 ether, 2 ether, 0, 5000, 30 days);
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        vault = nft.vault();
    }

    function _open() internal returns (FundNFTPhase3 nft, FundVaultPhase3 vault) {
        (nft, vault) = _raise();
        vm.prank(manager);
        vault.enableInvesting();
    }

    function _create(uint256 price, uint256 cap, uint256 entryBps, uint256 skinBps, uint256 duration)
        internal
        returns (FundNFTPhase3 nft)
    {
        vm.prank(manager);
        nft = FundNFTPhase3(
            factory.createFund(
                FundFactoryPhase3.Params({
                    templateId: templateId,
                    name: "Phase3",
                    symbol: "P3",
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
}
