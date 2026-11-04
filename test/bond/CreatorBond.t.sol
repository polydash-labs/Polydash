// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {CreatorBondFactory} from "../../src/bond/CreatorBondFactory.sol";
import {CreatorBond} from "../../src/bond/CreatorBond.sol";

/// @dev Mirrors PolydashToken: fixed supply, burnable, no owner/mint.
contract BurnToken is ERC20Burnable {
    constructor(address to, uint256 s) ERC20("T", "T") {
        _mint(to, s);
    }
}

contract MockLaunch {
    address public token;
    address public creator;

    constructor(address c) {
        creator = c;
    }

    function setToken(address t) external {
        token = t;
    }
}

contract MockPolydashFactory {
    mapping(address => address) public launchOfToken;
    mapping(address => bool) public isLaunch;

    function set(address t, address l) external {
        launchOfToken[t] = l;
        isLaunch[l] = true;
    }
}

/// @dev Re-enters the bond when it receives ETH.
contract Reenterer {
    CreatorBond public bond;
    uint8 public mode; // 1 redeem, 2 refund, 3 slash
    bool public reentered;

    function setBond(CreatorBond b, uint8 m) external {
        bond = b;
        mode = m;
    }

    function approve(address t, address s) external {
        ERC20(t).approve(s, type(uint256).max);
    }

    function doRedeem(uint256 a) external {
        bond.redeem(a);
    }

    function doRefund() external {
        bond.refund();
    }

    function doCancel() external {
        bond.cancel();
    }

    receive() external payable {
        if (mode == 1) {
            try bond.redeem(1e18) {
                reentered = true;
            } catch {}
        }
        if (mode == 2) {
            try bond.refund() {
                reentered = true;
            } catch {}
        }
        if (mode == 3) {
            try bond.slash() {
                reentered = true;
            } catch {}
        }
    }
}

contract RejectEth {
    receive() external payable {
        revert("no");
    }

    function create(CreatorBondFactory f, address t, address[] calldata w, uint256 c)
        external
        payable
        returns (address)
    {
        return f.createBond{value: msg.value}(t, w, c, 0, 7 days);
    }

    function refund(CreatorBond b) external {
        b.refund();
    }
}

