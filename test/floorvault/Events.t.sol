// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PolypadTokenFloorFactory as F} from "../../src/floorvault/PolypadTokenFloorFactory.sol";
import {PolypadTokenFloorCollection as C} from "../../src/floorvault/PolypadTokenFloorCollection.sol";
import {FloorVaultBase} from "./FloorVaultBase.sol";

contract EventsAndViewsTest is FloorVaultBase {
    event Minted(address indexed to, uint256 qty, uint256 paid, uint256 toEthFloor, uint256 toPending);
    event Redeemed(address indexed holder, uint256 count, uint256 ethOut, uint256 tokenOut);
    event TokenShareEnded(uint256 at);
    event TokenTransferFailed(address indexed holder, uint256 amount);
    event TokenFloorCollectionCreated(
        address indexed collection,
        address indexed creator,
        address indexed token,
        address launch,
        uint256 price,
        uint256 floorBps,
        uint256 tokenShareBps
    );

    function _one(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function test_event_created() public {
        vm.expectEmit(false, true, true, true);
        emit TokenFloorCollectionCreated(address(0), creator, address(tok), address(launch), 0.1 ether, 5000, 5000);
        _create();
    }

    function test_event_minted() public {
        C c = _create();
        vm.expectEmit(true, false, false, true, address(c));
        emit Minted(alice, 2, 0.2 ether, 0.05 ether, 0.05 ether);
        _mint(c, alice, 2);
    }

    function test_event_redeemed() public {
        C c = _create();
        _mint(c, alice, 2);
        vm.expectEmit(true, false, false, true, address(c));
        emit Redeemed(alice, 1, 0.05 ether, 0);
        vm.prank(alice);
        c.redeem(_one(0));
    }

    function test_event_tokenShareEnded() public {
        C c = _create();
        skip(180 days);
        vm.expectEmit(false, false, false, true, address(c));
        emit TokenShareEnded(block.timestamp);
        c.endTokenShare();
    }

    function test_event_transferFailed() public {
        C c = _create();
        _mint(c, alice, 1);
        _readyBuy(c);
        (, uint256 out) = c.buyToken();
        tok.setPaused(true);
        vm.expectEmit(true, false, false, true, address(c));
        emit TokenTransferFailed(alice, out);
        vm.prank(alice);
        c.redeem(_one(0));
    }

    function test_startTimeZero_meansNow() public {
        C c = _create();
        assertEq(c.startTime(), block.timestamp);
        assertEq(c.createdAt(), block.timestamp);
    }

    function test_metadataFields() public {
        C c = _create();
        assertEq(c.imageUri(), "ipfs://img");
        assertEq(c.description(), "d");
        assertEq(c.maxSupply(), 1000);
        assertEq(c.floorBps(), 5000);
        assertEq(c.tokenShareBps(), 5000);
        assertEq(c.maxSlippageBps(), 300);
        assertEq(c.maxBuyEth(), 1 ether);
        assertEq(address(c.token()), address(tok));
        assertEq(address(c.poolManager()), address(pm));
        assertEq(c.factory(), address(f));
        assertEq(c.feeSource(), address(feeSrc));
    }

    function test_defaultRoyalty_toPayout() public {
        F.Params memory p = _p();
        p.payoutWallet = bob;
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        (address r, uint256 a) = c.royaltyInfo(1, 1 ether);
        assertEq(r, bob);
        assertEq(a, 0.05 ether);
        assertEq(c.payoutWallet(), bob);
    }

    function test_walletCap_acrossMints() public {
        F.Params memory p = _p();
        p.maxPerWallet = 3;
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        _mint(c, alice, 2);
        _mint(c, alice, 1);
        assertEq(c.walletMinted(alice), 3);
        vm.prank(alice);
        vm.expectRevert(C.WalletCap.selector);
        c.mint{value: 0.1 ether}(1);
        // burning does not reset the cap
        vm.prank(alice);
        c.redeem(_one(0));
        vm.prank(alice);
        vm.expectRevert(C.WalletCap.selector);
        c.mint{value: 0.1 ether}(1);
    }

    function test_burnedSupply_notReminted() public {
        F.Params memory p = _p();
        p.maxSupply = 2;
        p.maxPerWallet = 2;
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        _mint(c, alice, 2);
        vm.prank(alice);
        c.redeem(_one(0));
        vm.prank(bob);
        vm.expectRevert(C.SoldOut.selector);
        c.mint{value: 0.1 ether}(1);
    }

    function test_redeemValue_afterBuy_matchesRedeem() public {
        C c = _create();
        _mint(c, alice, 3);
        _readyBuy(c);
        c.buyToken();
        (uint256 e, uint256 t) = c.redeemValuePerNft();
        vm.prank(alice);
        (uint256 e1, uint256 t1) = c.redeem(_one(0));
        assertEq(e1, e);
        assertEq(t1, t);
    }

    function testFuzz_lastRedeemer_getsRemainder(uint8 n) public {
        uint256 k = bound(n, 2, 37);
        C c = _create();
        _mint(c, alice, k);
        _readyBuy(c);
        c.buyToken();
        for (uint256 i; i < k - 1; i++) {
            vm.prank(alice);
            c.redeem(_one(i));
        }
        uint256 restE = c.ethFloor() + c.pendingEth();
        uint256 restT = c.tokenReserve();
        vm.prank(alice);
        (uint256 e, uint256 t) = c.redeem(_one(k - 1));
        assertEq(e, restE);
        assertEq(t, restT);
    }

    function test_allBurned_thenNewMint_fresh() public {
        C c = _create();
        _mint(c, alice, 2);
        uint256[] memory ids = new uint256[](2);
        ids[1] = 1;
        vm.prank(alice);
        c.redeem(ids);
        assertEq(c.outstanding(), 0);
        _mint(c, bob, 1);
        (uint256 e,) = c.redeemValuePerNft();
        assertEq(e, 0.05 ether);
    }

    function test_holdersOfOtherCollection_cannotRedeemHere() public {
        C a = _create();
        C b = _create();
        _mint(a, alice, 1);
        _mint(b, bob, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(C.NotOwnerOf.selector, 0));
        b.redeem(_one(0));
    }

    function test_nftTransfer_movesClaim() public {
        C c = _create();
        _mint(c, alice, 1);
        vm.prank(alice);
        c.transferFrom(alice, bob, 0);
        uint256 b0 = bob.balance;
        vm.prank(bob);
        c.redeem(_one(0));
        assertEq(bob.balance - b0, 0.05 ether);
    }

    function test_totals_trackBuys() public {
        C c = _create();
        _mint(c, alice, 10);
        _readyBuy(c);
        (uint256 ethIn, uint256 out) = c.buyToken();
        assertEq(c.totalEthSwapped(), ethIn);
        assertEq(c.totalTokensBought(), out);
        assertEq(c.lastBuyTime(), block.timestamp);
    }
}
