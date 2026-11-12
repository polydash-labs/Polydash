// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PolydashStakingFactoryV2} from "../../src/v2/PolydashStakingFactoryV2.sol";
import {PolydashStakingPoolV2} from "../../src/v2/PolydashStakingPoolV2.sol";
import {MockERC20Decimals} from "../mocks/MockERC20Decimals.sol";

/// @dev Model-2 fee-on-transfer token: the sender is debited value + tax,
///      the recipient receives the full value. The tax is burned.
///      The fee rate can be changed mid-test to simulate a token that
///      raises its tax after the pool is funded.
contract MockFoTTop is ERC20 {
    uint256 public feeBps;

    constructor(uint256 f) ERC20("FOT", "FOT") {
        feeBps = f;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function setFeeBps(uint256 f) external {
        feeBps = f;
    }

    function _update(address from, address to, uint256 v) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (v * feeBps) / 10_000;
            super._update(from, address(0), fee); // tax debited from sender, burned
        }
        super._update(from, to, v); // full value to recipient; sender debited v (+ fee above)
    }
}

/// @notice Regression tests for the Angle3 fix: with a model-2 FoT reward token,
///         claims used to revert near the remaining reward room (net * (1 + fee) >
///         pool balance) and, since claim() took no amount, the rewards were frozen.
///         The fix learns the reward-side fee (rewardOutFeeBps), sizes claims so the
///         real outflow fits the room, and adds partial claims via claimAmount().
///         Note: the token's tax is burned on every payout, so total payouts are less
///         than total rewards with a FoT reward token; the fix guarantees claims succeed
///         for what is actually there and never freeze — it cannot recover burned tax.
contract FoTClaimFixedTest is Test {
    uint256 internal constant E = 1e18;
    uint256 internal constant DAY = 1 days;

    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    PolydashStakingFactoryV2 internal factory;
    MockERC20Decimals internal stakeTok;
    MockFoTTop internal rewardTok;
    PolydashStakingPoolV2 internal pool;

    function setUp() public {
        vm.warp(1_760_000_000);
        vm.prank(treasury);
        factory = new PolydashStakingFactoryV2(treasury);

        stakeTok = new MockERC20Decimals("Stake", "STK", 18);
        stakeTok.mint(alice, 1_000_000 * E);
        stakeTok.mint(bob, 1_000_000 * E);

        rewardTok = new MockFoTTop(1000); // 10% fee on top
        rewardTok.mint(creator, 1_000_000 * E);
        vm.prank(creator);
        rewardTok.approve(address(factory), type(uint256).max);

        // 1000 reward tokens, 10-day stream, 1% claim fee
        vm.prank(creator);
        pool = PolydashStakingPoolV2(
            factory.createPool(address(stakeTok), address(rewardTok), 1000 * E, 0, 10 * DAY, 0, 100, "Pool", "desc")
        );

        vm.prank(alice);
        stakeTok.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        stakeTok.approve(address(pool), type(uint256).max);

        vm.prank(alice);
        pool.stake(100 * E);
        vm.prank(bob);
        pool.stake(100 * E);

        // fast-forward to the end of the stream: each staker earned ~500 gross
        vm.warp(block.timestamp + 10 * DAY);
    }

    function test_bobClaimSucceedsWithFoTReward() public {
        assertApproxEqAbs(pool.earned(alice), 500 * E, 2, "alice earned");
        assertApproxEqAbs(pool.earned(bob), 500 * E, 2, "bob earned");

        // Alice claims first and gets her full net; the pool pays net + 10% tax.
        vm.prank(alice);
        pool.claim();
        assertEq(pool.earned(alice), 0, "alice fully claimed");

        // Before the fix Bob's claim() reverted here (ERC20InsufficientBalance).
        // Now it succeeds, sized so the real outflow fits the room.
        uint256 bobBalBefore = rewardTok.balanceOf(bob);
        vm.prank(bob);
        pool.claim();
        assertGt(rewardTok.balanceOf(bob), bobBalBefore, "bob received rewards");
        // Bob's claim is sized down: the tax burned on Alice's payout means the pool
        // cannot cover his full 500 gross. What is there, he gets; nothing reverts.
        // A second claim is a no-op (room exhausted), not a revert.
        vm.prank(bob);
        pool.claim();
        assertGt(pool.earned(bob), 0, "remainder is burned tax, not a freeze: further claims are no-ops");
    }

    function test_rewardFeeIsLearned() public {
        assertEq(pool.rewardOutFeeBps(), 0, "no fee learned before any payout");
        vm.prank(alice);
        pool.claim();
        assertEq(pool.rewardOutFeeBps(), 1000, "10% fee learned from Alice's payout");
    }

    function test_partialClaimWorks() public {
        vm.prank(alice);
        pool.claim();
        uint256 owedBefore = pool.earned(bob);
        // Bob claims exactly 100 gross; the 1% claim fee leaves 99 net (minus FoT sizing).
        vm.prank(bob);
        pool.claimAmount(100 * E);
        assertApproxEqAbs(pool.earned(bob), owedBefore - 100 * E, 2, "bob earned reduced by claimed gross");
        assertGt(rewardTok.balanceOf(bob), 0, "bob received a partial payout");
        // He can then claim the rest (sized) without reverting.
        vm.prank(bob);
        pool.claim();
    }

    function test_claimAmountZeroReverts() public {
        vm.prank(bob);
        vm.expectRevert(PolydashStakingPoolV2.ZeroAmount.selector);
        pool.claimAmount(0);
    }

    function test_exitWorksWithFoTReward() public {
        vm.prank(alice);
        pool.claim();
        // Before the fix exit() reverted because it calls _claim after _withdraw.
        uint256 stakeBefore = stakeTok.balanceOf(bob);
        uint256 rewardBefore = rewardTok.balanceOf(bob);
        vm.prank(bob);
        pool.exit();
        assertGt(stakeTok.balanceOf(bob), stakeBefore, "principal withdrawn");
        assertGt(rewardTok.balanceOf(bob), rewardBefore, "rewards paid on exit");
    }

    function test_feeIncrease_partialClaimStillWorks() public {
        vm.prank(alice);
        pool.claim(); // learns 10%
        assertEq(pool.rewardOutFeeBps(), 1000, "10% learned");

        // The token raises its tax to 20% mid-pool. The learned rate is now stale,
        // so a full claim sized for 10% may revert — the escape hatch is claimAmount.
        rewardTok.setFeeBps(2000);
        vm.prank(bob);
        vm.expectRevert();
        pool.claim();

        // A small partial claim fits, succeeds, and re-learns the higher rate.
        vm.prank(bob);
        pool.claimAmount(50 * E);
        assertEq(pool.rewardOutFeeBps(), 2000, "20% re-learned from partial claim");
        // Now the full claim is sized for 20% and succeeds.
        vm.prank(bob);
        pool.claim();
    }

    function test_control_plainRewardTokenWorks() public {
        // Same flow, plain reward token: both claims succeed in full, unchanged behaviour.
        MockERC20Decimals plain = new MockERC20Decimals("Plain", "PLN", 18);
        plain.mint(creator, 1_000_000 * E);
        vm.prank(creator);
        plain.approve(address(factory), type(uint256).max);
        vm.prank(creator);
        PolydashStakingPoolV2 p2 = PolydashStakingPoolV2(
            factory.createPool(address(stakeTok), address(plain), 1000 * E, 0, 10 * DAY, 0, 100, "Pool2", "desc")
        );
        vm.prank(alice);
        stakeTok.approve(address(p2), type(uint256).max);
        vm.prank(bob);
        stakeTok.approve(address(p2), type(uint256).max);
        vm.prank(alice);
        p2.stake(100 * E);
        vm.prank(bob);
        p2.stake(100 * E);
        // p2 was created at the warped time, so warp again to its end.
        vm.warp(block.timestamp + 10 * DAY);
        vm.prank(alice);
        p2.claim();
        vm.prank(bob);
        p2.claim();
        assertEq(p2.earned(alice), 0, "alice fully claimed with plain token");
        assertEq(p2.earned(bob), 0, "bob fully claimed with plain token");
        assertEq(p2.rewardOutFeeBps(), 0, "no fee learned for plain token");
    }
}
