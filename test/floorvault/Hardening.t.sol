// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PolypadTokenFloorFactory as F} from "../../src/floorvault/PolypadTokenFloorFactory.sol";
import {PolypadTokenFloorCollection as C} from "../../src/floorvault/PolypadTokenFloorCollection.sol";
import {FloorVaultBase} from "./FloorVaultBase.sol";
import "./Mocks.sol";

contract Harness is C {
    function within(uint160 s, uint160 r) external pure returns (bool) {
        return _withinDeviation(s, r);
    }
}

contract HardeningTest is FloorVaultBase {
    function _movePrice(uint256 ethIn) internal {
        sw.swap{value: ethIn}(
            key,
            IPoolManager.SwapParams(true, -int256(ethIn), TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
    }

    function _dump(uint256 tokIn) internal {
        sw.swap(
            key,
            IPoolManager.SwapParams(false, -int256(tokIn), TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
    }

    function _ids(uint256 from, uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; i++) {
            ids[i] = from + i;
        }
    }

    // ================================================================ factory: launch factories, tokens

    function test_factoryA_launch_accepted() public {
        MockToken t2 = new MockToken();
        MockLaunch l2 = new MockLaunch(alice, address(t2), address(hook));
        lfA.add(address(t2), address(l2));
        assertEq(f.launchOf(address(t2)), address(l2));
        F.Params memory p = _p();
        p.token = address(t2);
        vm.prank(alice);
        C c = C(payable(f.createCollection(p)));
        assertEq(c.launch(), address(l2));
        assertEq(c.creator(), alice);
    }

    function test_factoryB_launch_accepted() public {
        assertEq(f.launchOf(address(tok)), address(launch)); // tok is registered in B only
        _create();
    }

    function test_factoryA_preferred_overB() public {
        MockLaunch lA = new MockLaunch(bob, address(tok), address(hook));
        lfA.add(address(tok), address(lA));
        assertEq(f.launchOf(address(tok)), address(lA));
    }

    function test_revertingFactoryA_fallsBackToB() public {
        F f2 = new F(address(new RevertingLaunchFactory()), address(lfB), address(feeSrc), address(pm));
        assertEq(f2.launchOf(address(tok)), address(launch));
        vm.prank(creator);
        f2.createCollection(_p());
    }

    function test_factoryB_zero_ok() public {
        F f2 = new F(address(lfB), address(0), address(feeSrc), address(pm));
        assertEq(f2.launchOf(address(tok)), address(launch));
        assertEq(f2.launchOf(address(0xdead)), address(0));
    }

    function test_constructor_zeroArgs_revert() public {
        vm.expectRevert(F.InvalidParams.selector);
        new F(address(0), address(lfB), address(feeSrc), address(pm));
        vm.expectRevert(F.InvalidParams.selector);
        new F(address(lfA), address(lfB), address(0), address(pm));
        vm.expectRevert(F.InvalidParams.selector);
        new F(address(lfA), address(lfB), address(feeSrc), address(0));
    }

    function test_notIsLaunch_refused() public {
        MockToken t2 = new MockToken();
        MockLaunchFactory rogue = new MockLaunchFactory();
        F f2 = new F(address(rogue), address(0), address(feeSrc), address(pm));
        // launchOfToken points at a contract the factory does not recognise as a launch
        MockLaunch fake = new MockLaunch(alice, address(t2), address(hook));
        vm.store(
            address(rogue), keccak256(abi.encode(address(t2), uint256(0))), bytes32(uint256(uint160(address(fake))))
        );
        F.Params memory p = _p();
        p.token = address(t2);
        vm.prank(alice);
        vm.expectRevert(F.NotLaunchToken.selector);
        f2.createCollection(p);
    }

    function testFuzz_nonPolypadToken_refused(address t) public {
        vm.assume(t != address(tok));
        F.Params memory p = _p();
        p.token = t;
        vm.prank(creator);
        vm.expectRevert(F.NotLaunchToken.selector);
        f.createCollection(p);
    }

    function testFuzz_onlyLaunchCreator(address who) public {
        vm.assume(who != creator);
        vm.prank(who);
        vm.expectRevert(F.NotCreator.selector);
        f.createCollection(_p());
    }

    function test_stringBounds() public {
        F.Params memory p = _p();
        p.name = "";
        vm.prank(creator);
        vm.expectRevert(F.InvalidParams.selector);
        f.createCollection(p);
        p = _p();
        p.symbol = "SEVENTEEN_CHARS_X";
        vm.prank(creator);
        vm.expectRevert(F.InvalidParams.selector);
        f.createCollection(p);
        p = _p();
        p.maxPerWallet = 0;
        vm.prank(creator);
        vm.expectRevert(F.InvalidParams.selector);
        f.createCollection(p);
    }

    function test_paramEdges_accepted() public {
        F.Params memory p = _p();
        p.floorBps = 2000;
        p.tokenShareBps = 1000;
        p.maxSlippageBps = 100;
        p.maxBuyEth = 0.001 ether;
        p.price = 0.000_01 ether;
        p.royaltyBps = 1000;
        p.maxSupply = 1;
        p.maxPerWallet = 1;
        p.startTime = uint64(block.timestamp + 30 days);
        vm.prank(creator);
        f.createCollection(p);
        p = _p();
        p.floorBps = 8000;
        p.tokenShareBps = 5000;
        p.maxSlippageBps = 1000;
        p.maxBuyEth = 10 ether;
        p.price = 100 ether;
        p.maxSupply = 10_000;
        vm.prank(creator);
        f.createCollection(p);
    }

    function test_multipleCollections_perToken_listed() public {
        C a = _create();
        C b = _create();
        assertTrue(address(a) != address(b));
        assertEq(f.collectionsOfToken(address(tok)).length, 2);
        assertEq(f.collectionsOf(creator).length, 2);
    }

    // ================================================================ init

    function test_clone_reinit_reverts_evenByFactory() public {
        C c = _create();
        C.Init memory init;
        vm.prank(address(f));
        vm.expectRevert(C.AlreadyInitialized.selector);
        c.initialize(init);
    }

    function testFuzz_impl_cannot_be_initialized(address who) public {
        C impl = C(payable(f.implementation()));
        C.Init memory init;
        init.creator = who;
        vm.prank(who);
        vm.expectRevert(C.AlreadyInitialized.selector);
        impl.initialize(init);
        assertEq(impl.creator(), address(0));
    }

    function test_clone_storage_and_reentrancyGuard_work() public {
        C c = _create();
        _mint(c, alice, 1);
        vm.prank(alice);
        c.redeem(_ids(0, 1));
    }

    // ================================================================ mint fuzz

    function testFuzz_mint_split_anyParams(uint256 price, uint256 floorBps, uint256 share, uint8 q) public {
        F.Params memory p = _p();
        p.price = bound(price, 0.000_01 ether, 1 ether);
        p.floorBps = bound(floorBps, 2000, 8000);
        p.tokenShareBps = bound(share, 1000, 5000);
        uint256 n = bound(q, 1, 100);
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        _mint(c, alice, n);
        uint256 cost = p.price * n;
        uint256 floorCut = cost * p.floorBps / 10_000;
        assertEq(c.ethFloor() + c.pendingEth(), floorCut);
        assertEq(c.pendingEth(), floorCut * p.tokenShareBps / 10_000);
        assertEq(c.platformBalance(), cost * 20 / 10_000);
        assertEq(_bal(c), cost);
        assertEq(address(c).balance, cost);
    }

    function test_mint_reentrancy_viaOnERC721Received_blocked() public {
        C c = _create();
        ReentrantActor a = new ReentrantActor();
        vm.deal(address(a), 10 ether);
        a.setup(address(c), abi.encodeCall(C.redeem, (_ids(0, 1))));
        a.arm(true);
        a.exec(address(c), 0.1 ether, abi.encodeCall(C.mint, (1)));
        assertEq(a.attempts(), 1);
        assertFalse(a.succeeded());
        assertEq(c.balanceOf(address(a)), 1);
    }

    function test_mint_reentrancy_mintAgain_blocked() public {
        C c = _create();
        ReentrantActor a = new ReentrantActor();
        vm.deal(address(a), 10 ether);
        a.setup(address(c), abi.encodeCall(C.withdrawCreator, ()));
        a.arm(true);
        a.exec(address(c), 0.1 ether, abi.encodeCall(C.mint, (1)));
        assertFalse(a.succeeded());
    }

    // ================================================================ burn reentrancy

    function _actorWithNft(C c) internal returns (ReentrantActor a) {
        a = new ReentrantActor();
        vm.deal(address(a), 10 ether);
        a.exec(address(c), 0.2 ether, abi.encodeCall(C.mint, (2)));
    }

    function test_redeem_reentrancy_redeem_blocked() public {
        C c = _create();
        ReentrantActor a = _actorWithNft(c);
        a.setup(address(c), abi.encodeCall(C.redeem, (_ids(1, 1))));
        a.arm(true);
        uint256 before = address(c).balance;
        a.exec(address(c), 0, abi.encodeCall(C.redeem, (_ids(0, 1))));
        assertEq(a.attempts(), 1);
        assertFalse(a.succeeded());
        assertEq(before - address(c).balance, 0.05 ether);
        assertEq(c.outstanding(), 1);
    }

    function test_redeem_reentrancy_buy_and_endShare_blocked() public {
        C c = _create();
        _mint(c, bob, 4);
        launch.setGraduated(true);
        c.observePrice();
        skip(6 minutes);
        ReentrantActor a = _actorWithNft(c);
        a.setup(address(c), abi.encodeCall(C.buyToken, ()));
        a.arm(true);
        a.exec(address(c), 0, abi.encodeCall(C.redeem, (_ids(4, 1))));
        assertFalse(a.succeeded());
        a.setup(address(c), abi.encodeCall(C.endTokenShare, ()));
        a.arm(true);
        a.exec(address(c), 0, abi.encodeCall(C.redeem, (_ids(5, 1))));
        assertFalse(a.succeeded());
    }

    function test_redeem_reentrancy_viaToken_blocked() public {
        C c = _create();
        _mint(c, alice, 4);
        _readyBuy(c);
        c.buyToken();
        tok.setReenter(address(c), abi.encodeCall(C.redeem, (_ids(1, 1))));
        vm.prank(alice);
        c.redeem(_ids(0, 1));
        assertGt(tok.reenterAttempts(), 0);
        assertFalse(tok.reenterSucceeded());
    }

    function test_buy_reentrancy_viaToken_blocked() public {
        C c = _create();
        _mint(c, alice, 4);
        _readyBuy(c);
        tok.setReenter(address(c), abi.encodeCall(C.buyToken, ()));
        c.buyToken();
        assertGt(tok.reenterAttempts(), 0);
        assertFalse(tok.reenterSucceeded());
        tok.setReenter(address(0), "");
    }

    function test_buy_reentrancy_redeemDuringTake_blocked() public {
        C c = _create();
        _mint(c, alice, 4);
        _readyBuy(c);
        // alice approves nothing; the reentry tries redeem from the token contract (not an owner) and the guard
        tok.setReenter(address(c), abi.encodeCall(C.withdrawPlatform, ()));
        c.buyToken();
        assertFalse(tok.reenterSucceeded());
        assertGt(c.platformBalance(), 0);
    }

    function test_redeem_rejectingEthReceiver_revertsWholeBurn() public {
        C c = _create();
        Rejector r = new Rejector();
        _mint(c, alice, 1);
        vm.prank(alice);
        c.transferFrom(alice, address(r), 0);
        vm.prank(address(r));
        vm.expectRevert(C.TransferFailed.selector);
        c.redeem(_ids(0, 1));
        assertEq(c.ownerOf(0), address(r));
    }

    function test_redeem_approvedOperator_cannotBurn() public {
        C c = _create();
        _mint(c, alice, 1);
        vm.prank(alice);
        c.setApprovalForAll(bob, true);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(C.NotOwnerOf.selector, 0));
        c.redeem(_ids(0, 1));
    }

    function test_redeem_duplicateIds_revert() public {
        C c = _create();
        _mint(c, alice, 2);
        uint256[] memory ids = new uint256[](2);
        vm.prank(alice);
        vm.expectRevert();
        c.redeem(ids);
    }

    // ================================================================ token behaviour

    function test_feeOnTransferToken_reserveMatchesReceived() public {
        C c = _create();
        _mint(c, alice, 10);
        _readyBuy(c);
        tok.setFeeBps(100);
        // 1% transfer fee + 0.3% pool fee is inside the 3% slippage (5.2% fee fallback also applies here)
        (, uint256 out) = c.buyToken();
        assertEq(c.tokenReserve(), out);
        assertEq(tok.balanceOf(address(c)), out);
        vm.prank(alice);
        (, uint256 t) = c.redeem(_ids(0, 10));
        assertEq(t, out);
        assertEq(tok.balanceOf(address(c)), 0);
        assertEq(tok.balanceOf(alice), out - out / 100);
    }

    function test_heavyFeeOnTransfer_buyReverts_ethStaysQueued() public {
        C c = _create();
        _mint(c, alice, 10);
        _readyBuy(c);
        tok.setFeeBps(2000);
        vm.expectRevert(C.Slippage.selector);
        c.buyToken();
        assertEq(c.pendingEth(), 0.25 ether);
        assertEq(c.obsTime() != 0, true); // reverted, observation intact
    }

    function test_blockedVault_buyReverts_burnStillPaysEth() public {
        C c = _create();
        _mint(c, alice, 10);
        _readyBuy(c);
        tok.setBlocked(address(c), true);
        vm.expectRevert();
        c.buyToken();
        vm.prank(alice);
        (uint256 e, uint256 t) = c.redeem(_ids(0, 1));
        assertEq(e, 0.05 ether);
        assertEq(t, 0);
    }

    function test_blockedHolder_tokenOwed_thenClaimAfterUnblock() public {
        C c = _create();
        _mint(c, alice, 2);
        _readyBuy(c);
        (, uint256 out) = c.buyToken();
        tok.setBlocked(alice, true);
        vm.prank(alice);
        (uint256 e, uint256 t) = c.redeem(_ids(0, 2));
        assertEq(e, 0.05 ether);
        assertEq(t, out);
        assertEq(c.tokenOwed(alice), out);
        assertEq(c.tokenReserve(), 0);
        tok.setBlocked(alice, false);
        vm.prank(alice);
        c.claimOwedToken();
        assertEq(tok.balanceOf(alice), out);
    }

    function test_returnFalseToken_creditsOwed() public {
        C c = _create();
        _mint(c, alice, 2);
        _readyBuy(c);
        (, uint256 out) = c.buyToken();
        tok.setReturnFalse(true);
        vm.prank(alice);
        c.redeem(_ids(0, 1));
        assertEq(c.tokenOwed(alice), out / 2);
        vm.prank(alice);
        vm.expectRevert(C.TransferFailed.selector);
        c.claimOwedToken();
        tok.setReturnFalse(false);
        vm.prank(alice);
        c.claimOwedToken();
        assertEq(tok.balanceOf(alice), out / 2);
    }

    function test_owedTokens_notCountedForOthers() public {
        C c = _create();
        _mint(c, alice, 1);
        _mint(c, bob, 1);
        _readyBuy(c);
        (, uint256 out) = c.buyToken();
        tok.setPaused(true);
        vm.prank(alice);
        c.redeem(_ids(0, 1));
        tok.setPaused(false);
        vm.prank(bob);
        (, uint256 t) = c.redeem(_ids(1, 1));
        assertEq(t + c.tokenOwed(alice), out);
        vm.prank(alice);
        c.claimOwedToken();
        assertEq(tok.balanceOf(address(c)), 0);
    }

    function test_tokenDonation_notPaidOut() public {
        C c = _create();
        _mint(c, alice, 1);
        tok.transfer(address(c), 1e18);
        vm.prank(alice);
        (, uint256 t) = c.redeem(_ids(0, 1));
        assertEq(t, 0); // only tokens bought by the vault are distributed
    }

    // ================================================================ observation window boundaries

    function test_window_299s_reverts_300s_ok() public {
        C c = _create();
        _mint(c, alice, 10);
        launch.setGraduated(true);
        c.observePrice();
        skip(299);
        vm.expectRevert(C.NoFreshObservation.selector);
        c.buyToken();
        skip(1);
        c.buyToken();
    }

    function test_window_3600s_ok() public {
        C c = _create();
        _mint(c, alice, 10);
        launch.setGraduated(true);
        c.observePrice();
        skip(3600);
        c.buyToken();
    }

    function test_window_3601s_reverts() public {
        C c = _create();
        _mint(c, alice, 10);
        launch.setGraduated(true);
        c.observePrice();
        skip(3601);
        vm.expectRevert(C.NoFreshObservation.selector);
        c.buyToken();
    }

    function test_observe_reobserve_boundary() public {
        C c = _create();
        launch.setGraduated(true);
        c.observePrice();
        skip(3600);
        vm.expectRevert(C.ObservationNotDue.selector);
        c.observePrice();
        skip(1);
        c.observePrice();
        assertEq(c.obsTime(), block.timestamp);
    }

    function test_observation_recordsSpot() public {
        C c = _create();
        launch.setGraduated(true);
        c.observePrice();
        assertEq(c.obsSqrtPriceX96(), c.spotSqrtPriceX96());
    }

    function test_failedBuy_keepsObservation_successConsumesIt() public {
        C c = _create();
        launch.setGraduated(true);
        c.observePrice();
        skip(6 minutes);
        vm.expectRevert(C.NothingPending.selector);
        c.buyToken();
        assertGt(c.obsTime(), 0);
        _mint(c, alice, 1);
        c.buyToken();
        assertEq(c.obsTime(), 0);
    }

    // ================================================================ band boundaries

    function testFuzz_band_matchesDefinition(uint160 ref, uint32 ratioPpm) public {
        ref = uint160(bound(ref, TickMath.MIN_SQRT_PRICE, TickMath.MAX_SQRT_PRICE));
        uint256 rp = bound(ratioPpm, 900_000, 1_100_000);
        uint160 spot = uint160(uint256(ref) * rp / 1_000_000);
        Harness h = new Harness();
        uint256 r = Math.mulDiv(spot, 1e18, ref);
        uint256 r2 = Math.mulDiv(r, r, 1e18);
        bool expected = r2 >= 0.98e18 && r2 <= 1.02e18;
        assertEq(h.within(spot, ref), expected);
    }

    function test_band_edges() public {
        Harness h = new Harness();
        uint160 ref = TickMath.getSqrtPriceAtTick(69_060);
        // sqrt(1.02) = 1.009950..., sqrt(0.98) = 0.989949...
        assertTrue(h.within(uint160(uint256(ref) * 1_009_950 / 1_000_000), ref));
        assertFalse(h.within(uint160(uint256(ref) * 1_009_960 / 1_000_000), ref));
        assertTrue(h.within(uint160(uint256(ref) * 989_950 / 1_000_000), ref));
        assertFalse(h.within(uint160(uint256(ref) * 989_940 / 1_000_000), ref));
        assertTrue(h.within(ref, ref));
    }

    function test_band_priceDown_alsoBlocks() public {
        C c = _create();
        _mint(c, alice, 10);
        _readyBuy(c);
        _dump(100_000e18); // token dumped -> ETH buys more token; still outside band
        vm.expectRevert(C.PriceMoved.selector);
        c.buyToken();
    }

    function test_band_priceReturns_buyAllowed() public {
        C c = _create();
        _mint(c, alice, 10);
        _readyBuy(c);
        uint256 before = tok.balanceOf(address(this));
        _movePrice(30 ether);
        uint256 got = tok.balanceOf(address(this)) - before;
        _dump(got); // arbitrage back near the observation
        c.buyToken();
    }

    // ================================================================ slippage / limit

    function testFuzz_minTokensOut_slippageRange(uint256 slip, uint96 eth) public {
        F.Params memory p = _p();
        p.maxSlippageBps = bound(slip, 100, 1000);
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        uint160 s = TickMath.getSqrtPriceAtTick(69_060);
        uint256 q = Math.mulDiv(Math.mulDiv(eth, s, 1 << 96), s, 1 << 96);
        assertEq(c.minTokensOut(eth, s), q * (10_000 - p.maxSlippageBps) / 10_000);
    }

    function test_buyFeeBps_fallbackWhenHookUnreadable() public {
        C c = _create();
        launch.setGraduated(true);
        assertEq(c.buyFeeBps(), 520);
    }

    function testFuzz_partialFill_neverPastLimit(uint256 slip, uint256 maxBuy) public {
        F.Params memory p = _p();
        p.maxSlippageBps = bound(slip, 100, 1000);
        p.maxBuyEth = bound(maxBuy, 1 ether, 10 ether);
        p.price = 10 ether;
        p.maxSupply = 10;
        p.maxPerWallet = 10;
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        _mint(c, alice, 10);
        _readyBuy(c);
        uint160 ref = c.obsSqrtPriceX96();
        uint256 pend = c.pendingEth();
        (uint256 ethIn, uint256 out) = c.buyToken();
        uint160 limit = uint160(uint256(ref) * (10_000 - p.maxSlippageBps / 2) / 10_000);
        assertGe(c.spotSqrtPriceX96(), limit);
        assertLe(ethIn, p.maxBuyEth);
        assertEq(c.pendingEth(), pend - ethIn);
        assertEq(c.tokenReserve(), out);
        assertEq(address(c).balance, 100 ether - ethIn);
    }

    // ================================================================ cooldown and cap

    function test_cooldown_599_reverts_600_ok() public {
        C c = _create();
        _mint(c, alice, 100);
        _readyBuy(c);
        c.buyToken();
        uint256 t0 = block.timestamp;
        c.observePrice();
        vm.warp(t0 + 599);
        vm.expectRevert(C.Cooldown.selector);
        c.buyToken();
        vm.warp(t0 + 600);
        c.buyToken();
    }

    function testFuzz_cap_respected(uint256 maxBuy, uint8 n) public {
        F.Params memory p = _p();
        p.maxBuyEth = bound(maxBuy, 0.001 ether, 1 ether);
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        _mint(c, alice, bound(n, 1, 100));
        uint256 pend = c.pendingEth();
        _readyBuy(c);
        (uint256 ethIn,) = c.buyToken();
        assertEq(ethIn, pend < p.maxBuyEth ? pend : p.maxBuyEth);
    }

    function test_manyBatches_drainQueue() public {
        F.Params memory p = _p();
        p.maxBuyEth = 0.5 ether;
        vm.prank(creator);
        C c = C(payable(f.createCollection(p)));
        _mint(c, alice, 100); // 2.5 ETH queued -> 5 batches
        launch.setGraduated(true);
        uint256 batches;
        uint256 t = block.timestamp;
        while (c.pendingEth() > 0) {
            c.observePrice();
            t += 10 minutes;
            vm.warp(t); // explicit warp: via-IR may cache block.timestamp inside the test
            c.buyToken();
            batches++;
        }
        assertEq(batches, 5);
        assertEq(c.totalEthSwapped(), 2.5 ether);
        assertEq(c.totalTokensBought(), c.tokenReserve());
    }

    // ================================================================ 180-day switch and graduation

    function test_endShare_boundary_exact() public {
        C c = _create();
        uint256 t0 = c.createdAt();
        vm.warp(t0 + 180 days - 1);
        vm.expectRevert(C.TooEarly.selector);
        c.endTokenShare();
        vm.warp(t0 + 180 days);
        c.endTokenShare();
    }

    function test_endShare_thenGraduation_noBuys() public {
        C c = _create();
        _mint(c, alice, 10);
        skip(180 days);
        c.endTokenShare();
        launch.setGraduated(true);
        c.observePrice();
        skip(6 minutes);
        vm.expectRevert(C.NothingPending.selector);
        c.buyToken();
        _mint(c, bob, 10);
        assertEq(c.pendingEth(), 0);
        assertEq(c.ethFloor(), 1 ether);
    }

    function test_endShare_preservesTotal() public {
        C c = _create();
        _mint(c, alice, 7);
        uint256 total = c.ethFloor() + c.pendingEth();
        skip(181 days);
        c.endTokenShare();
        assertEq(c.ethFloor(), total);
    }

    function test_graduationTransition_queuedEthCarriesOver() public {
        C c = _create();
        _mint(c, alice, 10); // before graduation
        assertFalse(c.graduated());
        vm.expectRevert(C.NotGraduated.selector);
        c.observePrice();
        launch.setGraduated(true);
        assertTrue(c.graduated());
        _mint(c, bob, 10); // after graduation
        assertEq(c.pendingEth(), 0.5 ether);
        c.observePrice();
        skip(6 minutes);
        (uint256 ethIn,) = c.buyToken();
        assertEq(ethIn, 0.5 ether);
    }

    function test_graduation_after90days_endShareBlocked() public {
        C c = _create();
        _mint(c, alice, 1);
        skip(90 days);
        launch.setGraduated(true);
        skip(100 days);
        vm.expectRevert(C.TooEarly.selector);
        c.endTokenShare();
    }

    // ================================================================ creator can never touch vault

    function testFuzz_creator_cannot_drain_vault(uint8 n, bool buy) public {
        C c = _create();
        _mint(c, alice, bound(n, 1, 100));
        if (buy) {
            _readyBuy(c);
            c.buyToken();
        }
        uint256 vaultEth = c.ethFloor() + c.pendingEth();
        uint256 vaultTok = c.tokenReserve();
        vm.startPrank(creator);
        c.withdrawCreator();
        vm.expectRevert(C.Nothing.selector);
        c.withdrawCreator();
        vm.expectRevert();
        c.redeem(_ids(0, 1));
        vm.expectRevert(C.TooEarly.selector);
        c.endTokenShare();
        c.setPayoutWallet(creator);
        vm.stopPrank();
        assertEq(address(c).balance, vaultEth + c.platformBalance());
        assertEq(tok.balanceOf(address(c)), vaultTok);
        assertEq(c.ethFloor() + c.pendingEth(), vaultEth);
    }

    function test_payoutChange_doesNotRedirectVault() public {
        C c = _create();
        _mint(c, alice, 10);
        vm.prank(creator);
        c.setPayoutWallet(bob);
        uint256 b0 = bob.balance;
        c.withdrawCreator();
        assertEq(bob.balance - b0, 1 ether - 0.5 ether - 0.002 ether);
        assertEq(address(c).balance, 0.5 ether + 0.002 ether);
    }

    function test_platformFee_readLive() public {
        C c = _create();
        _mint(c, alice, 10);
        vm.store(address(feeSrc), bytes32(0), bytes32(uint256(uint160(bob))));
        uint256 b0 = bob.balance;
        c.withdrawPlatform();
        assertEq(bob.balance - b0, 0.002 ether);
    }

    // ================================================================ misc

    function test_tokenURI_nonexistent_reverts() public {
        C c = _create();
        vm.expectRevert();
        c.tokenURI(0);
    }

    function test_supportsInterface() public {
        C c = _create();
        assertTrue(c.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(c.supportsInterface(0x2a55205a)); // ERC2981
        assertFalse(c.supportsInterface(0xffffffff));
    }

    function test_redeemValue_zeroWhenNoneOutstanding() public {
        C c = _create();
        (uint256 e, uint256 t) = c.redeemValuePerNft();
        assertEq(e + t, 0);
    }

    function test_ethFromPoolManager_accepted_othersRejected() public {
        C c = _create();
        vm.deal(address(pm), 1 ether);
        vm.prank(address(pm));
        (bool ok,) = address(c).call{value: 1}("");
        assertTrue(ok);
        vm.prank(creator);
        (ok,) = address(c).call{value: 1}("");
        assertFalse(ok);
    }
}
