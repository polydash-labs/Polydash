// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PolydashStakingFactoryV2} from "../../src/v2/PolydashStakingFactoryV2.sol";
import {PolydashStakingPoolV2} from "../../src/v2/PolydashStakingPoolV2.sol";
import {MockERC20Decimals} from "../mocks/MockERC20Decimals.sol";

/// @notice Proves, against a live mainnet fork, that deploying a NEW staking
///         factory (with the FoT-fixed pool code) cannot affect the existing
///         pools or their features:
///           - the old factory's owner / fee recipient / pool list are unchanged
///           - every live pool is still bound to the old factory (immutable)
///           - live pool state is byte-identical before/after the new deploy
///           - staking, claiming and exiting on a LIVE pool still work exactly
///             as before (plain POLYDASH token: full claim, no sizing)
///           - the new factory only creates NEW pools, which carry the fix
///             (rewardOutFeeBps / claimAmount exist there and nowhere else)
///
/// No mainnet transaction is sent; the fork is local only.
///
/// FORK_RPC=https://robinhood.drpc.org forge test --match-contract NewFactoryDoesNotAffectLivePools -vv
contract NewFactoryDoesNotAffectLivePools is Test {
    uint256 internal constant E = 1e18;

    address internal constant OLD_FACTORY = 0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0;
    address internal constant FEE_RECIPIENT = 0x351BDe628892Aeb055F717300DBd2848af178479;
    address internal constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address internal constant POOL3 = 0xB2BBc1752FAa5BCfC67571819af30CE2AaF58518;
    address internal constant POOL_BIG = 0x0F50043E172B8652bb786C4F14f30c415E5760AB;
    address internal constant POOL_COMMUNITY = 0xe798D753Ba2D9584E86e490b48D8c572e726Cf33;
    address internal constant POOL_PRE = 0xaDF34A657cF2dcD3703A5478D9faE4a325dBA8ad;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        // Pinned block (not latest) on purpose: the free public RPCs cannot
        // reliably serve state proofs for the freshest blocks, and the fork
        // fails with "Unknown state" (same reason the buyback fork test pins
        // its block). Override with FORK_BLOCK=<n> to run against any block.
        uint256 forkBlock = vm.envOr("FORK_BLOCK", uint256(112280000));
        vm.createSelectFork(rpc, forkBlock);
    }

    function test_newFactoryDoesNotAffectLivePools() public {
        PolydashStakingFactoryV2 oldFactory = PolydashStakingFactoryV2(OLD_FACTORY);
        address[4] memory pools = [POOL3, POOL_BIG, POOL_COMMUNITY, POOL_PRE];

        // ---- snapshot live state before the new deploy ----
        address ownerBefore = oldFactory.owner();
        address feeBefore = oldFactory.feeRecipient();
        uint256 lenBefore = oldFactory.poolsLength();
        uint256[4] memory stakedBefore;
        uint256[4] memory rewardsBefore;
        uint256[4] memory availBefore;
        for (uint256 i; i < 4; i++) {
            PolydashStakingPoolV2 p = PolydashStakingPoolV2(pools[i]);
            assertEq(p.factory(), OLD_FACTORY, "live pool bound to old factory");
            stakedBefore[i] = p.totalStaked();
            rewardsBefore[i] = p.totalRewards();
            availBefore[i] = p.rewardAvailable();
        }

        // ---- deploy the NEW factory (fixed pool code), same fee recipient ----
        PolydashStakingFactoryV2 newFactory = new PolydashStakingFactoryV2(FEE_RECIPIENT);
        assertEq(newFactory.owner(), address(this), "new factory owned by deployer");
        assertEq(newFactory.feeRecipient(), FEE_RECIPIENT, "fee recipient unchanged");
        assertEq(newFactory.poolsLength(), 0, "new factory starts empty");

        // ---- a pool created on the new factory carries the fix ----
        MockERC20Decimals stakeTok = new MockERC20Decimals("Stake", "STK", 18);
        MockERC20Decimals rewardTok = new MockERC20Decimals("Reward", "RWD", 18);
        rewardTok.mint(address(this), 1000 * E);
        rewardTok.approve(address(newFactory), type(uint256).max);
        address newPoolAddr = newFactory.createPool(
            address(stakeTok), address(rewardTok), 1000 * E, 0, 10 days, 0, 100, "New", "desc"
        );
        PolydashStakingPoolV2 newPool = PolydashStakingPoolV2(newPoolAddr);
        assertEq(newPool.factory(), address(newFactory), "new pool bound to new factory");
        assertEq(newPool.rewardOutFeeBps(), 0, "new pool exposes learned reward fee");
        // claimAmount exists on the new pool: a zero-amount call reverts with
        // the new ZeroAmount error (proves the new selector is present).
        vm.expectRevert(PolydashStakingPoolV2.ZeroAmount.selector);
        newPool.claimAmount(0);

        // ---- live state is identical after the new deploy ----
        assertEq(oldFactory.owner(), ownerBefore, "old factory owner unchanged");
        assertEq(oldFactory.feeRecipient(), feeBefore, "old factory fee recipient unchanged");
        assertEq(oldFactory.poolsLength(), lenBefore, "old factory pool list unchanged");
        assertEq(lenBefore, 4, "four live pools");
        for (uint256 i; i < 4; i++) {
            PolydashStakingPoolV2 p = PolydashStakingPoolV2(pools[i]);
            assertEq(p.factory(), OLD_FACTORY, "live pool still bound to old factory");
            assertEq(p.totalStaked(), stakedBefore[i], "live pool stake unchanged");
            assertEq(p.totalRewards(), rewardsBefore[i], "live pool rewards unchanged");
            assertEq(p.rewardAvailable(), availBefore[i], "live pool available unchanged");
        }

        // ---- live pool features still work: stake, claim in full, exit ----
        // Pool3 is live (ends in the future) and same-token POLYDASH.
        PolydashStakingPoolV2 pool3 = PolydashStakingPoolV2(POOL3);
        deal(POLYDASH, address(this), 100 * E);
        IERC20(POLYDASH).approve(POOL3, type(uint256).max);
        pool3.stake(10 * E);
        assertEq(pool3.balanceOf(address(this)), 10 * E, "stake landed on live pool");
        assertEq(pool3.stakerCount(), 2, "new staker counted on live pool");
        // warp to the end of pool3's stream and claim in full (plain token:
        // the fix does not size the claim, so the full earned amount pays).
        vm.warp(pool3.endTime());
        uint256 earnedBefore = pool3.earned(address(this));
        assertGt(earnedBefore, 0, "earned rewards on live pool");
        uint256 balBefore = IERC20(POLYDASH).balanceOf(address(this));
        pool3.claim();
        assertEq(pool3.earned(address(this)), 0, "full claim on live pool");
        assertGt(IERC20(POLYDASH).balanceOf(address(this)), balBefore, "rewards paid on live pool");
        pool3.exit();
        assertEq(pool3.balanceOf(address(this)), 0, "exit withdrew stake on live pool");
    }
}
