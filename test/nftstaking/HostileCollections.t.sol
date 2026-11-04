// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NftStakingFactory} from "../../src/nftstaking/NftStakingFactory.sol";
import {NftStakingPool} from "../../src/nftstaking/NftStakingPool.sol";
import {MockERC20, FeeERC20, MockCollection} from "../mocks/CreatorMocks.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// transferFrom does nothing; ownerOf is configurable (default: real owner map never changes)
contract FakeTransfer721 {
    mapping(uint256 => address) public owners;
    bool public lieOwnerIsCaller;

    function supportsInterface(bytes4 i) external pure returns (bool) {
        return i == 0x80ac58cd || i == 0x01ffc9a7;
    }

    function setOwner(uint256 id, address o) external {
        owners[id] = o;
    }

    function setLie(bool v) external {
        lieOwnerIsCaller = v;
    }

    function ownerOf(uint256 id) external view returns (address) {
        return lieOwnerIsCaller ? msg.sender : owners[id];
    }
    function transferFrom(address, address, uint256) external {}
}

/// Calls back into the pool from inside transferFrom
contract Reentrant721 is ERC721 {
    NftStakingPool public target;
    uint256 public mode;
    bytes4 public caught;
    constructor() ERC721("R", "R") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function arm(NftStakingPool p, uint256 m) external {
        target = p;
        mode = m;
    }

    function transferFrom(address f, address t, uint256 id) public override {
        super.transferFrom(f, t, id);
        if (mode == 0) return;
        uint256 m = mode;
        mode = 0;
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        if (m == 1) {
            try target.claim() {}
            catch (bytes memory r) {
                caught = bytes4(r);
            }
        }
        if (m == 2) {
            try target.withdraw(ids) {}
            catch (bytes memory r) {
                caught = bytes4(r);
            }
        }
        if (m == 3) {
            try target.emergencyWithdraw(ids) {}
            catch (bytes memory r) {
                caught = bytes4(r);
            }
        }
        if (m == 4) {
            try target.fund(1) {}
            catch (bytes memory r) {
                caught = bytes4(r);
            }
        }
    }
}

/// Owner can freeze all transfers (e.g. blocks transfers out of the pool)
contract Freezable721 is ERC721 {
    bool public frozen;
    constructor() ERC721("F", "F") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function freeze(bool v) external {
        frozen = v;
    }

    function _update(address to, uint256 id, address auth) internal override returns (address) {
        require(!frozen, "frozen");
        return super._update(to, id, auth);
    }
}

contract Mock1155 {
    function supportsInterface(bytes4 i) external pure returns (bool) {
        return i == 0xd9b67a26 || i == 0x01ffc9a7;
    }
}

contract YesToAll {
    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}

contract NoErc165 {
    function ownerOf(uint256) external pure returns (address) {
        return address(1);
    }
}

contract GasBomb {
    function supportsInterface(bytes4) external pure returns (bool) {
        while (true) {}
        return true;
    }
}