contract CreatorBondTest is Test {
    MockPolydashFactory pf;
    CreatorBondFactory bf;
    MockLaunch launch;
    BurnToken tok;
    address creator = address(0xC0);
    address team = address(0x7E);
    address alice = address(0xA1);
    address bob = address(0xB0);
    address pool = address(0x9001);
    uint256 constant SUPPLY = 1_000_000_000e18;
    uint256 constant C = 100_000_000e18; // creator holds 10%

    function setUp() public {
        vm.warp(1_000_000);
        pf = new MockPolydashFactory();
        bf = new CreatorBondFactory(address(pf), address(0));
        launch = new MockLaunch(creator);
        tok = new BurnToken(address(launch), SUPPLY);
        launch.setToken(address(tok));
        pf.set(address(tok), address(launch));
        vm.startPrank(address(launch));
        tok.transfer(creator, C);
        tok.transfer(team, C / 2);
        tok.transfer(alice, 10_000_000e18);
        tok.transfer(bob, 10_000_000e18);
        tok.transfer(pool, 500_000_000e18);
        vm.stopPrank();
        vm.deal(creator, 100 ether);
        vm.deal(alice, 1 ether);
    }

    function _one(address w) internal pure returns (address[] memory a) {
        a = new address[](1);
        a[0] = w;
    }

    function _two(address x, address y) internal pure returns (address[] memory a) {
        a = new address[](2);
        a[0] = x;
        a[1] = y;
    }

    function _bond(uint256 committed, uint256 allowance) internal returns (CreatorBond b) {
        vm.prank(creator);
        b = CreatorBond(
            payable(bf.createBond{value: 1 ether}(address(tok), _one(creator), committed, allowance, 30 days))
        );
    }

    function _sell(address from, uint256 amt) internal {
        vm.prank(from);
        tok.transfer(pool, amt);
    }

    // ---------------------------------------------------------------- creation
    function test_create_activeImmediatelyForCreatorOnly() public {
        CreatorBond b = _bond(C, 500);
        assertEq(uint8(b.status()), uint8(CreatorBond.Status.Active));
        assertEq(b.endTime(), block.timestamp + 30 days);
        assertEq(address(b).balance, 1 ether);
        assertEq(b.floor(), C * 9500 / 10_000);
        assertEq(bf.bondsByToken(address(tok))[0], address(b));
        assertTrue(bf.isBond(address(b)));
    }

    function test_create_reverts() public {
        vm.startPrank(alice);
        vm.expectRevert(CreatorBondFactory.NotCreator.selector);
        bf.createBond{value: 0.1 ether}(address(tok), _one(alice), 1, 0, 7 days);
        vm.stopPrank();
        vm.startPrank(creator);
        vm.expectRevert(CreatorBondFactory.NotPolydashToken.selector);
        bf.createBond{value: 0.1 ether}(address(0xdead), _one(creator), 1, 0, 7 days);
        vm.expectRevert(CreatorBondFactory.BondTooSmall.selector);
        bf.createBond{value: 0.001 ether}(address(tok), _one(creator), 1, 0, 7 days);
        vm.expectRevert(CreatorBondFactory.BadDuration.selector);
        bf.createBond{value: 0.1 ether}(address(tok), _one(creator), 1, 0, 6 days);
        vm.expectRevert(CreatorBondFactory.BadDuration.selector);
        bf.createBond{value: 0.1 ether}(address(tok), _one(creator), 1, 0, 731 days);
        vm.expectRevert(CreatorBondFactory.BadAllowance.selector);
        bf.createBond{value: 0.1 ether}(address(tok), _one(creator), 1, 2001, 7 days);
        vm.expectRevert(CreatorBondFactory.ZeroCommitted.selector);
        bf.createBond{value: 0.1 ether}(address(tok), _one(creator), 0, 0, 7 days);
        vm.expectRevert(CreatorBondFactory.BadWallets.selector);
        bf.createBond{value: 0.1 ether}(address(tok), _one(team), 1, 0, 7 days); // creator missing
        vm.expectRevert(CreatorBondFactory.BadWallets.selector);
        bf.createBond{value: 0.1 ether}(address(tok), _two(creator, creator), 1, 0, 7 days); // dup
        vm.expectRevert(CreatorBondFactory.BadWallets.selector);
        bf.createBond{value: 0.1 ether}(address(tok), _two(creator, address(launch)), 1, 0, 7 days);
        vm.expectRevert(CreatorBondFactory.BadWallets.selector);
        bf.createBond{value: 0.1 ether}(address(tok), new address[](0), 1, 0, 7 days);
        address[] memory many = new address[](11);
        for (uint256 i; i < 11; ++i) {
            many[i] = address(uint160(100 + i));
        }
        many[0] = creator;
        vm.expectRevert(CreatorBondFactory.BadWallets.selector);
        bf.createBond{value: 0.1 ether}(address(tok), many, 1, 0, 7 days);
        vm.expectRevert(CreatorBondFactory.InsufficientBalance.selector);
        bf.createBond{value: 0.1 ether}(address(tok), _one(creator), C + 1, 0, 7 days);
        vm.stopPrank();
    }

    function test_launchTokenMismatchRejected() public {
        MockLaunch other = new MockLaunch(creator);
        other.setToken(address(0xBEEF));
        pf.set(address(tok), address(other));
        vm.prank(creator);
        vm.expectRevert(CreatorBondFactory.NotPolydashToken.selector);
        bf.createBond{value: 0.1 ether}(address(tok), _one(creator), 1, 0, 7 days);
    }

    // ---------------------------------------------------------------- team wallet confirmation
    function test_teamWalletMustConfirm() public {
        vm.prank(creator);
        CreatorBond b = CreatorBond(
            payable(bf.createBond{value: 1 ether}(address(tok), _two(creator, team), C + C / 2, 0, 30 days))
        );
        assertEq(uint8(b.status()), uint8(CreatorBond.Status.Pending));
        vm.expectRevert(CreatorBond.BadStatus.selector);
        b.slash();
        vm.prank(alice);
        vm.expectRevert(CreatorBond.NotRegistered.selector);
        b.confirmWallet();
        vm.prank(creator);
        vm.expectRevert(CreatorBond.AlreadyConfirmed.selector);
        b.confirmWallet();
        vm.prank(team);
        b.confirmWallet();
        assertEq(uint8(b.status()), uint8(CreatorBond.Status.Active));
        vm.prank(team);
        vm.expectRevert(CreatorBond.BadStatus.selector);
        b.confirmWallet();
    }

    function test_activationRevertsIfBalanceDroppedWhilePending() public {
        vm.prank(creator);
        CreatorBond b = CreatorBond(
            payable(bf.createBond{value: 1 ether}(address(tok), _two(creator, team), C + C / 2, 0, 30 days))
        );
        _sell(creator, 1);
        vm.prank(team);
        vm.expectRevert(CreatorBond.BelowFloor.selector);
        b.confirmWallet();
        // creator can still cancel
        uint256 before = creator.balance;
        vm.prank(creator);
        b.cancel();
        assertEq(creator.balance - before, 1 ether);
        assertEq(uint8(b.status()), uint8(CreatorBond.Status.Cancelled));
    }

    function test_cancel_onlyCreator_onlyPending() public {
        vm.prank(creator);
        CreatorBond b =
            CreatorBond(payable(bf.createBond{value: 1 ether}(address(tok), _two(creator, team), C, 0, 30 days)));
        vm.prank(alice);
        vm.expectRevert(CreatorBond.OnlyCreator.selector);
        b.cancel();
        vm.prank(team);
        b.confirmWallet();
        vm.prank(creator);
        vm.expectRevert(CreatorBond.BadStatus.selector);
        b.cancel();
    }

    function test_movesBetweenRegisteredWalletsDontCount() public {
        vm.prank(creator);
        CreatorBond b = CreatorBond(
            payable(bf.createBond{value: 1 ether}(address(tok), _two(creator, team), C + C / 2, 0, 30 days))
        );
        vm.prank(team);
        b.confirmWallet();
        vm.prank(creator);
        tok.transfer(team, C);
        assertFalse(b.canSlash());
        vm.expectRevert(CreatorBond.NotRugged.selector);
        b.slash();
    }

    // ---------------------------------------------------------------- slash
    function test_slash_onSellBeyondAllowance() public {
        CreatorBond b = _bond(C, 500);
        _sell(creator, C * 5 / 100); // exactly at allowance -> not slashable
        assertFalse(b.canSlash());
        vm.expectRevert(CreatorBond.NotRugged.selector);
        b.slash();
        _sell(creator, 1);
        assertTrue(b.canSlash());
        vm.prank(bob);
        b.slash();
        assertEq(uint8(b.status()), uint8(CreatorBond.Status.Slashed));
        assertEq(b.pot(), 1 ether);
        assertEq(b.supplyAtSlash(), SUPPLY);
    }

    function test_slash_onTransferToFreshWallet() public {
        CreatorBond b = _bond(C, 0);
        vm.prank(creator);
        tok.transfer(address(0xF4E5), 1);
        b.slash();
        assertEq(uint8(b.status()), uint8(CreatorBond.Status.Slashed));
    }

    function test_slash_onBurnByCreator() public {
        CreatorBond b = _bond(C, 0);
        vm.prank(creator);
        tok.burn(1);
        b.slash();
        assertEq(uint8(b.status()), uint8(CreatorBond.Status.Slashed));
    }

    function test_slash_notAfterEnd() public {
        CreatorBond b = _bond(C, 0);
        vm.warp(b.endTime());
        _sell(creator, C);
        vm.expectRevert(CreatorBond.Ended.selector);
        b.slash();
    }

    function test_noEarlySlash_noDoubleSlash() public {
        CreatorBond b = _bond(C, 0);
        vm.expectRevert(CreatorBond.NotRugged.selector);
        b.slash();
        _sell(creator, C);
        b.slash();
        vm.expectRevert(CreatorBond.BadStatus.selector);
        b.slash();
        vm.prank(creator);
        vm.expectRevert(CreatorBond.BadStatus.selector);
        b.refund();
    }

    function test_sellThenRebuyBeforeSlashIsNotSlashable() public {
        CreatorBond b = _bond(C, 0);
        _sell(creator, C / 2);
        vm.prank(pool);
        tok.transfer(creator, C / 2); // bought back
        assertFalse(b.canSlash());
    }

    // ---------------------------------------------------------------- griefing
    function test_grief_sendingTokensInCannotSlash() public {
        CreatorBond b = _bond(C, 0);
        vm.prank(alice);
        tok.transfer(creator, 5_000_000e18);
        assertFalse(b.canSlash());
        vm.expectRevert(CreatorBond.NotRugged.selector);
        b.slash();
    }

    function test_grief_outsiderActionsCannotSlash() public {
        CreatorBond b = _bond(C, 0);
        vm.startPrank(alice);
        tok.transfer(pool, 1_000_000e18);
        tok.burn(1_000_000e18);
        tok.approve(creator, type(uint256).max);
        vm.stopPrank();
        assertFalse(b.canSlash());
    }

    function test_grief_forcedEthDoesNotBreakRefund() public {
        CreatorBond b = _bond(C, 0);
        vm.deal(address(b), 5 ether); // simulates selfdestruct force-send
        vm.warp(b.endTime());
        uint256 before = creator.balance;
        vm.prank(creator);
        b.refund();
        assertEq(creator.balance - before, 5 ether);
    }

    function test_directEthRejected() public {
        CreatorBond b = _bond(C, 0);
        vm.prank(alice);
        (bool ok,) = address(b).call{value: 0.1 ether}("");
        assertFalse(ok);
    }

    // ---------------------------------------------------------------- refund
    function test_refund_afterPeriod() public {
        CreatorBond b = _bond(C, 1000);
        _sell(creator, C / 10);
        vm.prank(creator);
        vm.expectRevert(CreatorBond.NotEnded.selector);
        b.refund();
        vm.warp(b.endTime());
        vm.prank(alice);
        vm.expectRevert(CreatorBond.OnlyCreator.selector);
        b.refund();
        uint256 before = creator.balance;
        vm.prank(creator);
        b.refund();
        assertEq(creator.balance - before, 1 ether);
        vm.prank(creator);
        vm.expectRevert(CreatorBond.BadStatus.selector);
        b.refund(); // double refund
        vm.expectRevert(CreatorBond.BadStatus.selector);
        b.slash();
    }

    function test_refund_blockedIfBelowFloorAtEnd() public {
        CreatorBond b = _bond(C, 0);
        vm.warp(b.endTime());
        _sell(creator, 1);
        vm.prank(creator);
        vm.expectRevert(CreatorBond.BelowFloor.selector);
        b.refund();
        // restoring the balance re-enables refund (no slash possible after end)
        vm.prank(pool);
        tok.transfer(creator, 1);
        vm.prank(creator);
        b.refund();
    }

    function test_refund_rejectingCreatorReverts() public {
        RejectEth r = new RejectEth();
        launch = new MockLaunch(address(r));
        BurnToken t2 = new BurnToken(address(r), SUPPLY);
        launch.setToken(address(t2));
        pf.set(address(t2), address(launch));
        vm.deal(address(this), 1 ether);
        CreatorBond b = CreatorBond(payable(r.create{value: 1 ether}(bf, address(t2), _one(address(r)), 1)));
        vm.warp(b.endTime());
        vm.expectRevert(CreatorBond.TransferFailed.selector);
        r.refund(b);
        assertEq(uint8(b.status()), uint8(CreatorBond.Status.Active)); // state rolled back, funds safe
    }

    // ---------------------------------------------------------------- redeem
    function _slashed() internal returns (CreatorBond b) {
        b = _bond(C, 0);
        _sell(creator, C / 2);
        b.slash();
    }

    function test_redeem_payoutAndBurn() public {
        CreatorBond b = _slashed();
        vm.startPrank(alice);
        tok.approve(address(b), type(uint256).max);
        uint256 before = alice.balance;
        uint256 out = b.redeem(10_000_000e18);
        vm.stopPrank();
        assertEq(out, 1 ether * 10_000_000e18 / SUPPLY);
        assertEq(alice.balance - before, out);
        assertEq(tok.balanceOf(alice), 0);
        assertEq(tok.totalSupply(), SUPPLY - 10_000_000e18);
        // double claim: no tokens left
        vm.prank(alice);
        vm.expectRevert();
        b.redeem(1e18);
    }

    function test_redeem_rateIsFixedRegardlessOfOrder() public {
        CreatorBond b = _slashed();
        vm.prank(alice);
        tok.approve(address(b), type(uint256).max);
        vm.prank(bob);
        tok.approve(address(b), type(uint256).max);
        vm.prank(alice);
        uint256 a = b.redeem(10_000_000e18);
        vm.prank(bob);
        uint256 c = b.redeem(10_000_000e18);
        assertEq(a, c);
    }

    function test_redeem_lateBuyerGetsSameFixedRate() public {
        CreatorBond b = _slashed();
        address late = address(0x1A7E);
        vm.prank(pool);
        tok.transfer(late, 50_000_000e18);
        vm.startPrank(late);
        tok.approve(address(b), type(uint256).max);
        uint256 out = b.redeem(50_000_000e18);
        vm.stopPrank();
        assertEq(out, b.quoteRedeem(50_000_000e18));
        assertEq(out, 0.05 ether);
    }

    function test_redeem_registeredWalletBlocked_andGuards() public {
        CreatorBond b = _bond(C, 0);
        vm.prank(alice);
        vm.expectRevert(CreatorBond.BadStatus.selector);
        b.redeem(1e18);
        _sell(creator, 1);
        b.slash();
        vm.prank(creator);
        vm.expectRevert(CreatorBond.RegisteredCannotRedeem.selector);
        b.redeem(1e18);
        vm.prank(alice);
        vm.expectRevert(CreatorBond.ZeroAmount.selector);
        b.redeem(0);
        vm.prank(alice);
        vm.expectRevert(CreatorBond.ZeroAmount.selector);
        b.redeem(1); // dust rounds to zero
        assertEq(b.quoteRedeem(1e18), 1 ether * 1e18 / SUPPLY);
    }

    function test_redeem_entireSupplyNeverExceedsPot() public {
        CreatorBond b = _slashed();
        address[4] memory hs = [alice, bob, pool, team];
        for (uint256 i; i < hs.length; ++i) {
            uint256 bal = tok.balanceOf(hs[i]);
            if (bal == 0) continue;
            vm.startPrank(hs[i]);
            tok.approve(address(b), bal);
            b.redeem(bal);
            vm.stopPrank();
        }
        assertLe(b.totalPaid(), b.pot());
        assertEq(address(b).balance, b.pot() - b.totalPaid());
    }

    // ---------------------------------------------------------------- reentrancy
    function test_reentrancy_redeem() public {
        CreatorBond b = _slashed();
        Reenterer r = new Reenterer();
        vm.prank(alice);
        tok.transfer(address(r), 10_000_000e18);
        r.setBond(b, 1);
        r.approve(address(tok), address(b));
        r.doRedeem(5_000_000e18);
        assertFalse(r.reentered());
        assertEq(tok.balanceOf(address(r)), 5_000_000e18);
    }

    function test_reentrancy_refund() public {
        Reenterer r = new Reenterer();
        launch = new MockLaunch(address(r));
        BurnToken t2 = new BurnToken(address(r), SUPPLY);
        launch.setToken(address(t2));
        pf.set(address(t2), address(launch));
        vm.deal(address(r), 1 ether);
        vm.prank(address(r));
        CreatorBond b =
            CreatorBond(payable(bf.createBond{value: 1 ether}(address(t2), _one(address(r)), SUPPLY, 0, 7 days)));
        r.setBond(b, 2);
        vm.warp(b.endTime());
        r.doRefund();
        assertFalse(r.reentered());
        assertEq(address(r).balance, 1 ether);
        assertEq(address(b).balance, 0);
    }

    // ---------------------------------------------------------------- fuzz
    function testFuzz_slashIffBelowFloor(uint256 committed, uint256 allowance, uint256 moved) public {
        committed = bound(committed, 1, C);
        allowance = bound(allowance, 0, 2000);
        moved = bound(moved, 0, C);
        CreatorBond b = _bond(committed, allowance);
        _sell(creator, moved);
        uint256 f = committed * (10_000 - allowance) / 10_000;
        bool expect = (C - moved) < f;
        assertEq(b.canSlash(), expect);
        if (expect) {
            b.slash();
        } else {
            vm.expectRevert(CreatorBond.NotRugged.selector);
            b.slash();
        }
    }

    function testFuzz_inboundTransfersNeverSlash(uint256 inAmt, uint256 committed) public {
        committed = bound(committed, 1, C);
        inAmt = bound(inAmt, 0, 10_000_000e18);
        CreatorBond b = _bond(committed, 0);
        vm.prank(alice);
        tok.transfer(creator, inAmt);
        assertFalse(b.canSlash());
    }

    function testFuzz_redeemsNeverExceedPot(uint256 a, uint256 c, uint256 bondWei) public {
        bondWei = bound(bondWei, 0.01 ether, 50 ether);
        a = bound(a, 1, 10_000_000e18);
        c = bound(c, 1, 500_000_000e18);
        vm.prank(creator);
        CreatorBond b = CreatorBond(payable(bf.createBond{value: bondWei}(address(tok), _one(creator), C, 0, 7 days)));
        _sell(creator, 1);
        b.slash();
        vm.prank(alice);
        tok.approve(address(b), type(uint256).max);
        vm.prank(pool);
        tok.approve(address(b), type(uint256).max);
        if (b.quoteRedeem(a) > 0) {
            vm.prank(alice);
            b.redeem(a);
        }
        if (b.quoteRedeem(c) > 0) {
            vm.prank(pool);
            b.redeem(c);
        }
        assertLe(b.totalPaid(), b.pot());
        assertEq(address(b).balance + b.totalPaid(), bondWei);
    }

    function testFuzz_refundOnlyAfterEnd(uint256 t) public {
        CreatorBond b = _bond(C, 0);
        t = bound(t, 0, 60 days);
        vm.warp(block.timestamp + t);
        uint256 end = b.endTime();
        vm.prank(creator);
        if (block.timestamp < end) {
            vm.expectRevert(CreatorBond.NotEnded.selector);
            b.refund();
        } else {
            b.refund();
            assertEq(uint8(b.status()), uint8(CreatorBond.Status.Refunded));
        }
    }
}
