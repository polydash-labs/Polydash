// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreatorVestingFactory} from "../../src/vesting/CreatorVestingFactory.sol";
import {CreatorVestingVault} from "../../src/vesting/CreatorVestingVault.sol";
import {NftStakingFactory} from "../../src/nftstaking/NftStakingFactory.sol";
import {CreatorBondFactory} from "../../src/bond/CreatorBondFactory.sol";
import {CreatorBond} from "../../src/bond/CreatorBond.sol";
import {IPolydashStakingPoolV2} from "../../src/vesting/IPolydashStakingV2.sol";

/// Read-only fork tests against Robinhood Chain (chainId 4663). Nothing is broadcast; all state
/// changes happen in the local fork only. Run with: FORK_RPC=https://rpc.mainnet.chain.robinhood.com forge test --match-contract Fork
contract ForkTest is Test {
    address constant V2_FACTORY = 0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0;
    address constant FIXED_NFT_FACTORY = 0x297c232F2EBCbB4e3Cd0b97167a971fF795EDdDd;
    address constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address constant POLYDASH_POOL = 0x0F50043E172B8652bb786C4F14f30c415E5760AB; // V2 pool, ends 2027-02
    address constant POLYCAT = 0xcB674D45947dcb46a60Dd8a1eD18EEc2E0546bE0;
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
    }

    function test_fork_vaultStakesIntoRealPool() public {
        if (!on) return;
        if (block.timestamp >= IPolydashStakingPoolV2(POLYDASH_POOL).endTime()) return;
        // POLYDASH predates the launch factories, so a restricted factory rejects it; we use a
        // harness factory whose "A" is a mock that lists POLYDASH, purely to exercise the real V2 pool.
        MockLF m = new MockLF(POLYDASH);
        CreatorVestingFactory vf = new CreatorVestingFactory(V2_FACTORY, address(m), address(0));
        address c = makeAddr("creator");
        deal(POLYDASH, c, 1_000_000e18);
        vm.startPrank(c);
        IERC20(POLYDASH).approve(address(vf), type(uint256).max);
        CreatorVestingVault v =
            CreatorVestingVault(vf.createVault(POLYDASH, c, 1_000_000e18, 0, 30 days, 180 days, POLYDASH_POOL));
        vm.stopPrank();
        assertEq(IPolydashStakingPoolV2(POLYDASH_POOL).balanceOf(address(v)), v.totalAllocation());
        vm.warp(block.timestamp + 7 days);
        v.claimRewards(); // may be 0 if the pool reserve is small; must not revert
        vm.warp(block.timestamp + 83 days);
        uint256 before = IERC20(POLYDASH).balanceOf(c);
        v.release();
        assertGe(IERC20(POLYDASH).balanceOf(c) - before, v.totalAllocation() / 2);
    }

    address constant LAUNCH_FACTORY = 0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2;
    address constant LAUNCH_FACTORY_OLD = 0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2;
    address constant CURVE_NFT_FACTORY = 0x8bdb1d8Db9aeC18bB464F719d5Bd97cFf8F1Ee94;

    function test_fork_launchRestriction() public {
        if (!on) return;
        CreatorVestingFactory vf = new CreatorVestingFactory(V2_FACTORY, LAUNCH_FACTORY, LAUNCH_FACTORY_OLD);
        assertFalse(vf.isPolypadToken(POLYDASH)); // POLYDASH is not a factory launch
        address[2] memory fs = [LAUNCH_FACTORY, LAUNCH_FACTORY_OLD];
        for (uint256 k; k < 2; ++k) {
            (, bytes memory d) = fs[k].staticcall(abi.encodeWithSignature("allLaunches(uint256)", 0));
            address launch = abi.decode(d, (address));
            (, d) = launch.staticcall(abi.encodeWithSignature("token()"));
            address t = abi.decode(d, (address));
            assertTrue(vf.isPolypadToken(t));
            uint256 amt = IERC20(t).balanceOf(launch) / 100;
            address c = makeAddr("c");
            vm.prank(launch);
            IERC20(t).transfer(c, amt);
            vm.startPrank(c);
            IERC20(t).approve(address(vf), amt);
            CreatorVestingVault v = CreatorVestingVault(vf.createVault(t, c, amt, 0, 30 days, 180 days, address(0)));
            vm.stopPrank();
            assertTrue(v.meetsBadgeMinimum());
            assertTrue(vf.vaultMeetsBadgeMinimum(address(v)));
        }
        address c2 = makeAddr("c2");
        deal(POLYDASH, c2, 1e18);
        vm.startPrank(c2);
        IERC20(POLYDASH).approve(address(vf), 1e18);
        vm.expectRevert(CreatorVestingFactory.TokenNotLaunched.selector);
        vf.createVault(POLYDASH, c2, 1e18, 0, 30 days, 180 days, address(0));
        vm.stopPrank();
    }

    function test_fork_curveFactoryInterface() public {
        if (!on) return;
        // curve factory exposes isCollection(address); no curve collections exist yet (allCollectionsLength == 0)
        (bool ok, bytes memory d) =
            CURVE_NFT_FACTORY.staticcall(abi.encodeWithSignature("isCollection(address)", POLYCAT));
        assertTrue(ok);
        assertFalse(abi.decode(d, (bool)));
        (ok, d) = CURVE_NFT_FACTORY.staticcall(abi.encodeWithSignature("allCollectionsLength()"));
        assertTrue(ok);
        uint256 n = abi.decode(d, (uint256));
        NftStakingFactory f = new NftStakingFactory(FIXED_NFT_FACTORY, CURVE_NFT_FACTORY, true);
        assertTrue(f.isAllowedCollection(POLYCAT));
        assertFalse(f.isAllowedCollection(POLYDASH));
        if (n > 0) {
            (, d) = CURVE_NFT_FACTORY.staticcall(abi.encodeWithSignature("allCollections(uint256)", 0));
            assertTrue(f.isAllowedCollection(abi.decode(d, (address))));
        }
    }

    function test_fork_polycatAllowed() public {
        if (!on) return;
        NftStakingFactory f = new NftStakingFactory(FIXED_NFT_FACTORY, address(0), true);
        assertTrue(f.isAllowedCollection(POLYCAT));
        assertFalse(f.isAllowedCollection(POLYDASH));
    }

    function test_fork_creatorBondOnRealLaunch() public {
        if (!on) return;
        address pf = 0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2;
        (, bytes memory d) = pf.staticcall(abi.encodeWithSignature("allLaunchesLength()"));
        uint256 n = abi.decode(d, (uint256));
        address t;
        address c;
        uint256 bal;
        for (uint256 i; i < n && i < 50; ++i) {
            (, d) = pf.staticcall(abi.encodeWithSignature("allLaunches(uint256)", i));
            address launch = abi.decode(d, (address));
            (, d) = launch.staticcall(abi.encodeWithSignature("token()"));
            t = abi.decode(d, (address));
            (, d) = launch.staticcall(abi.encodeWithSignature("creator()"));
            c = abi.decode(d, (address));
            bal = IERC20(t).balanceOf(c);
            if (bal > 1e18) break;
        }
        if (bal <= 1e18) {
            // creator sold/holds nothing on the live chain: give it tokens from the launch contract (fork only)
            (, d) = pf.staticcall(abi.encodeWithSignature("allLaunches(uint256)", 0));
            address l0 = abi.decode(d, (address));
            (, d) = l0.staticcall(abi.encodeWithSignature("token()"));
            t = abi.decode(d, (address));
            (, d) = l0.staticcall(abi.encodeWithSignature("creator()"));
            c = abi.decode(d, (address));
            bal = IERC20(t).balanceOf(l0) / 100;
            vm.prank(l0);
            IERC20(t).transfer(c, bal);
            bal = IERC20(t).balanceOf(c);
        }
        assertGt(bal, 1);
        CreatorBondFactory bf = new CreatorBondFactory(pf, address(0));
        vm.deal(c, 1 ether);
        address[] memory w = new address[](1);
        w[0] = c;
        vm.prank(c);
        CreatorBond b = CreatorBond(payable(bf.createBond{value: 0.1 ether}(t, w, bal, 0, 7 days)));
        assertTrue(!b.canSlash());
        address h = makeAddr("holder");
        vm.prank(c);
        IERC20(t).transfer(h, bal / 2);
        b.slash();
        uint256 supply = IERC20(t).totalSupply();
        vm.startPrank(h);
        IERC20(t).approve(address(b), bal / 2);
        uint256 out = b.redeem(bal / 2);
        vm.stopPrank();
        assertEq(out, 0.1 ether * (bal / 2) / supply);
        assertEq(IERC20(t).totalSupply(), supply - bal / 2); // real PolydashToken burn path works
    }
}

contract MockLF {
    address t;

    constructor(address _t) {
        t = _t;
    }

    function launchOfToken(address x) external view returns (address) {
        return x == t ? address(1) : address(0);
    }
}
