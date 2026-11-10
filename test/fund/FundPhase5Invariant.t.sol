// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FundNFTPhase3} from "../../src/fund/phase3/FundNFTPhase3.sol";
import {FundVaultPhase3} from "../../src/fund/phase3/FundVaultPhase3.sol";
import {FundCarryRights} from "../../src/fund/phase5/FundCarryRights.sol";
import {FundConvictionLock} from "../../src/fund/phase5/FundConvictionLock.sol";
import {FundSecondaryMarket} from "../../src/fund/phase5/FundSecondaryMarket.sol";
import {Phase5Fixture} from "./Phase5Fixture.sol";

contract Phase5Handler is Test {
    FundSecondaryMarket public market;
    FundConvictionLock public locks;
    FundNFTPhase3 public nft;
    address public buyer;
    address public buyer2;

    constructor(
        FundSecondaryMarket nextMarket,
        FundConvictionLock nextLocks,
        FundNFTPhase3 nextNft,
        address nextBuyer,
        address nextBuyer2
    ) {
        market = nextMarket;
        locks = nextLocks;
        nft = nextNft;
        buyer = nextBuyer;
        buyer2 = nextBuyer2;
    }

    function listFill(uint96 raw) external {
        if (nft.ownerOf(2) != buyer || locks.inCustody(address(nft), 2)) return;
        if (market.activeId(address(nft), 2) != 0) return;
        uint256 price = bound(raw, 1, 1 ether);
        vm.startPrank(buyer);
        nft.approve(address(market), 2);
        uint256 id = market.list(address(nft), 2, price);
        vm.stopPrank();
        vm.deal(buyer2, price);
        vm.prank(buyer2);
        market.fill{value: price}(id);
    }

    function listOnly(uint96 raw) external {
        if (nft.ownerOf(2) != buyer || locks.inCustody(address(nft), 2)) return;
        if (market.activeId(address(nft), 2) != 0) return;
        uint256 price = bound(raw, 1, 1 ether);
        vm.prank(buyer);
        market.list(address(nft), 2, price);
    }

    function cancelOpen(uint256 id) external {
        uint256 n = market.listingCount();
        if (n == 0) return;
        id = bound(id, 1, n);
        FundSecondaryMarket.Listing memory row = market.listing(id);
        if (!row.active || row.mode != market.MODE_APPROVAL()) return;
        address owner = nft.ownerOf(row.tokenId);
        address caller = owner == row.seller ? row.seller : owner;
        vm.prank(caller);
        market.cancel(id);
    }

    function withdrawSeller() external {
        if (market.proceeds(buyer) == 0) return;
        vm.prank(buyer);
        market.withdraw();
    }

    function lockShare(uint8 which) external {
        if (nft.ownerOf(2) != buyer) return;
        uint256 tier = which % 3 == 0 ? 30 : which % 3 == 1 ? 90 : 180;
        vm.startPrank(buyer);
        nft.approve(address(locks), 2);
        locks.lock(address(nft), 2, tier);
        vm.stopPrank();
    }

    function unlockShare() external {
        (address holder, uint64 expiry,) = locks.positions(address(nft), 2);
        if (holder == address(0) || block.timestamp < expiry) return;
        vm.prank(holder);
        locks.unlock(address(nft), 2);
    }

    function warp(uint32 secondsForward) external {
        skip(bound(secondsForward, 0, 200 days));
    }
}

/// forge-config: default.invariant.runs = 32
/// forge-config: default.invariant.depth = 12
/// forge-config: ci.invariant.runs = 32
/// forge-config: ci.invariant.depth = 12
contract FundPhase5InvariantTest is Phase5Fixture {
    Phase5Handler internal handler;
    FundNFTPhase3 internal nft;
    FundVaultPhase3 internal vault;
    uint256 internal protocol;

    function setUp() public override {
        super.setUp();
        (nft, vault) = _open();
        protocol = vault.claimableProtocolFee();
        vm.prank(manager);
        vault.setPayoutWallet(address(carry));
        vm.prank(manager);
        carry.arm(address(nft));
        handler = new Phase5Handler(market, locks, nft, buyer, buyer2);
        targetContract(address(handler));
    }

    function invariant_market_is_solvent() public view {
        assertEq(address(market).balance, market.owedTotal());
    }

    function invariant_carry_is_solvent() public view {
        assertEq(address(carry).balance, carry.liability());
    }

    function invariant_locked_share_sits_in_the_lock() public view {
        if (locks.inCustody(address(nft), 2)) assertEq(nft.ownerOf(2), address(locks));
    }

    function invariant_protocol_fee_is_unchanged() public view {
        assertEq(vault.claimableProtocolFee(), protocol);
    }
}
