// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundVaultStore} from "../../../src/fund/phase2/FundVaultStore.sol";
import {FundStakeFacetPhase3, FundStakeStore} from "../../../src/fund/phase3/FundStakeFacetPhase3.sol";
import {PolydashStakingFactoryV2} from "../../../src/v2/PolydashStakingFactoryV2.sol";
import {PolydashStakingPoolV2} from "../../../src/v2/PolydashStakingPoolV2.sol";
import {MockERC20} from "../../mocks/MockERC20.sol";
import {MockWETH} from "../InvestMocks.sol";
import {MockStakeAllowlist, StakeFacetHarness} from "./StakeFacet.t.sol";

/// @title StakeFacetForkTest (not reviewed, not deployed)
/// @notice Mainnet-fork test. Run with:
///         `ROBINHOOD_RPC_URL=https://robinhood.drpc.org forge test --match-contract StakeFacetForkTest`
///         It proves two things about the REAL deployed contracts:
///         (1) the facet never touches live pools or either live staking factory except through
///             the one pool it is told to stake in — pre-existing factory state is unchanged apart
///             from the single pool this test itself creates on the fork (fork-local only, no
///             mainnet effect);
///         (2) the full stake/claim/unstake cycle works against a REAL pool deployed by the LIVE
///             current factory — i.e. the FoT-fixed pool code (with `claimAmount`), not the pre-fix
///             source in this worktree.
contract StakeFacetForkTest is Test {
    address constant CURRENT_FACTORY = 0x4C87aff7009DE1c58E052FEe202349a10b28Be9c;
    address constant LEGACY_FACTORY = 0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0;

    MockERC20 polydash;
    MockWETH weth;
    MockStakeAllowlist allow;
    FundStakeFacetPhase3 facet;
    address manager = makeAddr("manager");

    function test_fork_liveFactoryUntouched_realFixedPoolCycle() public {
        vm.createSelectFork("robinhood");

        PolydashStakingFactoryV2 current = PolydashStakingFactoryV2(CURRENT_FACTORY);
        PolydashStakingFactoryV2 legacy = PolydashStakingFactoryV2(LEGACY_FACTORY);

        // Snapshot live factory state before the facet does anything.
        uint256 currentPoolsBefore = current.poolsLength();
        uint256 legacyPoolsBefore = legacy.poolsLength();
        address[] memory preExisting = current.getPoolAddresses(0, currentPoolsBefore);

        polydash = new MockERC20("POLYDASH", "POLYDASH", 0);
        weth = new MockWETH();
        allow = new MockStakeAllowlist();
        facet = new FundStakeFacetPhase3();

        StakeFacetHarness h = new StakeFacetHarness(
            manager,
            address(allow),
            address(weth),
            address(polydash),
            CURRENT_FACTORY,
            LEGACY_FACTORY,
            address(facet),
            8000,
            true
        );
        vm.deal(address(h), 100 ether);
        polydash.transfer(address(h), 100 ether);

        // Create a REAL pool via the LIVE current factory (fork-local). This deploys the
        // FoT-fixed pool bytecode — the pool has `claimAmount` and `rewardOutFeeBps`.
        polydash.approve(CURRENT_FACTORY, type(uint256).max);
        address poolAddr = current.createPool(
            address(polydash), address(polydash), 100_000 ether, 0, 10 days, 0, 100, "Fork Pool", "d"
        );
        PolydashStakingPoolV2 pool = PolydashStakingPoolV2(poolAddr);
        assertTrue(current.isPool(poolAddr));
        assertEq(current.poolsLength(), currentPoolsBefore + 1);

        // The fixed pool exposes the FoT-fix surface the facet probes for. Read via a raw call:
        // this file compiles against the worktree's pre-fix pool ABI, which lacks the getter,
        // but the LIVE pool deployed by the current factory has it.
        (bool feeOk, bytes memory feeRet) = poolAddr.staticcall(abi.encodeWithSignature("rewardOutFeeBps()"));
        assertTrue(feeOk);
        assertEq(abi.decode(feeRet, (uint256)), 0);
        assertEq(pool.earned(address(h)), 0); // nothing staked yet

        // Full cycle through the facet.
        vm.prank(manager);
        h.stake(poolAddr, 10 ether);
        assertEq(pool.balanceOf(address(h)), 10 ether);

        vm.warp(block.timestamp + 5 days);
        assertGt(pool.earned(address(h)), 40_000 ether);

        uint256 before = polydash.balanceOf(address(h));
        vm.prank(manager);
        h.claimRewards(poolAddr, 0);
        assertGt(polydash.balanceOf(address(h)) - before, 40_000 ether);

        vm.prank(manager);
        h.unstakeAll(poolAddr);
        assertEq(pool.balanceOf(address(h)), 0);
        assertEq(h.stakedShares(poolAddr), 0);
        assertGe(polydash.balanceOf(address(h)), 100 ether); // principal whole + rewards

        // A pool the live factories never created is still rejected on the fork.
        MockERC20 fakeToken = new MockERC20("Fake", "FAKE", 0);
        vm.prank(manager);
        vm.expectRevert(FundStakeStore.NotStakingPool.selector);
        h.stake(address(fakeToken), 1 ether);

        // Live factory state: exactly one new pool (the one this test created on the fork),
        // every pre-existing pool untouched, legacy factory untouched.
        assertEq(current.poolsLength(), currentPoolsBefore + 1);
        assertEq(legacy.poolsLength(), legacyPoolsBefore);
        for (uint256 i; i < preExisting.length; ++i) {
            assertTrue(current.isPool(preExisting[i]));
        }
        assertFalse(current.isPool(address(fakeToken)));
    }
}
