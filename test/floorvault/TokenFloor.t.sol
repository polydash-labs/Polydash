// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {PolypadTokenFloorFactory} from "../../src/floorvault/PolypadTokenFloorFactory.sol";
import {PolypadTokenFloorCollection as C} from "../../src/floorvault/PolypadTokenFloorCollection.sol";
import "./Mocks.sol";

import {FloorVaultBase} from "./FloorVaultBase.sol";

contract TokenFloorTest is FloorVaultBase {
    // ---------------------------------------------------------------- factory

    function test_create_ok_and_views() public {
        C c = _create();
        assertTrue(f.isCollection(address(c)));
        assertEq(f.collectionsLength(), 1);
        assertEq(f.collectionsOf(creator)[0], address(c));
        assertEq(f.collectionsOfToken(address(tok))[0], address(c));
        assertEq(c.name(), "Moon Floor");
        assertEq(c.symbol(), "MF");
        assertEq(c.launch(), address(launch));
        assertEq(c.payoutWallet(), creator);
        assertTrue(c.tokenShareActive());
        assertEq(f.launchOf(address(tok)), address(launch));
    }

    function test_create_reverts_nonCreator() public {
        vm.prank(alice);
        vm.expectRevert(PolypadTokenFloorFactory.NotCreator.selector);
        f.createCollection(_p());
    }

    function test_create_reverts_notLaunchToken() public {
        PolypadTokenFloorFactory.Params memory p = _p();
        p.token = address(new MockToken());
        vm.prank(creator);
        vm.expectRevert(PolypadTokenFloorFactory.NotLaunchToken.selector);
        f.createCollection(p);
    }

    function test_create_reverts_launchTokenMismatch() public {
        MockToken other = new MockToken();
        lfA.add(address(other), address(launch)); // launch.token() != other
        PolypadTokenFloorFactory.Params memory p = _p();
        p.token = address(other);
        vm.prank(creator);
        vm.expectRevert(PolypadTokenFloorFactory.NotLaunchToken.selector);
        f.createCollection(p);
    }

    function testFuzz_create_tokenShareBounds(uint256 bps) public {
        PolypadTokenFloorFactory.Params memory p = _p();
        p.tokenShareBps = bps;
        vm.prank(creator);
        if (bps < 1000 || bps > 5000) vm.expectRevert(PolypadTokenFloorFactory.InvalidParams.selector);
        f.createCollection(p);
    }

    function test_create_paramBounds() public {
        PolypadTokenFloorFactory.Params memory p;
        uint256 i;
        for (i = 0; i < 12; i++) {
            p = _p();
            if (i == 0) p.floorBps = 1999;
            if (i == 1) p.floorBps = 8001;
            if (i == 2) p.maxSlippageBps = 99;
            if (i == 3) p.maxSlippageBps = 1001;
            if (i == 4) p.maxBuyEth = 0.0009 ether;
            if (i == 5) p.maxBuyEth = 11 ether;
            if (i == 6) p.maxSupply = 0;
            if (i == 7) p.maxSupply = 10_001;
            if (i == 8) p.price = 1;
            if (i == 9) p.royaltyBps = 1001;
            if (i == 10) p.maxPerWallet = 1001;
            if (i == 11) p.startTime = uint64(block.timestamp + 31 days);
            vm.prank(creator);
            vm.expectRevert(PolypadTokenFloorFactory.InvalidParams.selector);
            f.createCollection(p);
        }
    }

    function test_implementation_and_clone_locked() public {
        C c = _create();
        C.Init memory init;
        vm.expectRevert(C.AlreadyInitialized.selector);
        c.initialize(init);
        C impl = C(payable(f.implementation()));
        vm.expectRevert(C.AlreadyInitialized.selector);
        impl.initialize(init);
    }

    // ---------------------------------------------------------------- mint

    function testFuzz_mint_split_conserves(uint8 n1, uint8 n2) public {
        uint256 a = bound(n1, 1, 100);
        uint256 b = bound(n2, 1, 100);
        C c = _create();
        _mint(c, alice, a);
        _mint(c, bob, b);
        uint256 paid = 0.1 ether * (a + b);
        assertEq(address(c).balance, paid);
        assertEq(_bal(c), paid);
        assertEq(c.platformBalance(), paid * 20 / 10_000);
        uint256 floor = (0.1 ether * a * 5000 / 10_000) + (0.1 ether * b * 5000 / 10_000);
        assertEq(c.ethFloor() + c.pendingEth(), floor);
        assertApproxEqAbs(c.pendingEth(), floor / 2, 2);
    }

    function test_mint_reverts() public {
        C c = _create();
        vm.prank(alice);
        vm.expectRevert(C.BadPayment.selector);
        c.mint{value: 0.05 ether}(1);
        vm.prank(alice);
        vm.expectRevert(C.SoldOut.selector);
        c.mint(0);
        vm.prank(alice);
        vm.expectRevert(C.WalletCap.selector);
        c.mint{value: 10.1 ether}(101);
    }

    function test_mint_notStarted() public {
        PolypadTokenFloorFactory.Params memory p = _p();
        p.startTime = uint64(block.timestamp + 1 days);
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        vm.prank(alice);
        vm.expectRevert(C.NotStarted.selector);
        c.mint{value: 0.1 ether}(1);
    }

    function test_mint_soldOut() public {
        PolypadTokenFloorFactory.Params memory p = _p();
        p.maxSupply = 3;
        p.maxPerWallet = 3;
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        _mint(c, alice, 3);
        vm.prank(bob);
        vm.expectRevert(C.SoldOut.selector);
        c.mint{value: 0.1 ether}(1);
    }

    // ---------------------------------------------------------------- redeem before any buy

    function test_redeem_preGraduation_paysEthIncludingPending() public {
        C c = _create();
        _mint(c, alice, 4);
        uint256[] memory ids = new uint256[](1);
        uint256 before = alice.balance;
        vm.prank(alice);
        (uint256 e, uint256 t) = c.redeem(ids);
        assertEq(e, 0.05 ether);
        assertEq(t, 0);
        assertEq(alice.balance - before, 0.05 ether);
        assertEq(c.outstanding(), 3);
    }

    function test_redeem_notOwner_and_empty() public {
        C c = _create();
        _mint(c, alice, 1);
        uint256[] memory ids = new uint256[](1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(C.NotOwnerOf.selector, 0));
        c.redeem(ids);
        vm.prank(alice);
        vm.expectRevert(C.Nothing.selector);
        c.redeem(new uint256[](0));
    }

    // ---------------------------------------------------------------- buys

    function test_buy_reverts_notGraduated() public {
        C c = _create();
        _mint(c, alice, 10);
        vm.expectRevert(C.NotGraduated.selector);
        c.observePrice();
        vm.expectRevert(C.NotGraduated.selector);
        c.buyToken();
    }

    function test_buy_requires_aged_observation() public {
        C c = _create();
        _mint(c, alice, 10);
        launch.setGraduated(true);
        vm.expectRevert(C.NoFreshObservation.selector);
        c.buyToken();
        c.observePrice();
        vm.expectRevert(C.NoFreshObservation.selector);
        c.buyToken();
        skip(61 minutes);
        vm.expectRevert(C.NoFreshObservation.selector);
        c.buyToken();
    }

    function test_observe_notDue() public {
        C c = _create();
        launch.setGraduated(true);
        c.observePrice();
        vm.expectRevert(C.ObservationNotDue.selector);
        c.observePrice();
        skip(61 minutes);
        c.observePrice();
    }

    function test_buy_success_and_accounting() public {
        C c = _create();
        _mint(c, alice, 10); // floor 0.5, pending 0.25
        _readyBuy(c);
        (uint256 ethIn, uint256 out) = c.buyToken();
        assertEq(ethIn, 0.25 ether);
        assertGt(out, 240e18); // ~1000/ETH minus 0.3% fee
        assertEq(c.pendingEth(), 0);
        assertEq(c.tokenReserve(), out);
        assertEq(tok.balanceOf(address(c)), out);
        assertEq(address(c).balance, 1 ether - 0.25 ether);
        assertEq(c.obsTime(), 0);
    }

    function test_buy_nothingPending() public {
        C c = _create();
        _readyBuy(c);
        vm.expectRevert(C.NothingPending.selector);
        c.buyToken();
    }

    function test_buy_capped_and_cooldown() public {
        C c = _create();
        _mint(c, alice, 100); // pending 2.5 ETH, cap 1 ETH
        _readyBuy(c);
        (uint256 ethIn,) = c.buyToken();
        assertEq(ethIn, 1 ether);
        assertEq(c.pendingEth(), 1.5 ether);
        skip(61 minutes); // need new observation; cooldown passed
        c.observePrice();
        vm.expectRevert(C.NoFreshObservation.selector);
        c.buyToken();
        skip(6 minutes);
        (ethIn,) = c.buyToken();
        assertEq(ethIn, 1 ether);
    }

    function test_buy_cooldown_enforced() public {
        C c = _create();
        _mint(c, alice, 100);
        _readyBuy(c);
        c.buyToken();
        // observation was cleared, so a fresh observe is allowed immediately (obsTime == 0)
        c.observePrice();
        skip(5 minutes);
        vm.expectRevert(C.Cooldown.selector);
        c.buyToken();
        skip(5 minutes);
        c.buyToken();
    }

    function _movePrice(uint256 ethIn) internal {
        sw.swap{value: ethIn}(
            key,
            IPoolManager.SwapParams(true, -int256(ethIn), TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
    }

    function test_buy_reverts_ifPriceMovedSinceObservation() public {
        C c = _create();
        _mint(c, alice, 10);
        _readyBuy(c);
        _movePrice(10 ether); // creator/whale buys the token after the observation
        vm.expectRevert(C.PriceMoved.selector);
        c.buyToken();
    }

    function test_buy_smallMove_within_deviation_ok() public {
        C c = _create();
        _mint(c, alice, 10);
        _readyBuy(c);
        _movePrice(2 ether); // ~1.3% price move, inside the 2% band
        (uint256 ethIn,) = c.buyToken();
        assertEq(ethIn, 0.25 ether);
    }

    function test_buy_slippage_priceLimit_partialFill_or_revert() public {
        // tight slippage + large buy against thin liquidity -> stops at limit or reverts, never overpays
        PolypadTokenFloorFactory.Params memory p = _p();
        p.maxSlippageBps = 100;
        p.maxBuyEth = 10 ether;
        p.price = 10 ether;
        p.maxSupply = 10;
        p.maxPerWallet = 10;
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        _mint(c, alice, 10); // pending 25 ETH
        _readyBuy(c);
        try c.buyToken() returns (uint256 ethIn, uint256 out) {
            assertLt(ethIn, 10 ether);
            assertGe(out, c.minTokensOut(ethIn, c.obsSqrtPriceX96() == 0 ? uint160(0) : c.obsSqrtPriceX96()));
        } catch (bytes memory err) {
            assertEq(bytes4(err), C.Slippage.selector);
        }
    }

    function test_unlockCallback_onlyPoolManager() public {
        C c = _create();
        vm.expectRevert(C.NotPoolManager.selector);
        c.unlockCallback("");
    }

    function test_receive_rejects() public {
        C c = _create();
        vm.prank(alice);
        (bool ok,) = address(c).call{value: 1}("");
        assertFalse(ok);
    }

    // ---------------------------------------------------------------- redeem after buy

    function test_redeem_paysEthAndToken_proRata() public {
        C c = _create();
        _mint(c, alice, 5);
        _mint(c, bob, 5);
        _readyBuy(c);
        (, uint256 out) = c.buyToken();
        (uint256 ePer, uint256 tPer) = c.redeemValuePerNft();
        assertEq(ePer, 0.025 ether);
        assertEq(tPer, out / 10);
        uint256[] memory ids = new uint256[](5);
        for (uint256 i; i < 5; i++) {
            ids[i] = i;
        }
        vm.prank(alice);
        (uint256 e, uint256 t) = c.redeem(ids);
        assertEq(e, 0.125 ether);
        assertEq(t, out / 2);
        assertEq(tok.balanceOf(alice), out / 2);
    }

    function testFuzz_redeem_allOut_conserves(uint8 a, uint8 b, bool buy) public {
        uint256 na = bound(a, 1, 50);
        uint256 nb = bound(b, 1, 50);
        C c = _create();
        _mint(c, alice, na);
        _mint(c, bob, nb);
        if (buy) {
            _readyBuy(c);
            c.buyToken();
        }
        uint256 vaultEth = c.ethFloor() + c.pendingEth();
        uint256 vaultTok = c.tokenReserve();
        uint256[] memory ia = new uint256[](na);
        for (uint256 i; i < na; i++) {
            ia[i] = i;
        }
        uint256[] memory ib = new uint256[](nb);
        for (uint256 i; i < nb; i++) {
            ib[i] = na + i;
        }
        vm.prank(alice);
        (uint256 e1, uint256 t1) = c.redeem(ia);
        vm.prank(bob);
        (uint256 e2, uint256 t2) = c.redeem(ib);
        assertEq(e1 + e2, vaultEth);
        assertEq(t1 + t2, vaultTok);
        assertEq(c.ethFloor() + c.pendingEth() + c.tokenReserve(), 0);
        assertEq(address(c).balance, c.creatorBalance() + c.platformBalance());
        assertApproxEqAbs(e1 * nb, e2 * na, na + nb);
    }

    function test_redeem_tokenPaused_creditsOwed_thenClaim() public {
        C c = _create();
        _mint(c, alice, 2);
        _readyBuy(c);
        (, uint256 out) = c.buyToken();
        tok.setPaused(true);
        uint256[] memory ids = new uint256[](1);
        vm.prank(alice);
        (uint256 e,) = c.redeem(ids); // ETH still paid
        assertGt(e, 0);
        assertEq(c.tokenOwed(alice), out / 2);
        vm.prank(alice);
        vm.expectRevert(C.TransferFailed.selector);
        c.claimOwedToken();
        tok.setPaused(false);
        vm.prank(alice);
        c.claimOwedToken();
        assertEq(tok.balanceOf(alice), out / 2);
        vm.prank(alice);
        vm.expectRevert(C.Nothing.selector);
        c.claimOwedToken();
    }

    // ---------------------------------------------------------------- end token share

    function test_endTokenShare() public {
        C c = _create();
        _mint(c, alice, 10);
        vm.expectRevert(C.TooEarly.selector);
        c.endTokenShare();
        skip(180 days);
        c.endTokenShare();
        assertFalse(c.tokenShareActive());
        assertEq(c.pendingEth(), 0);
        assertEq(c.ethFloor(), 0.5 ether);
        _mint(c, bob, 2);
        assertEq(c.ethFloor(), 0.6 ether);
        assertEq(c.pendingEth(), 0);
        vm.expectRevert(C.Inactive.selector);
        c.endTokenShare();
    }

    function test_endTokenShare_blockedAfterGraduation() public {
        C c = _create();
        launch.setGraduated(true);
        skip(200 days);
        vm.expectRevert(C.TooEarly.selector);
        c.endTokenShare();
    }

    // ---------------------------------------------------------------- proceeds / admin

    function test_withdrawals() public {
        C c = _create();
        _mint(c, alice, 10);
        uint256 cb = c.creatorBalance();
        uint256 pb = c.platformBalance();
        c.withdrawCreator();
        c.withdrawPlatform();
        assertEq(creator.balance, cb);
        assertEq(feeWallet.balance, pb);
        vm.expectRevert(C.Nothing.selector);
        c.withdrawCreator();
        vm.expectRevert(C.Nothing.selector);
        c.withdrawPlatform();
        assertEq(address(c).balance, c.ethFloor() + c.pendingEth());
    }

    function test_creatorCannotTouchVault() public {
        C c = _create();
        _mint(c, alice, 10);
        c.withdrawCreator();
        assertEq(address(c).balance, 0.5 ether + c.platformBalance());
    }

    function test_setPayout_and_royalty() public {
        C c = _create();
        vm.prank(alice);
        vm.expectRevert(C.NotCreator.selector);
        c.setPayoutWallet(alice);
        vm.prank(creator);
        vm.expectRevert(C.ZeroAddress.selector);
        c.setPayoutWallet(address(0));
        vm.prank(creator);
        c.setPayoutWallet(bob);
        (address r, uint256 amt) = c.royaltyInfo(0, 10_000);
        assertEq(r, bob);
        assertEq(amt, 500);
    }

    function test_baseURI_frozenAfterMint_and_tokenURI() public {
        C c = _create();
        vm.prank(creator);
        c.setBaseURI("ipfs://new/");
        vm.prank(alice);
        vm.expectRevert(C.NotCreator.selector);
        c.setBaseURI("x");
        _mint(c, alice, 1);
        assertEq(c.tokenURI(0), "ipfs://new/0.json");
        vm.prank(creator);
        vm.expectRevert(C.Frozen.selector);
        c.setBaseURI("ipfs://z/");
    }

    function test_withdrawCreator_rejectingPayout_reverts() public {
        Rejector rj = new Rejector();
        PolypadTokenFloorFactory.Params memory p = _p();
        p.payoutWallet = address(rj);
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        _mint(c, alice, 1);
        vm.expectRevert(C.TransferFailed.selector);
        c.withdrawCreator();
    }

    function testFuzz_minTokensOut_matchesSpot(uint96 eth) public {
        C c = _create();
        vm.assume(eth > 1e9);
        uint160 s = TickMath.getSqrtPriceAtTick(69_060);
        uint256 q = c.minTokensOut(uint256(eth), s);
        uint256 spotQ = uint256(eth) * uint256(s) / (1 << 96) * uint256(s) / (1 << 96);
        assertApproxEqRel(q, spotQ * 9700 / 10_000, 0.000001e18);
        assertApproxEqRel(spotQ, uint256(eth) * 1000, 0.003e18);
    }
}
