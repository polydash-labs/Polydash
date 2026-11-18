// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolypadSpendVault} from "../../src/x402/PolypadSpendVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock USDG", "mUSDG") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract PolypadSpendVaultTest is Test {
    PolypadSpendVault internal vault;
    MockToken internal token;

    address internal owner = address(0xA11CE);
    address internal depositor = address(0xDE90);
    address internal facilitator = address(0xF401);
    address internal payee = address(0x9A93);
    uint256 internal keyPk = 0x1234;
    address internal key;

    bytes32 internal constant SPEND_TYPEHASH =
        keccak256("SpendAuthorization(address key,address token,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

    function setUp() public {
        vm.prank(owner);
        vault = new PolypadSpendVault();
        token = new MockToken();
        key = vm.addr(keyPk);
        vm.prank(owner);
        vault.setFacilitator(facilitator);
        token.mint(depositor, 1_000_000e6);
        vm.startPrank(depositor);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(address(token), 1_000_000e6);
        vm.stopPrank();
    }

    function _keyPolicy(uint256 perPay, uint256 daily, address[] memory allow, uint64 expiry) internal {
        vm.prank(depositor);
        vault.createKey(key, address(token), perPay, daily, allow, expiry);
    }

    function _sign(
        uint256 pk,
        address k,
        address t,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                vault.domainSeparator(),
                keccak256(abi.encode(SPEND_TYPEHASH, k, t, to, value, validAfter, validBefore, nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _spend(uint256 value, bytes32 nonce) internal returns (bytes memory sig) {
        sig = _sign(
            keyPk, key, address(token), payee, value, block.timestamp, block.timestamp + 120, nonce
        );
        vm.prank(facilitator);
        vault.spendWithAuthorization(
            key, address(token), payee, value, block.timestamp, block.timestamp + 120, nonce, sig
        );
    }

    function testDepositWithdraw() public {
        assertEq(vault.balances(depositor, address(token)), 1_000_000e6);
        vm.prank(depositor);
        vault.withdraw(address(token), 400_000e6);
        assertEq(vault.balances(depositor, address(token)), 600_000e6);
        assertEq(token.balanceOf(depositor), 400_000e6);
    }

    function testWithdrawOverBalanceReverts() public {
        vm.prank(depositor);
        vm.expectRevert(PolypadSpendVault.InsufficientBalance.selector);
        vault.withdraw(address(token), 1_000_001e6);
    }

    function testCreateKeyStoresPolicy() public {
        address[] memory allow = new address[](1);
        allow[0] = payee;
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        (address o, address t, uint256 perPay, uint256 daily, uint64 exp, bool rev,,,) =
            vault.keys(key);
        assertEq(o, depositor);
        assertEq(t, address(token));
        assertEq(perPay, 10e6);
        assertEq(daily, 100e6);
        assertEq(exp, block.timestamp + 1 days);
        assertFalse(rev);
        assertTrue(vault.keyAllowlist(key, payee));
    }

    function testCreateKeyDuplicateReverts() public {
        address[] memory allow = new address[](0);
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        vm.prank(depositor);
        vm.expectRevert(PolypadSpendVault.KeyExists.selector);
        vault.createKey(key, address(token), 10e6, 100e6, allow, uint64(block.timestamp + 1 days));
    }

    function testCreateKeyPerPaymentOverDailyReverts() public {
        address[] memory allow = new address[](0);
        vm.prank(depositor);
        vm.expectRevert(PolypadSpendVault.OverDailyCap.selector);
        vault.createKey(key, address(token), 200e6, 100e6, allow, uint64(block.timestamp + 1 days));
    }

    function testSpendHappyPath() public {
        address[] memory allow = new address[](1);
        allow[0] = payee;
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        _spend(5e6, bytes32(uint256(1)));
        assertEq(token.balanceOf(payee), 5e6);
        assertEq(vault.balances(depositor, address(token)), 1_000_000e6 - 5e6);
        assertTrue(vault.usedNonces(key, bytes32(uint256(1))));
    }

    function testSpendEmptyAllowlistAnyPayee() public {
        address[] memory allow = new address[](0);
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        address other = address(0x0BAD);
        bytes memory sig = _sign(
            keyPk, key, address(token), other, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1))
        );
        vm.prank(facilitator);
        vault.spendWithAuthorization(
            key, address(token), other, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1)), sig
        );
        assertEq(token.balanceOf(other), 5e6);
    }

    function testSpendNonAllowlistedPayeeReverts() public {
        address[] memory allow = new address[](1);
        allow[0] = payee;
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        address other = address(0x0BAD);
        bytes memory sig = _sign(
            keyPk, key, address(token), other, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1))
        );
        vm.prank(facilitator);
        vm.expectRevert(PolypadSpendVault.PayeeNotAllowlisted.selector);
        vault.spendWithAuthorization(
            key, address(token), other, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1)), sig
        );
    }

    function testSpendOverPerPaymentCapReverts() public {
        address[] memory allow = new address[](0);
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        bytes memory sig = _sign(
            keyPk, key, address(token), payee, 11e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1))
        );
        vm.prank(facilitator);
        vm.expectRevert(PolypadSpendVault.OverPerPaymentCap.selector);
        vault.spendWithAuthorization(
            key, address(token), payee, 11e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1)), sig
        );
    }

    function testSpendDailyCapEnforcedAndResets() public {
        address[] memory allow = new address[](0);
        _keyPolicy(10e6, 15e6, allow, uint64(block.timestamp + 3 days));
        _spend(10e6, bytes32(uint256(1)));
        bytes memory sig = _sign(
            keyPk, key, address(token), payee, 6e6, block.timestamp, block.timestamp + 120, bytes32(uint256(2))
        );
        vm.prank(facilitator);
        vm.expectRevert(PolypadSpendVault.OverDailyCap.selector);
        vault.spendWithAuthorization(
            key, address(token), payee, 6e6, block.timestamp, block.timestamp + 120, bytes32(uint256(2)), sig
        );
        // Next UTC day: the window resets and the same size spend works.
        vm.warp(block.timestamp + 1 days + 1);
        bytes memory sig2 = _sign(
            keyPk, key, address(token), payee, 10e6, block.timestamp, block.timestamp + 120, bytes32(uint256(3))
        );
        vm.prank(facilitator);
        vault.spendWithAuthorization(
            key, address(token), payee, 10e6, block.timestamp, block.timestamp + 120, bytes32(uint256(3)), sig2
        );
        assertEq(token.balanceOf(payee), 20e6);
    }

    function testSpendReusedNonceReverts() public {
        address[] memory allow = new address[](0);
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        _spend(5e6, bytes32(uint256(1)));
        bytes memory sig = _sign(
            keyPk, key, address(token), payee, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1))
        );
        vm.prank(facilitator);
        vm.expectRevert(PolypadSpendVault.NonceUsed.selector);
        vault.spendWithAuthorization(
            key, address(token), payee, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1)), sig
        );
    }

    function testSpendWrongSignerReverts() public {
        address[] memory allow = new address[](0);
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        bytes memory sig = _sign(
            0x9999, key, address(token), payee, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1))
        );
        vm.prank(facilitator);
        vm.expectRevert(PolypadSpendVault.InvalidSignature.selector);
        vault.spendWithAuthorization(
            key, address(token), payee, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1)), sig
        );
    }

    function testSpendExpiredAuthorizationReverts() public {
        address[] memory allow = new address[](0);
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        bytes memory sig = _sign(
            keyPk, key, address(token), payee, 5e6, block.timestamp, block.timestamp + 60, bytes32(uint256(1))
        );
        vm.warp(block.timestamp + 61);
        vm.prank(facilitator);
        vm.expectRevert(PolypadSpendVault.ExpiredAuthorization.selector);
        vault.spendWithAuthorization(
            key, address(token), payee, 5e6, block.timestamp - 61, block.timestamp - 1, bytes32(uint256(1)), sig
        );
    }

    function testSpendRevokedKeyReverts() public {
        address[] memory allow = new address[](0);
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        vm.prank(depositor);
        vault.revokeKey(key);
        bytes memory sig = _sign(
            keyPk, key, address(token), payee, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1))
        );
        vm.prank(facilitator);
        vm.expectRevert(PolypadSpendVault.KeyIsRevoked.selector);
        vault.spendWithAuthorization(
            key, address(token), payee, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1)), sig
        );
    }

    function testSpendPausedReverts() public {
        address[] memory allow = new address[](0);
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        vm.prank(owner);
        vault.pause();
        bytes memory sig = _sign(
            keyPk, key, address(token), payee, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1))
        );
        vm.prank(facilitator);
        vm.expectRevert(PolypadSpendVault.PausedSpend.selector);
        vault.spendWithAuthorization(
            key, address(token), payee, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1)), sig
        );
    }

    function testSpendNonFacilitatorReverts() public {
        address[] memory allow = new address[](0);
        _keyPolicy(10e6, 100e6, allow, uint64(block.timestamp + 1 days));
        bytes memory sig = _sign(
            keyPk, key, address(token), payee, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1))
        );
        vm.prank(depositor);
        vm.expectRevert(PolypadSpendVault.NotFacilitator.selector);
        vault.spendWithAuthorization(
            key, address(token), payee, 5e6, block.timestamp, block.timestamp + 120, bytes32(uint256(1)), sig
        );
    }

    function testOnlyOwnerSetsFacilitatorAndPauses() public {
        vm.prank(depositor);
        vm.expectRevert(PolypadSpendVault.NotOwner.selector);
        vault.setFacilitator(address(0xBEEF));
        vm.prank(depositor);
        vm.expectRevert(PolypadSpendVault.NotOwner.selector);
        vault.pause();
    }
}
