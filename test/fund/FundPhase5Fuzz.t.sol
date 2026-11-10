// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FundNFTPhase3} from "../../src/fund/phase3/FundNFTPhase3.sol";
import {FundVaultPhase3} from "../../src/fund/phase3/FundVaultPhase3.sol";
import {FundNavFloor} from "../../src/fund/phase5/FundNavFloor.sol";
import {FundSecondaryMarket} from "../../src/fund/phase5/FundSecondaryMarket.sol";
import {Phase5Fixture} from "./Phase5Fixture.sol";

contract FundPhase5FuzzTest is Phase5Fixture {
    FundNFTPhase3 internal nft;
    FundVaultPhase3 internal vault;
    uint256 internal accrued;

    function setUp() public override {
        super.setUp();
        (nft, vault) = _open();
        vm.prank(manager);
        vault.swap(address(router), address(0), address(asset), 0.5 ether, 1, "");
        vm.prank(manager);
        vault.setPayoutWallet(address(carry));
        vm.prank(manager);
        carry.arm(address(nft));
    }

    function testFuzz_change_bps_sign(uint128 start, uint128 end) public view {
        start = uint128(bound(start, 1, type(uint128).max));
        int256 bps = renderer.changeBps(end, start);
        if (end == start) {
            assertEq(bps, 0);
            return;
        }
        uint256 delta = end > start ? uint256(end) - start : uint256(start) - end;
        int256 floored = int256((delta * 10_000) / start);
        if (end > start) assertEq(bps, floored);
        else assertEq(bps, -floored);
    }

    function testFuzz_format_eth(uint96 whole, uint32 frac) public view {
        whole = uint96(bound(whole, 0, 1_000_000));
        frac = uint32(bound(frac, 0, 999_999));
        uint256 amount = uint256(whole) * 1e18 + uint256(frac) * 1e12;
        assertEq(renderer.formatEth(amount), string.concat(vm.toString(whole), ".", _pad6(frac)));
    }

    function testFuzz_fill_pays_the_seller_and_leaves_fees(uint96 raw) public {
        uint256 price = bound(raw, 1, 5 ether);
        uint256 fees = vault.claimableEntryFee() + vault.claimableProtocolFee() + vault.claimablePerformanceFee();
        if (nft.ownerOf(2) != buyer) {
            address holder = nft.ownerOf(2);
            vm.prank(holder);
            nft.transferFrom(holder, buyer, 2);
        }
        vm.startPrank(buyer);
        nft.approve(address(market), 2);
        uint256 id = market.list(address(nft), 2, price);
        vm.stopPrank();
        uint256 before = buyer.balance;
        vm.deal(buyer2, price);
        vm.prank(buyer2);
        market.fill{value: price}(id);
        vm.prank(buyer);
        market.withdraw();
        assertEq(buyer.balance - before, price);
        assertEq(address(market).balance, 0);
        assertEq(market.owedTotal(), 0);
        assertEq(nft.outstanding(), 2);
        assertEq(vault.claimableEntryFee() + vault.claimableProtocolFee() + vault.claimablePerformanceFee(), fees);
    }

    function testFuzz_lock_holds_for_the_selected_tier(uint8 which, uint32 early) public {
        if (nft.ownerOf(2) != buyer) {
            address holder = nft.ownerOf(2);
            vm.prank(holder);
            nft.transferFrom(holder, buyer, 2);
        }
        uint256 tier = which % 3 == 0 ? 30 : which % 3 == 1 ? 90 : 180;
        uint256 start = block.timestamp;
        vm.startPrank(buyer);
        nft.approve(address(locks), 2);
        locks.lock(address(nft), 2, tier);
        vm.stopPrank();
        (, uint64 expiry, uint64 tierDays) = locks.positions(address(nft), 2);
        assertEq(tierDays, tier);
        assertEq(expiry, start + tier * 1 days);
        uint256 jump = bound(early, 0, tier * 1 days - 1);
        vm.warp(start + jump);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSignature("TooEarly()"));
        locks.unlock(address(nft), 2);
        vm.prank(buyer);
        vm.expectRevert(FundSecondaryMarket.NotHolder.selector);
        market.list(address(nft), 2, 1);
        vm.warp(expiry);
        vm.prank(buyer);
        locks.unlock(address(nft), 2);
        assertEq(nft.ownerOf(2), buyer);
        assertEq(locks.tierOf(address(nft), 2), 0);
    }

    function testFuzz_carry_fee_matches_the_vault(uint96 mark) public {
        uint256 px = bound(mark, 0.2e18, 8e18);
        feed.setPrice(px);
        uint256 per = vault.navPerNft();
        uint256 hwm = vault.hwmPerNft();
        uint256 expected;
        if (per > hwm) {
            expected = ((per - hwm) * nft.outstanding() * vault.hwmFeeBps()) / 10_000;
            uint256 room = vault.spendableEth();
            if (expected > room) expected = room;
        }
        assertEq(vault.harvest(), expected);
        if (expected > 0) {
            vm.prank(manager);
            vault.withdrawPerformanceFee();
        }
        accrued += expected;
        assertEq(carry.claimable(address(nft)), accrued);
        assertEq(address(carry).balance, accrued);
    }

    function testFuzz_svg_stays_black_and_white(uint96 mark) public {
        uint256 snap = vm.snapshotState();
        feed.setPrice(bound(mark, 0.2e18, 8e18));
        string memory art = renderer.svg(address(nft), 2);
        assertTrue(_blackWhite(art));
        assertTrue(_has(art, "Phase5"));
        assertTrue(_has(art, "#000000"));
        assertTrue(_has(art, "#ffffff"));
        assertTrue(vm.revertToState(snap));
    }

    function testFuzz_redeem_matches_quote(uint96 wrapAmt) public {
        uint256 snap = vm.snapshotState();
        uint256 amount = bound(wrapAmt, 0.01 ether, 0.4 ether);
        uint256 fees = vault.claimableEntryFee() + vault.claimableProtocolFee() + vault.claimablePerformanceFee();
        vm.prank(manager);
        vault.swap(address(0), address(0), address(weth), amount, 1, "");
        (uint256 ethShare,,) = floor.quote(address(nft), 2);
        uint256 wethShare = floor.tokenShare(address(nft), 2, address(weth));
        vm.startPrank(buyer);
        nft.approve(address(floor), 2);
        floor.queue(address(nft), 2);
        vm.stopPrank();
        vm.warp(block.timestamp + floor.EXIT_COOLDOWN());
        uint256 ethBefore = buyer.balance;
        vm.prank(buyer);
        uint256 paid = floor.redeem(address(nft), 2);
        assertEq(paid, ethShare);
        assertEq(buyer.balance - ethBefore, ethShare);
        assertEq(weth.balanceOf(buyer), wethShare);
        assertEq(vault.claimableEntryFee() + vault.claimableProtocolFee() + vault.claimablePerformanceFee(), fees);
        assertEq(vault.tradeCount(), 2);
        assertTrue(vm.revertToState(snap));
    }

    function _pad6(uint256 frac) internal pure returns (string memory) {
        bytes memory raw = bytes(vm.toString(frac));
        bytes memory out = new bytes(6);
        uint256 pad = 6 - raw.length;
        for (uint256 i; i < 6; ++i) {
            out[i] = i < pad ? bytes1("0") : raw[i - pad];
        }
        return string(out);
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
            bool black = true;
            bool white = true;
            bytes memory zeros = bytes("000000");
            bytes memory fs = bytes("ffffff");
            for (uint256 j; j < 6; ++j) {
                if (b[i + 1 + j] != zeros[j]) black = false;
                if (b[i + 1 + j] != fs[j]) white = false;
            }
            if (!black && !white) return false;
        }
        return !_has(art, "rgb") && !_has(art, "hsl") && !_has(art, "red") && !_has(art, "blue") && !_has(art, "green");
    }
}