contract HostileCollectionsTest is Test {
    NftStakingFactory fac;
    MockERC20 rew;
    MockCollection good;
    address creator = address(0xC0);
    address alice = address(0xA1);
    address bob = address(0xB0);
    address eve = address(0xE0);
    uint256 constant R = 1_000_000e18;
    uint256 constant D = 14 days;

    function setUp() public {
        vm.warp(1_000_000);
        fac = new NftStakingFactory(
            address(0x297c232F2EBCbB4e3Cd0b97167a971fF795EDdDd),
            address(0x8bdb1d8Db9aeC18bB464F719d5Bd97cFf8F1Ee94),
            false
        );
        rew = new MockERC20("POLYDASH");
        rew.mint(creator, 100 * R);
        rew.mint(eve, 100 * R);
        vm.prank(creator);
        rew.approve(address(fac), type(uint256).max);
        vm.prank(eve);
        rew.approve(address(fac), type(uint256).max);
        good = new MockCollection();
        good.mint(bob, 5); // 1..5
    }

    function _goodPool() internal returns (NftStakingPool p) {
        vm.prank(creator);
        p = NftStakingPool(fac.createPool(address(good), address(rew), R, 0, D));
        vm.prank(bob);
        good.setApprovalForAll(address(p), true);
        vm.prank(bob);
        p.stake(_one(1));
    }

    function _one(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function test_open_rejectsNon721() public {
        assertTrue(fac.isAllowedCollection(address(good)));
        assertFalse(fac.isAllowedCollection(address(new Mock1155())));
        assertFalse(fac.isAllowedCollection(address(new YesToAll())));
        assertFalse(fac.isAllowedCollection(address(new NoErc165())));
        assertFalse(fac.isAllowedCollection(address(rew))); // ERC-20
        assertFalse(fac.isAllowedCollection(eve)); // EOA
        address bomb = address(new GasBomb());
        assertFalse(fac.isAllowedCollection(bomb));
        vm.prank(eve);
        vm.expectRevert(NftStakingFactory.CollectionNotAllowed.selector);
        fac.createPool(bomb, address(rew), R, 0, D);
        address m1155 = address(new Mock1155());
        vm.prank(eve);
        vm.expectRevert(NftStakingFactory.CollectionNotAllowed.selector);
        fac.createPool(m1155, address(rew), R, 0, D);
    }

    function test_fakeTransfer_rejected() public {
        FakeTransfer721 f = new FakeTransfer721();
        f.setOwner(7, eve);
        vm.prank(eve);
        NftStakingPool p = NftStakingPool(fac.createPool(address(f), address(rew), R, 0, D));
        vm.prank(eve);
        vm.expectRevert(NftStakingPool.TransferNotReceived.selector);
        p.stake(_one(7));
    }

    function test_lyingOwnerOf_cannotOverwriteStake_andIsContained() public {
        NftStakingPool gp = _goodPool();
        FakeTransfer721 f = new FakeTransfer721();
        f.setLie(true); // ownerOf always says "the caller" -> pool thinks it holds everything
        vm.prank(eve);
        NftStakingPool p = NftStakingPool(fac.createPool(address(f), address(rew), R, 0, D));
        vm.prank(alice); // phantom stake succeeds inside the hostile pool only
        p.stake(_one(9));
        vm.prank(eve);
        vm.expectRevert(NftStakingPool.AlreadyStaked.selector);
        p.stake(_one(9)); // cannot hijack someone else's stake record
        vm.warp(block.timestamp + D);
        // the honest pool is untouched
        vm.prank(bob);
        gp.withdraw(_one(1));
        assertApproxEqAbs(rew.balanceOf(bob), R, 1);
        assertEq(good.ownerOf(1), bob);
    }

    function test_reentrancyFromCollection_blocked() public {
        Reentrant721 c = new Reentrant721();
        c.mint(alice, 1);
        c.mint(alice, 2);
        vm.prank(creator);
        NftStakingPool p = NftStakingPool(fac.createPool(address(c), address(rew), R, 0, D));
        vm.prank(alice);
        c.setApprovalForAll(address(p), true);
        bytes4 g = ReentrancyGuard.ReentrancyGuardReentrantCall.selector;
        for (uint256 m = 1; m <= 4; ++m) {
            c.arm(p, m);
            vm.prank(alice); // stake then pull triggers reentry
            p.stake(_one(m == 1 ? 1 : 2));
            assertEq(c.caught(), g);
            vm.prank(alice);
            p.withdraw(_one(m == 1 ? 1 : 2));
        }
        c.arm(p, 2); // reentry during withdraw's transfer out
        vm.prank(alice);
        p.stake(_one(1));
        c.arm(p, 1);
        vm.prank(alice);
        p.withdraw(_one(1));
        assertEq(c.caught(), g);
        assertEq(p.totalStaked(), 0);
    }

    function test_frozenCollection_noGlobalDoS() public {
        NftStakingPool gp = _goodPool();
        Freezable721 c = new Freezable721();
        c.mint(alice, 1);
        c.mint(bob, 2);
        vm.prank(eve);
        NftStakingPool p = NftStakingPool(fac.createPool(address(c), address(rew), R, 0, D));
        vm.prank(alice);
        c.setApprovalForAll(address(p), true);
        vm.prank(bob);
        c.setApprovalForAll(address(p), true);
        vm.prank(alice);
        p.stake(_one(1));
        vm.prank(bob);
        p.stake(_one(2));
        c.freeze(true);
        vm.warp(block.timestamp + D / 2);
        vm.prank(alice);
        vm.expectRevert();
        p.withdraw(_one(1));
        vm.prank(alice);
        vm.expectRevert();
        p.emergencyWithdraw(_one(1));
        // rewards still flow and can be claimed without moving NFTs
        vm.prank(alice);
        p.claim();
        assertApproxEqAbs(rew.balanceOf(alice), R / 4, 1e6);
        vm.prank(eve);
        rew.approve(address(p), R);
        vm.prank(eve);
        p.fund(R);
        // other pools and the factory keep working
        vm.prank(creator);
        fac.createPool(address(good), address(rew), R, 0, D);
        vm.warp(block.timestamp + D);
        vm.prank(bob);
        gp.withdraw(_one(1));
        assertEq(good.ownerOf(1), bob);
        c.freeze(false);
        vm.prank(alice);
        p.withdraw(_one(1));
        assertEq(c.ownerOf(1), alice);
    }

    function test_feeOnTransferReward_openFactory() public {
        FeeERC20 fee = new FeeERC20(100);
        fee.mint(creator, 10 * R);
        vm.prank(creator);
        fee.approve(address(fac), type(uint256).max);
        vm.prank(creator);
        NftStakingPool p = NftStakingPool(fac.createPool(address(good), address(fee), R, 0, D));
        assertEq(p.totalFunded(), fee.balanceOf(address(p)));
        assertLt(p.totalFunded(), R);
        vm.prank(bob);
        good.setApprovalForAll(address(p), true);
        vm.prank(bob);
        p.stake(_one(2));
        vm.warp(block.timestamp + D + 1);
        vm.prank(bob);
        p.withdraw(_one(2));
        assertLe(fee.balanceOf(address(p)), 1);
    }
}
