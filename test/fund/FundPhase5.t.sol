// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {FundFactoryPhase3} from "../../src/fund/phase3/FundFactoryPhase3.sol";
import {FundNFTPhase3} from "../../src/fund/phase3/FundNFTPhase3.sol";
import {FundVaultPhase3} from "../../src/fund/phase3/FundVaultPhase3.sol";
import {FundVaultStore} from "../../src/fund/phase2/FundVaultStore.sol";
import {FundCarryRights} from "../../src/fund/phase5/FundCarryRights.sol";
import {FundConvictionLock} from "../../src/fund/phase5/FundConvictionLock.sol";
import {FundNavFloor} from "../../src/fund/phase5/FundNavFloor.sol";
import {FundPhase5} from "../../src/fund/phase5/FundPhase5.sol";
import {FundSecondaryMarket} from "../../src/fund/phase5/FundSecondaryMarket.sol";
import {Phase5Fund} from "../../src/fund/phase5/IPhase5.sol";
import {MockFeed} from "./InvestMocks.sol";
import {Phase5Fixture} from "./Phase5Fixture.sol";

contract ToggleToken is ERC20 {
    bool public paused;

    constructor() ERC20("Toggle", "TOG") {
        _mint(msg.sender, 1e24);
    }

    function setPaused(bool next) external {
        paused = next;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (paused && from != address(0) && to != address(0)) revert("paused");
        super._update(from, to, value);
    }
}

contract FlexFactory {
    address public weth;
    mapping(address => bool) public isFund;

    constructor(address nextWeth) {
        weth = nextWeth;
    }

    function setFund(address nft, bool ok) external {
        isFund[nft] = ok;
    }
}

contract Desk {
    address public nft;
    address public manager;

    function bind(address next, address mgr) external {
        nft = next;
        manager = mgr;
    }

    function payoutWallet() external view returns (address) {
        return manager;
    }

    function status() external pure returns (uint8) {
        return 2;
    }

    function navPerNft() external pure returns (uint256) {
        return 1 ether;
    }

    function peakNavPerNft() external pure returns (uint256) {
        return 1 ether;
    }

    function maxDrawdownBps() external pure returns (uint256) {
        return 0;
    }
}

contract RoyaltyShare is ERC721, ERC2981 {
    address public vault;
    uint256 public skinRequired;
    uint64 public skinUnlockTime;
    uint256 public mintPrice = 1 ether;
    bool public blow;

    constructor(address vault_, address royaltyTo) ERC721("Royalty", "ROY") {
        vault = vault_;
        _mint(msg.sender, 1);
        _setDefaultRoyalty(royaltyTo, 500);
    }

    function outstanding() external pure returns (uint256) {
        return 1;
    }

    function exit(uint256[] calldata) external {}

    function refund(uint256[] calldata) external {}

    function setBlow(bool next) external {
        blow = next;
    }

    function royaltyInfo(uint256 tokenId, uint256 salePrice) public view override returns (address, uint256) {
        if (blow) return (address(0xBEEF), salePrice + 1);
        return super.royaltyInfo(tokenId, salePrice);
    }

    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }
}

contract CallbackShare is ERC721 {
    address public vault;
    uint256 public skinRequired;
    uint64 public skinUnlockTime;
    uint256 public mintPrice = 1 ether;
    FundSecondaryMarket public market;
    address public seller;
    bool public armed;
    uint256 public hits;

    constructor(address vault_) ERC721("Callback", "CB") {
        vault = vault_;
        _mint(msg.sender, 1);
    }

    function outstanding() external pure returns (uint256) {
        return 1;
    }

    function exit(uint256[] calldata) external {}

    function refund(uint256[] calldata) external {}

    function arm(FundSecondaryMarket nextMarket, address nextSeller) external {
        market = nextMarket;
        seller = nextSeller;
        armed = true;
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        super.transferFrom(from, to, tokenId);
        if (!armed) return;
        armed = false;
        (bool paid,) = seller.call(abi.encodeWithSignature("poke()"));
        if (paid) hits += 1;
        try market.fill(1) {
            hits += 10;
        } catch {}
    }
}

