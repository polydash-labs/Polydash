// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {PolydashStakingPool} from "../src/PolydashStakingPool.sol";

/// @dev Test double for a stake token that refuses transfers to a blocked address (USDC/USDT-style).
contract BlocklistToken is ERC20 {
    error TransferBlocked(address account);

    mapping(address => bool) public blocked;

    constructor() ERC20("Blocklist USD", "BLUSD") {}

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && blocked[from]) revert TransferBlocked(from);
        if (to != address(0) && blocked[to]) revert TransferBlocked(to);
        super._update(from, to, value);
    }
}

/// @notice V1 known issue, test only: `_sendPrincipal` pushes the unstake fee to the factory
///         fee recipient. If that transfer reverts, withdraw, exit, and emergencyWithdraw revert
///         until the factory owner rotates `feeRecipient`. Production source is unchanged.
contract PolydashStakingPoolFeeRecipientTest is BaseTest {
    BlocklistToken internal bl;
    PolydashStakingPool internal pool;
    address internal fresh = makeAddr("fresh-recipient");

    function setUp() public override {
        super.setUp();
        bl = new BlocklistToken();
        bl.mint(alice, 1_000_000 * E);
        bl.mint(bob, 1_000_000 * E);

        vm.prank(creator);
        pool = PolydashStakingPool(
            factory.createPool(address(bl), address(token), 1000 * E, 0, DAY, 0, "Blocklist", "fee recipient")
        );

        vm.prank(alice);
        bl.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        bl.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        pool.stake(100 * E);
        vm.prank(bob);
        pool.stake(50 * E);
    }

    function test_blockedFeeRecipient_revertsWithdrawExitAndEmergency() public {
        bl.setBlocked(treasury, true);

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(BlocklistToken.TransferBlocked.selector, treasury));
        pool.withdraw(100 * E);
        vm.expectRevert(abi.encodeWithSelector(BlocklistToken.TransferBlocked.selector, treasury));
        pool.exit();
        vm.expectRevert(abi.encodeWithSelector(BlocklistToken.TransferBlocked.selector, treasury));
        pool.emergencyWithdraw();
        vm.stopPrank();

        assertEq(pool.balanceOf(alice), 100 * E);
        assertEq(bl.balanceOf(treasury), 0);
    }

    function test_rotatingFeeRecipient_restoresExits() public {
        bl.setBlocked(treasury, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BlocklistToken.TransferBlocked.selector, treasury));
        pool.emergencyWithdraw();

        vm.prank(owner);
        factory.setFeeRecipient(fresh);

        uint256 aliceBefore = bl.balanceOf(alice);
        vm.prank(alice);
        pool.emergencyWithdraw();
        assertEq(bl.balanceOf(alice) - aliceBefore, 99 * E);
        assertEq(bl.balanceOf(fresh), 1 * E);
        assertEq(pool.balanceOf(alice), 0);

        uint256 bobBefore = bl.balanceOf(bob);
        vm.prank(bob);
        pool.withdraw(50 * E);
        assertEq(bl.balanceOf(bob) - bobBefore, (50 * E * 99) / 100);
        assertEq(bl.balanceOf(fresh), (15 * E) / 10);
        assertEq(pool.balanceOf(bob), 0);
    }
}