contract Seller {
    FundSecondaryMarket public market;

    constructor(FundSecondaryMarket next) {
        market = next;
    }

    receive() external payable {}

    function poke() external {
        market.withdraw();
    }

    function list(CallbackShare nft, uint256 price) external {
        nft.approve(address(market), 1);
        market.list(address(nft), 1, price);
    }
}

contract FundPhase5Test is Phase5Fixture {
    function test_modules_point_at_the_phase3_factory() public view {
        assertEq(address(phase5.factory()), address(factory));
        assertEq(market.factory(), address(factory));
        assertEq(renderer.factory(), address(factory));
        assertEq(locks.factory(), address(factory));
        assertEq(carry.factory(), address(factory));
        assertEq(floor.factory(), address(factory));
        assertEq(market.registry(), address(phase5));
        assertEq(locks.registry(), address(phase5));
    }

    function test_modules_reject_plain_eth() public {
        _rejectEth(address(market), FundSecondaryMarket.DirectEth.selector);
        (bool lockPaid,) = address(locks).call{value: 1}("");
        assertFalse(lockPaid);
        _rejectEth(address(carry), FundCarryRights.DirectEth.selector);
        _rejectEth(address(floor), FundNavFloor.DirectEth.selector);
    }

    function test_unknown_collection_reverts() public {
        vm.expectRevert(Phase5Fund.NotFund.selector);
        market.list(address(0x1234), 1, 1);
    }

    function test_approval_fill_pays_the_seller_and_leaves_the_vault() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        uint256 price = 0.4 ether;
        uint256 fees = _fees(vault);
        uint256 supply = nft.outstanding();
        uint256 vaultEth = address(vault).balance;
        vm.prank(buyer);
        nft.approve(address(market), 2);
        vm.prank(buyer);
        uint256 id = market.list(address(nft), 2, price);
        uint256 sellerBefore = buyer.balance;
        vm.prank(buyer2);
        market.fill{value: price}(id);
        assertEq(nft.ownerOf(2), buyer2);
        assertEq(nft.outstanding(), supply);
        assertEq(address(vault).balance, vaultEth);
        assertEq(_fees(vault), fees);
        assertEq(market.proceeds(buyer), price);
        assertEq(address(market).balance, price);
        vm.prank(buyer);
        market.withdraw();
        assertEq(buyer.balance - sellerBefore, price);
        assertEq(address(market).balance, 0);
        assertEq(market.owedTotal(), 0);
        assertEq(nft.tokenURI(2), "");
    }

    function test_fill_requires_approval_exact_value_and_a_single_listing() public {
        (FundNFTPhase3 nft,) = _open();
        vm.prank(buyer);
        uint256 id = market.list(address(nft), 2, 0.2 ether);
        vm.prank(buyer2);
        vm.expectRevert(FundSecondaryMarket.NotApproved.selector);
        market.fill{value: 0.2 ether}(id);
        vm.prank(buyer);
        nft.approve(address(market), 2);
        vm.prank(buyer2);
        vm.expectRevert(FundSecondaryMarket.BadValue.selector);
        market.fill{value: 0.2 ether - 1}(id);
        vm.prank(buyer);
        vm.expectRevert(FundSecondaryMarket.SelfFill.selector);
        market.fill{value: 0.2 ether}(id);
        vm.prank(buyer);
        vm.expectRevert(FundSecondaryMarket.AlreadyListed.selector);
        market.list(address(nft), 2, 0.3 ether);
        vm.prank(buyer);
        vm.expectRevert(FundSecondaryMarket.BadPrice.selector);
        market.list(address(nft), 2, 0);
    }

    function test_escrow_cancel_returns_the_share_and_only_the_seller_can_cancel() public {
        (FundNFTPhase3 nft,) = _open();
        vm.startPrank(buyer);
        nft.approve(address(market), 2);
        uint256 id = market.listEscrow(address(nft), 2, 0.3 ether);
        vm.stopPrank();
        assertEq(nft.ownerOf(2), address(market));
        assertTrue(market.holds(address(nft), 2));
        vm.prank(buyer2);
        vm.expectRevert(FundSecondaryMarket.NotSeller.selector);
        market.cancel(id);
        vm.prank(buyer);
        market.cancel(id);
        assertEq(nft.ownerOf(2), buyer);
        assertFalse(market.holds(address(nft), 2));
        vm.prank(buyer2);
        vm.expectRevert(FundSecondaryMarket.NoListing.selector);
        market.fill{value: 0.3 ether}(id);
    }

    function test_escrow_fill() public {
        (FundNFTPhase3 nft,) = _open();
        vm.startPrank(buyer);
        nft.approve(address(market), 2);
        uint256 id = market.listEscrow(address(nft), 2, 0.3 ether);
        vm.stopPrank();
        vm.prank(buyer2);
        market.fill{value: 0.3 ether}(id);
        assertEq(nft.ownerOf(2), buyer2);
        vm.prank(buyer);
        market.withdraw();
        assertEq(market.proceeds(buyer), 0);
    }

    function test_new_holder_can_clear_a_stale_approval_listing() public {
        (FundNFTPhase3 nft,) = _open();
        vm.prank(buyer);
        uint256 id = market.list(address(nft), 2, 0.2 ether);
        vm.prank(buyer);
        nft.transferFrom(buyer, buyer2, 2);
        vm.prank(buyer2);
        vm.expectRevert(FundSecondaryMarket.NotHolder.selector);
        market.fill{value: 0.2 ether}(id);
        vm.prank(buyer2);
        market.cancel(id);
        vm.prank(buyer2);
        nft.approve(address(market), 2);
        vm.prank(buyer2);
        uint256 next = market.list(address(nft), 2, 0.5 ether);
        assertEq(market.listing(next).seller, buyer2);
    }

    function test_skin_share_cannot_be_listed_and_can_still_exit() public {
        (FundNFTPhase3 nft,) = _open();
        vm.prank(manager);
        vm.expectRevert(FundSecondaryMarket.SkinLocked.selector);
        market.list(address(nft), 1, 0.2 ether);
        vm.prank(manager);
        nft.approve(address(floor), 1);
        vm.prank(manager);
        vm.expectRevert(FundNFTPhase3.SkinLocked.selector);
        floor.queue(address(nft), 1);
        vm.prank(manager);
        nft.exit(_ids(1));
        assertEq(nft.balanceOf(manager), 0);
    }

    function test_locked_modules_cannot_buy() public {
        (FundNFTPhase3 nft,) = _open();
        vm.prank(buyer);
        nft.approve(address(market), 2);
        vm.prank(buyer);
        uint256 id = market.list(address(nft), 2, 0.2 ether);
        vm.deal(address(locks), 0.2 ether);
        vm.prank(address(locks));
        vm.expectRevert(FundSecondaryMarket.BadBuyer.selector);
        market.fill{value: 0.2 ether}(id);
    }

    function test_royalty_is_paid_and_an_oversized_royalty_reverts() public {
        FlexFactory flex = new FlexFactory(address(weth));
        FundPhase5 book = new FundPhase5(address(flex));
        FundSecondaryMarket desk = FundSecondaryMarket(payable(book.market()));
        Desk vault = new Desk();
        address royaltyTo = makeAddr("royaltyTo");
        RoyaltyShare share = new RoyaltyShare(address(vault), royaltyTo);
        vault.bind(address(share), manager);
        flex.setFund(address(share), true);

        share.approve(address(desk), 1);
        uint256 id = desk.list(address(share), 1, 1 ether);
        vm.prank(buyer2);
        desk.fill{value: 1 ether}(id);
        assertEq(desk.proceeds(address(this)), 0.95 ether);
        assertEq(desk.proceeds(royaltyTo), 0.05 ether);
        uint256 before = royaltyTo.balance;
        vm.prank(royaltyTo);
        desk.withdraw();
        assertEq(royaltyTo.balance - before, 0.05 ether);

        Desk other = new Desk();
        RoyaltyShare blown = new RoyaltyShare(address(other), royaltyTo);
        blown.setBlow(true);
        other.bind(address(blown), manager);
        flex.setFund(address(blown), true);
        blown.approve(address(desk), 1);
        uint256 bad = desk.list(address(blown), 1, 1 ether);
        vm.prank(buyer2);
        vm.expectRevert(FundSecondaryMarket.BadRoyalty.selector);
        desk.fill{value: 1 ether}(bad);
    }

    function test_fill_reentrancy_does_not_pay_twice() public {
        FlexFactory flex = new FlexFactory(address(weth));
        FundPhase5 book = new FundPhase5(address(flex));
        FundSecondaryMarket desk = FundSecondaryMarket(payable(book.market()));
        Desk vault = new Desk();
        CallbackShare share = new CallbackShare(address(vault));
        vault.bind(address(share), manager);
        flex.setFund(address(share), true);
        Seller seller = new Seller(desk);
        share.transferFrom(address(this), address(seller), 1);
        seller.list(share, 0.5 ether);
        share.arm(desk, address(seller));
        desk.fill{value: 0.5 ether}(1);
        assertEq(share.hits(), 0);
        assertEq(desk.proceeds(address(seller)), 0.5 ether);
        uint256 before = address(seller).balance;
        seller.poke();
        assertEq(address(seller).balance - before, 0.5 ether);
        assertEq(address(desk).balance, 0);
    }

    function test_share_art_is_black_and_white_and_reads_the_vault() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        string memory art = renderer.svg(address(nft), 2);
        string memory meta = renderer.metadata(address(nft), 2);
        assertTrue(_blackWhite(art));
        assertTrue(_has(art, "Phase5"));
        assertTrue(_has(art, "NAV PER SHARE"));
        assertTrue(_has(art, "CHANGE VS MINT"));
        assertTrue(_has(art, "DRAWDOWN BRAKE"));
        assertTrue(_has(art, ">OFF<"));
        assertTrue(_has(art, "LOCK 0"));
        assertTrue(_has(meta, "Not financial advice"));
        assertTrue(_has(renderer.tokenURI(address(nft), 2), "data:application/json;base64,"));
        int256 change = renderer.changeBps(vault.navPerNft(), nft.mintPrice());
        assertLt(change, 0);
        assertTrue(_has(art, "-"));

        vm.prank(manager);
        vault.swap(address(router), address(0), address(asset), 0.5 ether, 1, "");
        feed.setPrice(3e18);
        string memory lifted = renderer.svg(address(nft), 2);
        assertTrue(_blackWhite(lifted));
        assertGt(renderer.changeBps(vault.navPerNft(), nft.mintPrice()), 0);
        assertTrue(_has(lifted, "+"));

        feed.setPrice(0.4e18);
        string memory dropped = renderer.svg(address(nft), 2);
        assertTrue(_has(dropped, ">ON<"));
        assertTrue(_blackWhite(dropped));

        feed.pinAt(1);
        vm.warp(block.timestamp + 2 hours);
        string memory unread = renderer.svg(address(nft), 2);
        assertTrue(_has(unread, "UNAVAILABLE"));
        assertTrue(_has(unread, "UNREAD"));
        assertTrue(_blackWhite(unread));
        assertGt(bytes(renderer.tokenURI(address(nft), 2)).length, 0);
    }

    function test_share_art_escapes_the_name() public {
        FundNFTPhase3 nft = _create(1 ether, 1 ether, 0, 10_000, 1 hours, 'A&B"C');
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        string memory art = renderer.svg(address(nft), 1);
        string memory meta = renderer.metadata(address(nft), 1);
        assertTrue(_has(art, "A&amp;B\"C"));
        assertTrue(_has(meta, 'A&B\\"C'));
        assertTrue(_blackWhite(art));
    }

    function test_conviction_lock_blocks_transfer_list_and_exit_until_expiry() public {
        (FundNFTPhase3 nft,) = _open();
        uint256[3] memory tiers = [uint256(30), 90, 180];
        for (uint256 i; i < tiers.length; ++i) {
            vm.startPrank(buyer);
            nft.approve(address(locks), 2);
            locks.lock(address(nft), 2, tiers[i]);
            vm.stopPrank();
            assertEq(locks.tierOf(address(nft), 2), tiers[i]);
            assertTrue(locks.isLocked(address(nft), 2));
            assertEq(nft.ownerOf(2), address(locks));
            vm.prank(buyer);
            vm.expectRevert(FundSecondaryMarket.NotHolder.selector);
            market.list(address(nft), 2, 0.1 ether);
            vm.prank(buyer);
            vm.expectRevert(FundNFTPhase3.NotHolder.selector);
            nft.exit(_ids(2));
            vm.prank(buyer);
            vm.expectRevert();
            nft.transferFrom(buyer, buyer2, 2);
            vm.prank(buyer);
            vm.expectRevert(FundConvictionLock.TooEarly.selector);
            locks.unlock(address(nft), 2);
            vm.warp(block.timestamp + tiers[i] * 1 days - 1);
            vm.prank(buyer);
            vm.expectRevert(FundConvictionLock.TooEarly.selector);
            locks.unlock(address(nft), 2);
            vm.warp(block.timestamp + 1);
            assertFalse(locks.isLocked(address(nft), 2));
            assertEq(locks.tierOf(address(nft), 2), tiers[i]);
            vm.prank(buyer2);
            vm.expectRevert(FundConvictionLock.NotHolder.selector);
            locks.unlock(address(nft), 2);
            vm.prank(buyer);
            locks.unlock(address(nft), 2);
            assertEq(nft.ownerOf(2), buyer);
            assertEq(locks.tierOf(address(nft), 2), 0);
        }
        vm.prank(buyer);
        vm.expectRevert(FundConvictionLock.BadTier.selector);
        locks.lock(address(nft), 2, 45);
    }

    function test_lock_clears_an_approval_listing_and_art_shows_the_tier() public {
        (FundNFTPhase3 nft,) = _open();
        vm.prank(buyer);
        uint256 id = market.list(address(nft), 2, 0.2 ether);
        vm.startPrank(buyer);
        nft.approve(address(locks), 2);
        locks.lock(address(nft), 2, 90);
        vm.stopPrank();
        assertEq(market.activeId(address(nft), 2), 0);
        vm.prank(buyer2);
        vm.expectRevert(FundSecondaryMarket.NoListing.selector);
        market.fill{value: 0.2 ether}(id);
        assertTrue(_has(renderer.svg(address(nft), 2), "LOCK 90"));
        vm.prank(buyer);
        vm.expectRevert(FundNavFloor.NotHolder.selector);
        floor.queue(address(nft), 2);
    }

    function test_carry_routes_performance_fees_and_blocks_transfer_on_the_brake() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        vm.prank(manager);
        vm.expectRevert(FundCarryRights.PayoutNotSet.selector);
        carry.arm(address(nft));
        vm.prank(manager);
        vault.swap(address(router), address(0), address(asset), 0.5 ether, 1, "");
        feed.setPrice(2e18);
        uint256 per = vault.navPerNft();
        uint256 hwm = vault.hwmPerNft();
        uint256 expected = ((per - hwm) * nft.outstanding() * vault.hwmFeeBps()) / 10_000;
        uint256 room = vault.spendableEth();
        if (expected > room) expected = room;
        assertGt(expected, 0);
        assertEq(vault.harvest(), expected);

        vm.prank(manager);
        vault.setPayoutWallet(address(carry));
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.TransferFailed.selector);
        vault.withdrawPerformanceFee();
        vm.prank(manager);
        uint256 tokenId = carry.arm(address(nft));
        assertEq(carry.ownerOf(tokenId), manager);
        assertTrue(carry.routed(address(nft)));
        uint256 managerBefore = manager.balance;
        vm.prank(manager);
        vault.withdrawPerformanceFee();
        assertEq(manager.balance, managerBefore);
        assertEq(carry.claimable(address(nft)), expected);
        assertEq(address(carry).balance, expected);

        feed.setPrice(0.4e18);
        vm.prank(manager);
        vm.expectRevert(FundCarryRights.TransferBlocked.selector);
        carry.transferFrom(manager, buyer, tokenId);
        feed.setPrice(2e18);
        vm.prank(manager);
        carry.transferFrom(manager, buyer, tokenId);
        vm.prank(buyer);
        assertEq(carry.claim(address(nft)), expected);
        assertEq(address(carry).balance, 0);
        vm.prank(manager);
        vm.expectRevert(FundCarryRights.NotHolder.selector);
        carry.claim(address(nft));

        feed.setPrice(3e18);
        uint256 more = vault.harvest();
        vm.prank(manager);
        vault.setPayoutWallet(manager);
        assertFalse(carry.routed(address(nft)));
        if (more > 0) {
            uint256 managerMid = manager.balance;
            vm.prank(manager);
            vault.withdrawPerformanceFee();
            assertEq(manager.balance - managerMid, more);
        }
        assertEq(carry.claimable(address(nft)), 0);
    }

    function test_carry_transfer_is_blocked_during_the_raise_and_when_the_feed_reverts() public {
        FundNFTPhase3 nft = _create(1 ether, 4 ether, 0, 500, 30 days, "Raising");
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        FundVaultPhase3 vault = nft.vault();
        assertEq(uint8(vault.status()), 0);
        vm.prank(manager);
        vault.setPayoutWallet(address(carry));
        vm.prank(manager);
        uint256 tokenId = carry.arm(address(nft));
        vm.prank(manager);
        vm.expectRevert(FundCarryRights.TransferBlocked.selector);
        carry.transferFrom(manager, buyer, tokenId);

        (FundNFTPhase3 live, FundVaultPhase3 book) = _open();
        vm.prank(manager);
        book.setPayoutWallet(address(carry));
        vm.prank(manager);
        uint256 liveId = carry.arm(address(live));
        vm.prank(manager);
        book.swap(address(router), address(0), address(asset), 0.4 ether, 1, "");
        feed.pinAt(1);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(manager);
        vm.expectRevert(FundCarryRights.TransferBlocked.selector);
        carry.transferFrom(manager, buyer, liveId);
    }

    function test_entry_fees_follow_the_same_payout_wallet() public {
        FundNFTPhase3 nft = _create(1 ether, 2 ether, 500, 5000, 30 days, "Entry");
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        FundVaultPhase3 vault = nft.vault();
        uint256 entry = vault.claimableEntryFee();
        uint256 protocol = vault.claimableProtocolFee();
        assertGt(entry, 0);
        vm.prank(manager);
        vault.setPayoutWallet(address(carry));
        vm.prank(manager);
        carry.arm(address(nft));
        vm.prank(manager);
        vault.withdrawEntryFee();
        assertEq(carry.claimable(address(nft)), entry);
        assertEq(vault.claimableProtocolFee(), protocol);
        factory.setFeeRecipient(buyer2);
        uint256 recipientEth = buyer2.balance;
        vault.withdrawProtocolFee();
        assertEq(buyer2.balance - recipientEth, protocol);
        assertEq(carry.claimable(address(nft)), entry);
    }

    function test_nav_floor_redeem_matches_the_quote_and_leaves_fees() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        uint256 fees = _fees(vault);
        uint256 trades = vault.tradeCount();
        (uint256 ethShare,,) = floor.quote(address(nft), 2);
        vm.startPrank(buyer);
        nft.approve(address(floor), 2);
        floor.queue(address(nft), 2);
        vm.expectRevert(FundNavFloor.CoolingDown.selector);
        floor.redeem(address(nft), 2);
        vm.stopPrank();
        vm.warp(block.timestamp + floor.EXIT_COOLDOWN() - 1);
        vm.prank(buyer);
        vm.expectRevert(FundNavFloor.CoolingDown.selector);
        floor.redeem(address(nft), 2);
        vm.warp(block.timestamp + 1);
        uint256 before = buyer.balance;
        vm.prank(buyer);
        uint256 paid = floor.redeem(address(nft), 2);
        assertEq(paid, ethShare);
        assertEq(buyer.balance - before, ethShare);
        assertEq(_fees(vault), fees);
        assertEq(vault.tradeCount(), trades);
        assertEq(nft.balanceOf(buyer), 0);
        assertGt(vault.nav(), 0);
    }

    function test_nav_floor_cancel_returns_the_share() public {
        (FundNFTPhase3 nft,) = _open();
        vm.startPrank(buyer);
        nft.approve(address(floor), 2);
        floor.queue(address(nft), 2);
        floor.cancel(address(nft), 2);
        vm.stopPrank();
        assertEq(nft.ownerOf(2), buyer);
        vm.prank(buyer);
        nft.exit(_ids(2));
        assertEq(nft.balanceOf(buyer), 0);
    }

    function test_nav_floor_works_while_swaps_are_paused_and_the_brake_is_on() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        vm.prank(manager);
        vault.swap(address(router), address(0), address(asset), 0.4 ether, 1, "");
        feed.setPrice(0.4e18);
        vm.prank(manager);
        vault.setSwapsPaused(true);
        uint256 trades = vault.tradeCount();
        (uint256 ethShare,,) = floor.quote(address(nft), 2);
        uint256 tokens = floor.tokenShare(address(nft), 2, address(asset));
        assertGt(tokens, 0);
        vm.startPrank(buyer);
        nft.approve(address(floor), 2);
        floor.queue(address(nft), 2);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        uint256 ethBefore = buyer.balance;
        uint256 tokenBefore = asset.balanceOf(buyer);
        vm.prank(buyer);
        uint256 paid = floor.redeem(address(nft), 2);
        assertEq(paid, ethShare);
        assertEq(buyer.balance - ethBefore, ethShare);
        assertEq(asset.balanceOf(buyer) - tokenBefore, tokens);
        assertEq(vault.tradeCount(), trades);
        assertTrue(vault.swapsPaused());
    }

    function test_nav_floor_forwards_weth_and_includes_a_distribution() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        vm.prank(manager);
        vault.swap(address(0), address(0), address(weth), 0.4 ether, 1, "");
        vm.prank(manager);
        vault.distribute(0.2 ether);
        uint256 per = 0.2 ether / nft.outstanding();
        (uint256 ethShare,,) = floor.quote(address(nft), 2);
        uint256 wethShare = floor.tokenShare(address(nft), 2, address(weth));
        vm.startPrank(buyer);
        nft.approve(address(floor), 2);
        floor.queue(address(nft), 2);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        uint256 ethBefore = buyer.balance;
        vm.prank(buyer);
        floor.redeem(address(nft), 2);
        assertEq(buyer.balance - ethBefore, ethShare + per);
        assertEq(weth.balanceOf(buyer), wethShare);
        assertEq(vault.claimableProtocolFee(), (2 ether * 20) / 10_000);
    }

    function test_last_share_receives_the_remainder() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        vm.warp(nft.skinUnlockTime());
        uint256 start = vault.spendableEth();
        vm.startPrank(buyer);
        nft.approve(address(floor), 2);
        floor.queue(address(nft), 2);
        vm.stopPrank();
        vm.startPrank(manager);
        nft.approve(address(floor), 1);
        floor.queue(address(nft), 1);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        vm.prank(buyer);
        uint256 first = floor.redeem(address(nft), 2);
        vm.prank(manager);
        uint256 second = floor.redeem(address(nft), 1);
        assertEq(first + second, start);
        assertGt(second, 0);
        assertEq(vault.spendableEth(), 0);
        assertEq(_fees(vault), vault.claimableProtocolFee());
    }

    function test_queue_clears_an_approval_listing_and_rejects_escrow() public {
        (FundNFTPhase3 nft,) = _open();
        vm.prank(buyer);
        uint256 id = market.list(address(nft), 2, 0.2 ether);
        vm.startPrank(buyer);
        nft.approve(address(floor), 2);
        floor.queue(address(nft), 2);
        vm.stopPrank();
        assertEq(market.activeId(address(nft), 2), 0);
        vm.prank(buyer2);
        vm.expectRevert(FundSecondaryMarket.NoListing.selector);
        market.fill{value: 0.2 ether}(id);

        vm.prank(buyer);
        floor.cancel(address(nft), 2);
        vm.startPrank(buyer);
        nft.approve(address(market), 2);
        market.listEscrow(address(nft), 2, 0.2 ether);
        vm.stopPrank();
        vm.prank(address(market));
        vm.expectRevert(FundNavFloor.Listed.selector);
        floor.queue(address(nft), 2);
    }

    function test_failed_raise_refund_goes_through_the_queue() public {
        FundNFTPhase3 nft = _create(1 ether, 4 ether, 0, 500, 1 hours, "Miss");
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        vm.warp(nft.vault().raiseDeadline() + 1);
        nft.vault().failRaise();
        uint256 fees = _fees(nft.vault());
        (uint256 ethShare,, uint8 status) = floor.quote(address(nft), 2);
        assertEq(status, 3);
        vm.startPrank(buyer);
        nft.approve(address(floor), 2);
        floor.queue(address(nft), 2);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        uint256 before = buyer.balance;
        vm.prank(buyer);
        uint256 paid = floor.redeem(address(nft), 2);
        assertEq(paid, ethShare);
        assertEq(buyer.balance - before, ethShare);
        assertEq(_fees(nft.vault()), fees);
    }

    function test_reserved_token_can_be_pulled_after_redeem() public {
        ToggleToken toggle = new ToggleToken();
        MockFeed toggleFeed = new MockFeed();
        toggleFeed.setPrice(1e18);
        uint256 proposal = allow.proposeAsset(address(toggle), address(toggleFeed), 1 hours, 0.1e18, 10e18);
        vm.warp(block.timestamp + 1 days + 1);
        allow.execute(proposal);
        address[] memory universe = new address[](1);
        universe[0] = address(toggle);
        uint256 id = templates.publish(keccak256("toggle"), "ipfs://phase5-toggle", universe, 7500, 7500, 5000, 0, 0, 0);
        vm.prank(manager);
        FundNFTPhase3 nft = FundNFTPhase3(
            factory.createFund(
                FundFactoryPhase3.Params({
                    templateId: id,
                    name: "Toggle",
                    symbol: "TG",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 1 ether,
                    raiseCap: 2 ether,
                    entryFeeBps: 0,
                    minSkinBps: 5000,
                    raiseDuration: 7 days
                })
            )
        );
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        FundVaultPhase3 vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
        toggle.transfer(address(router), 10 ether);
        vm.prank(manager);
        vault.swap(address(router), address(0), address(toggle), 0.2 ether, 1, "");
        uint256 share = floor.tokenShare(address(nft), 2, address(toggle));
        assertGt(share, 0);
        toggle.setPaused(true);
        vm.startPrank(buyer);
        nft.approve(address(floor), 2);
        floor.queue(address(nft), 2);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        vm.prank(buyer);
        vm.expectRevert();
        floor.redeem(address(nft), 2);
        assertEq(nft.ownerOf(2), address(floor));
        toggle.setPaused(false);
        vm.prank(buyer);
        floor.redeem(address(nft), 2);
        assertEq(toggle.balanceOf(buyer), share);
    }

    function test_raising_share_cannot_be_queued() public {
        FundNFTPhase3 nft = _create(1 ether, 4 ether, 0, 500, 30 days, "Open");
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        vm.startPrank(buyer);
        nft.approve(address(floor), 2);
        vm.expectRevert(FundNavFloor.NotExitable.selector);
        floor.queue(address(nft), 2);
        vm.stopPrank();
    }

    function _fees(FundVaultPhase3 vault) internal view returns (uint256) {
        return vault.claimableEntryFee() + vault.claimableProtocolFee() + vault.claimablePerformanceFee();
    }

    function _rejectEth(address to, bytes4 selector) internal {
        (bool ok, bytes memory data) = to.call{value: 1}("");
        assertFalse(ok);
        assertEq(bytes4(data), selector);
    }

    function _has(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i; i + n.length <= h.length; ++i) {
            bool matched = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return true;
        }
        return false;
    }

    function _blackWhite(string memory art) internal pure returns (bool) {
        bytes memory b = bytes(art);
        for (uint256 i; i < b.length; ++i) {
            if (b[i] != "#") continue;
            if (i + 6 >= b.length) return false;
            if (!_hex(b, i + 1, "000000") && !_hex(b, i + 1, "ffffff")) return false;
        }
        if (_has(art, "rgb") || _has(art, "hsl") || _has(art, "gray") || _has(art, "grey")) return false;
        if (_has(art, "red") || _has(art, "blue") || _has(art, "green")) return false;
        return true;
    }

    function _hex(bytes memory b, uint256 start, bytes memory expect) private pure returns (bool) {
        bytes memory wanted = bytes(expect);
        for (uint256 j; j < wanted.length; ++j) {
            if (b[start + j] != wanted[j]) return false;
        }
        return true;
    }
}
