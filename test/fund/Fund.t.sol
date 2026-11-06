// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {FundFactory} from "../../src/fund/FundFactory.sol";
import {FundNFT} from "../../src/fund/FundNFT.sol";
import {FundVault} from "../../src/fund/FundVault.sol";

contract RejectEth {
    receive() external payable {
        revert("no");
    }
}

/// @dev Manager that tries to withdraw entry fees twice from the payout callback.
contract ManagerAttacker is IERC721Receiver {
    FundNFT public nft;
    FundVault public vault;
    uint256 public calls;

    function create(FundFactory factory, FundFactory.Params calldata p) external returns (address fund) {
        fund = factory.createFund(p);
        nft = FundNFT(fund);
        vault = nft.vault();
    }

    function mintSkin() external {
        uint256 qty = nft.skinRequired();
        nft.mint{value: nft.mintPrice() * qty}(qty);
    }

    function withdraw() external {
        vault.withdrawEntryFee();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        if (calls == 0) {
            calls = 1;
            try vault.withdrawEntryFee() {
                revert("reentered");
            } catch {}
        }
    }
}

/// @dev Mints one NFT and tries to mint again from the receiver callback.
contract MintReentrant is IERC721Receiver {
    FundNFT public nft;
    bool public entered;
    uint256 public price;

    constructor(FundNFT _nft) {
        nft = _nft;
        price = _nft.mintPrice();
    }

    function mintOne() external {
        nft.mint{value: price}(1);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!entered) {
            entered = true;
            try nft.mint{value: price}(1) {
                revert("reentered");
            } catch {}
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract FundTest is Test {
    FundFactory factory;
    address manager = makeAddr("manager");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address feeTo = makeAddr("fee");

    function setUp() public {
        factory = new FundFactory(feeTo);
        vm.deal(manager, 1000 ether);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    function _params() internal pure returns (FundFactory.Params memory p) {
        p.name = "Example Fund";
        p.symbol = "EF";
        p.imageUri = "ipfs://image";
        p.baseURI = "ipfs://base/";
        p.mintPrice = 1 ether;
        p.raiseCap = 10 ether;
        p.entryFeeBps = 500;
        p.minSkinBps = 0;
    }

    function _create(FundFactory.Params memory p) internal returns (FundNFT nft) {
        vm.prank(manager);
        nft = FundNFT(factory.createFund(p));
    }

    function _create() internal returns (FundNFT nft) {
        nft = _create(_params());
    }

    function _mintSkin(FundNFT nft) internal {
        uint256 qty = nft.skinRequired();
        uint256 cost = nft.mintPrice() * qty;
        vm.prank(manager);
        nft.mint{value: cost}(qty);
    }

    function _fill(FundNFT nft) internal {
        _mintSkin(nft);
        uint256 left = nft.maxSupply() - nft.totalSupply();
        if (left > 0) {
            uint256 cost = nft.mintPrice() * left;
            vm.prank(alice);
            nft.mint{value: cost}(left);
        }
    }

    function test_create_indexes_supply_and_event() public {
        FundFactory.Params memory p = _params();
        vm.recordLogs();
        FundNFT nft = _create(p);
        FundVault vault = nft.vault();

        assertEq(nft.name(), "Example Fund");
        assertEq(nft.symbol(), "EF");
        assertEq(nft.manager(), manager);
        assertEq(vault.manager(), manager);
        assertEq(vault.payoutWallet(), manager);
        assertEq(nft.mintPrice(), 1 ether);
        assertEq(nft.maxSupply(), 10);
        assertEq(vault.maxSupply(), 10);
        assertEq(vault.raiseCap(), 10 ether);
        assertEq(nft.entryFeeBps(), 500);
        assertEq(nft.protocolFeeBps(), 20);
        assertEq(nft.minSkinBps(), 500);
        assertEq(nft.skinRequired(), 1);
        assertEq(uint8(vault.status()), uint8(FundVault.Status.Raising));
        assertFalse(nft.publicOpen());
        assertEq(nft.navPerNft(), 0);
        assertEq(nft.ownershipBps(manager), 0);
        assertTrue(factory.isFund(address(nft)));
        assertTrue(factory.isVault(address(vault)));
        assertEq(factory.allFundsLength(), 1);
        assertEq(factory.fundsByManager(manager)[0], address(nft));
        assertEq(factory.owner(), address(this));
        assertEq(factory.feeRecipient(), feeTo);
        assertEq(factory.PROTOCOL_FEE_BPS(), 20);
        assertEq(factory.MAX_ENTRY_FEE_BPS(), 500);

        bytes32 topic =
            keccak256("FundCreated(address,address,address,uint256,uint256,uint256,uint256,uint256,uint256)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != topic) continue;
            found = true;
            assertEq(address(uint160(uint256(logs[i].topics[1]))), address(nft));
            assertEq(address(uint160(uint256(logs[i].topics[2]))), address(vault));
            assertEq(address(uint160(uint256(logs[i].topics[3]))), manager);
        }
        assertTrue(found);
    }

    function test_preview_supply_dust() public view {
        (uint256 maxSupply, uint256 dust) = factory.previewSupply(10 ether + 123, 1 ether);
        assertEq(maxSupply, 10);
        assertEq(dust, 123);
    }

    function test_create_reverts_bad_params() public {
        FundFactory.Params memory p = _params();
        p.name = "";
        _expectInvalid(p);
        p = _params();
        p.name = new string(65);
        _expectInvalid(p);
        p = _params();
        p.symbol = "";
        _expectInvalid(p);
        p = _params();
        p.symbol = "ABCDEFGHIJKLMNOPQ";
        _expectInvalid(p);
        p = _params();
        p.imageUri = new string(513);
        _expectInvalid(p);
        p = _params();
        p.baseURI = new string(513);
        _expectInvalid(p);
        p = _params();
        p.mintPrice = 1;
        _expectInvalid(p);
        p = _params();
        p.mintPrice = 101 ether;
        _expectInvalid(p);
        p = _params();
        p.raiseCap = p.mintPrice - 1;
        _expectInvalid(p);
        p = _params();
        p.mintPrice = 0.000_01 ether;
        p.raiseCap = p.mintPrice * 10_001;
        _expectInvalid(p);
        p = _params();
        p.entryFeeBps = 501;
        _expectInvalid(p);
        p = _params();
        p.minSkinBps = 499;
        _expectInvalid(p);
        p = _params();
        p.minSkinBps = 10_001;
        _expectInvalid(p);

        vm.expectRevert(FundFactory.InvalidParams.selector);
        new FundFactory(address(0));
        vm.expectRevert(FundFactory.InvalidParams.selector);
        factory.previewSupply(1 ether, 0);
    }

    function test_skin_gate() public {
        FundFactory.Params memory p = _params();
        p.mintPrice = 0.01 ether;
        p.raiseCap = 1 ether; // 100 units, default skin is 5
        FundNFT nft = _create(p);
        assertEq(nft.maxSupply(), 100);
        assertEq(nft.skinRequired(), 5);
        assertFalse(nft.publicOpen());

        vm.prank(alice);
        vm.expectRevert(FundNFT.SkinRequired.selector);
        nft.mint{value: 0.01 ether}(1);

        vm.prank(manager);
        nft.mint{value: 0.04 ether}(4);
        assertEq(nft.managerMinted(), 4);
        assertFalse(nft.publicOpen());
        vm.prank(alice);
        vm.expectRevert(FundNFT.SkinRequired.selector);
        nft.mint{value: 0.01 ether}(1);

        vm.prank(manager);
        nft.mint{value: 0.01 ether}(1);
        assertTrue(nft.publicOpen());
        assertEq(nft.ownerOf(1), manager);
        assertEq(nft.ownerOf(5), manager);

        vm.prank(alice);
        nft.mint{value: 0.03 ether}(3);
        assertEq(nft.balanceOf(alice), 3);
        assertEq(nft.totalSupply(), 8);
        assertEq(uint8(nft.vault().status()), uint8(FundVault.Status.Raising));
    }

    function test_custom_skin_and_full_manager_mint() public {
        FundFactory.Params memory p = _params();
        p.minSkinBps = 2000;
        p.raiseCap = 10 ether;
        FundNFT nft = _create(p);
        assertEq(nft.skinRequired(), 2);
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        assertFalse(nft.publicOpen());
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        assertTrue(nft.publicOpen());

        FundFactory.Params memory all = _params();
        all.minSkinBps = 10_000;
        all.mintPrice = 0.1 ether;
        all.raiseCap = 1 ether; // 10 units, manager must mint all of them
        FundNFT closed = _create(all);
        assertEq(closed.skinRequired(), 10);
        vm.prank(manager);
        closed.mint{value: 1 ether}(10);
        assertTrue(closed.publicOpen());
        assertEq(uint8(closed.vault().status()), uint8(FundVault.Status.RaisingClosed));
        vm.prank(alice);
        vm.expectRevert(FundNFT.NotRaising.selector);
        closed.mint{value: 0.1 ether}(1);
    }

    function test_mint_fee_split_and_cap() public {
        FundNFT nft = _create();
        FundVault vault = nft.vault();
        uint256 managerBefore = manager.balance;

        _mintSkin(nft);
        assertEq(manager.balance, managerBefore - 1 ether);
        assertEq(address(nft).balance, 0);
        assertEq(address(vault).balance, 1 ether);
        assertEq(vault.raised(), 1 ether);
        assertEq(vault.claimableEntryFee(), 0.05 ether);
        assertEq(vault.claimableProtocolFee(), 0.002 ether);
        assertEq(vault.principal(), 0.948 ether);
        assertEq(nft.navPerNft(), 1 ether);
        assertTrue(nft.publicOpen());

        address sink = makeAddr("sink");
        vm.prank(manager);
        vault.setPayoutWallet(sink);
        vm.prank(manager);
        vault.withdrawEntryFee();
        assertEq(sink.balance, 0.05 ether);
        assertEq(vault.claimableEntryFee(), 0);

        address nextFee = makeAddr("next-fee");
        factory.setFeeRecipient(nextFee);
        vault.withdrawProtocolFee();
        assertEq(nextFee.balance, 0.002 ether);
        assertEq(feeTo.balance, 0);
        assertEq(address(vault).balance, vault.principal());

        vm.prank(alice);
        nft.mint{value: 9 ether}(9);
        assertEq(nft.totalSupply(), 10);
        assertEq(nft.maxSupply(), 10);
        assertEq(vault.raised(), 10 ether);
        assertEq(uint8(vault.status()), uint8(FundVault.Status.RaisingClosed));
        assertEq(nft.ownershipBps(manager), 1000);
        assertEq(nft.ownershipBps(alice), 9000);
        assertEq(nft.ownerOf(1), manager);
        assertEq(nft.ownerOf(2), alice);
        assertEq(nft.ownerOf(10), alice);

        vm.prank(alice);
        vm.expectRevert(FundNFT.NotRaising.selector);
        nft.mint{value: 1 ether}(1);

        uint256 locked = address(vault).balance;
        vm.prank(manager);
        vault.withdrawEntryFee();
        vault.withdrawProtocolFee();
        assertEq(address(vault).balance, vault.principal());
        assertGt(vault.principal(), 0);
        assertLt(address(vault).balance, locked);

        uint256 stuck = address(vault).balance;
        vm.prank(manager);
        vm.expectRevert(FundVault.NothingToWithdraw.selector);
        vault.withdrawEntryFee();
        vm.expectRevert(FundVault.NothingToWithdraw.selector);
        vault.withdrawProtocolFee();
        vm.prank(alice);
        vm.expectRevert(FundVault.NotManager.selector);
        vault.withdrawEntryFee();
        vm.expectRevert(FundVault.NotManager.selector);
        vault.withdrawEntryFee();

        (bool ok,) = address(vault).call(abi.encodeWithSignature("withdraw()"));
        (bool ok2,) = address(vault).call(abi.encodeWithSignature("withdrawPrincipal(address)", manager));
        (bool ok3,) = address(vault).call(abi.encodeWithSignature("rescue(address)", manager));
        assertFalse(ok);
        assertFalse(ok2);
        assertFalse(ok3);
        assertEq(address(vault).balance, stuck);
        assertEq(address(vault).balance, vault.principal());
    }

    function test_closes_on_max_supply_when_cap_has_dust() public {
        FundFactory.Params memory p = _params();
        p.raiseCap = 10 ether + 123;
        FundNFT nft = _create(p);
        assertEq(nft.maxSupply(), 10);
        _fill(nft);
        FundVault vault = nft.vault();
        assertEq(vault.raised(), 10 ether);
        assertLt(vault.raised(), vault.raiseCap());
        assertEq(nft.totalSupply(), 10);
        assertEq(uint8(vault.status()), uint8(FundVault.Status.RaisingClosed));
    }

    function test_entry_fee_zero_and_rounding() public {
        FundFactory.Params memory p = _params();
        p.entryFeeBps = 0;
        p.raiseCap = 2 ether;
        FundNFT nft = _create(p);
        _mintSkin(nft);
        FundVault vault = nft.vault();
        assertEq(vault.claimableEntryFee(), 0);
        assertEq(vault.claimableProtocolFee(), 0.002 ether);
        assertEq(vault.principal() + vault.claimableProtocolFee(), 1 ether);
        vm.prank(manager);
        vm.expectRevert(FundVault.NothingToWithdraw.selector);
        vault.withdrawEntryFee();

        FundFactory.Params memory odd = _params();
        odd.mintPrice = 0.000_01 ether + 1;
        odd.raiseCap = odd.mintPrice * 2;
        odd.entryFeeBps = 1;
        FundNFT oddNft = _create(odd);
        _mintSkin(oddNft);
        FundVault oddVault = oddNft.vault();
        uint256 paid = odd.mintPrice;
        assertEq(oddVault.principal() + oddVault.claimableEntryFee() + oddVault.claimableProtocolFee(), paid);
        assertEq(oddVault.claimableEntryFee(), (paid * 1) / 10_000);
        assertEq(oddVault.claimableProtocolFee(), (paid * 20) / 10_000);
    }

    function test_rejecting_payout_and_fee_recipient() public {
        FundNFT nft = _create();
        _mintSkin(nft);
        FundVault vault = nft.vault();
        RejectEth sink = new RejectEth();
        vm.prank(manager);
        vault.setPayoutWallet(address(sink));
        vm.prank(manager);
        vm.expectRevert(FundVault.TransferFailed.selector);
        vault.withdrawEntryFee();
        assertEq(vault.claimableEntryFee(), 0.05 ether);
        vm.prank(alice);
        vm.expectRevert(FundVault.NotManager.selector);
        vault.setPayoutWallet(alice);
        vm.prank(manager);
        vm.expectRevert(FundVault.ZeroAddress.selector);
        vault.setPayoutWallet(address(0));
        vm.prank(manager);
        vault.setPayoutWallet(manager);
        vm.prank(manager);
        vault.withdrawEntryFee();
        assertEq(vault.claimableEntryFee(), 0);

        factory.setFeeRecipient(address(sink));
        vm.prank(alice);
        nft.mint{value: 1 ether}(1);
        vm.expectRevert(FundVault.TransferFailed.selector);
        vault.withdrawProtocolFee();
        assertGt(vault.claimableProtocolFee(), 0);
        factory.setFeeRecipient(feeTo);
        vault.withdrawProtocolFee();
        assertEq(vault.claimableProtocolFee(), 0);
        assertEq(feeTo.balance, 0.004 ether);
    }

    function test_payment_and_quantity_reverts() public {
        FundNFT nft = _create();
        vm.prank(manager);
        vm.expectRevert(FundNFT.BadQuantity.selector);
        nft.mint{value: 0}(0);
        vm.prank(manager);
        vm.expectRevert(FundNFT.BadValue.selector);
        nft.mint{value: 1 ether - 1}(1);
        vm.prank(manager);
        vm.expectRevert(FundNFT.BadValue.selector);
        nft.mint{value: 1 ether + 1}(1);
        vm.prank(manager);
        vm.expectRevert(FundNFT.SoldOut.selector);
        nft.mint{value: 11 ether}(11);
    }

    function test_cannot_drain_or_deposit_outside_mint() public {
        FundNFT nft = _create();
        FundVault vault = nft.vault();
        uint256 before = address(vault).balance;
        (bool sent,) = address(vault).call{value: 1 ether}("");
        assertFalse(sent);
        assertEq(address(vault).balance, before);

        vm.prank(alice);
        vm.expectRevert(FundVault.NotNft.selector);
        vault.deposit{value: 1 ether}(0, 0);
        vm.prank(alice);
        vm.expectRevert(FundVault.NotFactory.selector);
        vault.bind(address(0x123));
        vm.prank(address(factory));
        vm.expectRevert(FundVault.AlreadyBound.selector);
        vault.bind(address(0x123));

        vm.deal(address(nft), 1 ether);
        vm.prank(address(nft));
        vm.expectRevert(FundVault.BadValue.selector);
        vault.deposit{value: 1 ether}(0, 0);

        _fill(nft);
        assertEq(uint8(vault.status()), uint8(FundVault.Status.RaisingClosed));
        vm.deal(address(nft), 1 ether);
        vm.prank(address(nft));
        vm.expectRevert(FundVault.NotRaising.selector);
        vault.deposit{value: 1 ether}((1 ether * 500) / 10_000, (1 ether * 20) / 10_000);

        uint256 principal = vault.principal();
        if (vault.claimableEntryFee() > 0) {
            vm.prank(manager);
            vault.withdrawEntryFee();
        }
        if (vault.claimableProtocolFee() > 0) vault.withdrawProtocolFee();
        assertEq(address(vault).balance, principal);

        vm.deal(address(vault), principal + 1 ether);
        assertEq(address(vault).balance, principal + 1 ether);
        assertEq(nft.navPerNft(), (principal + 1 ether) / nft.totalSupply());
        vm.prank(manager);
        vm.expectRevert(FundVault.NothingToWithdraw.selector);
        vault.withdrawEntryFee();
        vm.expectRevert(FundVault.NothingToWithdraw.selector);
        vault.withdrawProtocolFee();
        assertEq(address(vault).balance, principal + 1 ether);
        assertEq(vault.principal(), principal);
    }

    function test_ownership_transfer_and_metadata() public {
        FundFactory.Params memory p = _params();
        p.baseURI = "";
        FundNFT nft = _create(p);
        vm.prank(manager);
        nft.setBaseURI("ipfs://new/");
        assertEq(nft.baseURI(), "ipfs://new/");
        vm.prank(manager);
        vm.expectRevert(FundNFT.InvalidParams.selector);
        nft.setBaseURI(new string(513));
        _mintSkin(nft);
        assertEq(nft.tokenURI(1), "ipfs://new/1.json");
        vm.prank(manager);
        vm.expectRevert(FundNFT.Frozen.selector);
        nft.setBaseURI("ipfs://nope/");
        vm.prank(alice);
        vm.expectRevert(FundNFT.NotManager.selector);
        nft.setBaseURI("ipfs://nope/");

        vm.prank(alice);
        nft.mint{value: 1 ether}(1);
        assertEq(nft.ownershipBps(manager), 5000);
        assertEq(nft.ownershipBps(alice), 5000);
        uint256 nav = nft.navPerNft();
        vm.prank(alice);
        nft.transferFrom(alice, bob, 2);
        assertEq(nft.ownerOf(2), bob);
        assertEq(nft.ownershipBps(alice), 0);
        assertEq(nft.ownershipBps(bob), 5000);
        assertEq(nft.navPerNft(), nav);

        FundFactory.Params memory imageOnly = _params();
        imageOnly.baseURI = "";
        imageOnly.raiseCap = 2 ether;
        FundNFT plain = _create(imageOnly);
        _mintSkin(plain);
        assertEq(plain.tokenURI(1), "ipfs://image");

        address next = makeAddr("owner");
        vm.expectRevert(FundFactory.InvalidParams.selector);
        factory.transferOwnership(address(0));
        factory.transferOwnership(next);
        vm.prank(alice);
        vm.expectRevert(FundFactory.NotOwner.selector);
        factory.acceptOwnership();
        vm.prank(alice);
        vm.expectRevert(FundFactory.NotOwner.selector);
        factory.setFeeRecipient(alice);
        vm.prank(next);
        factory.acceptOwnership();
        assertEq(factory.owner(), next);
        vm.expectRevert(FundFactory.NotOwner.selector);
        factory.setFeeRecipient(alice);
        vm.prank(next);
        vm.expectRevert(FundFactory.InvalidParams.selector);
        factory.setFeeRecipient(address(0));
        vm.prank(next);
        factory.setFeeRecipient(feeTo);
        assertGt(nft.vault().principal(), 0);
        assertEq(factory.feeRecipient(), feeTo);
    }

    function test_two_funds_are_isolated() public {
        FundNFT a = _create();
        vm.prank(bob);
        FundNFT b = FundNFT(factory.createFund(_params()));
        assertEq(factory.allFundsLength(), 2);
        assertEq(factory.fundsByManager(manager).length, 1);
        assertEq(factory.fundsByManager(bob)[0], address(b));
        assertTrue(address(a.vault()) != address(b.vault()));
        _mintSkin(a);
        assertEq(a.totalSupply(), 1);
        assertEq(b.totalSupply(), 0);
        assertEq(address(b.vault()).balance, 0);
        assertEq(b.manager(), bob);
        assertFalse(b.publicOpen());
    }

    function test_reenter_mint_and_withdraw() public {
        FundNFT nft = _create();
        _mintSkin(nft);
        MintReentrant re = new MintReentrant(nft);
        vm.deal(address(re), nft.mintPrice() * 2);
        uint256 supplyBefore = nft.totalSupply();
        re.mintOne();
        assertTrue(re.entered());
        assertEq(nft.balanceOf(address(re)), 1);
        assertEq(nft.totalSupply(), supplyBefore + 1);
        assertEq(address(re).balance, nft.mintPrice());

        ManagerAttacker attacker = new ManagerAttacker();
        vm.deal(address(attacker), 10 ether);
        FundFactory.Params memory p = _params();
        attacker.create(factory, p);
        attacker.mintSkin();
        uint256 fee = attacker.vault().claimableEntryFee();
        uint256 principal = attacker.vault().principal();
        attacker.withdraw();
        assertEq(attacker.calls(), 1);
        assertEq(address(attacker).balance, 10 ether - attacker.nft().mintPrice() + fee);
        assertEq(attacker.vault().claimableEntryFee(), 0);
        assertEq(attacker.vault().principal(), principal);
        assertGe(address(attacker.vault()).balance, principal);
    }

    function testFuzz_conservation(uint96 priceRaw, uint16 entryRaw, uint8 supplyRaw) public {
        uint256 price = bound(priceRaw, 0.000_01 ether, 1 ether);
        uint256 entryBps = bound(entryRaw, 0, 500);
        uint256 supply = bound(supplyRaw, 1, 5);
        FundFactory.Params memory p = _params();
        p.mintPrice = price;
        p.raiseCap = price * supply;
        p.entryFeeBps = entryBps;
        FundNFT nft = _create(p);
        uint256 skin = nft.skinRequired();
        _mintSkin(nft);
        if (supply > skin) {
            vm.prank(alice);
            nft.mint{value: price * (supply - skin)}(supply - skin);
        }
        FundVault vault = nft.vault();
        assertEq(uint8(vault.status()), uint8(FundVault.Status.RaisingClosed));
        assertEq(nft.totalSupply(), supply);
        assertEq(vault.raised(), price * supply);
        assertEq(vault.principal() + vault.claimableEntryFee() + vault.claimableProtocolFee(), vault.raised());
        assertEq(address(vault).balance, vault.raised());
        assertEq(nft.navPerNft(), address(vault).balance / supply);
        assertEq(nft.ownershipBps(manager), (skin * 10_000) / supply);
        assertEq(nft.ownershipBps(alice), ((supply - skin) * 10_000) / supply);

        uint256 entry = vault.claimableEntryFee();
        uint256 protocol = vault.claimableProtocolFee();
        uint256 principal = vault.principal();
        if (entry > 0) {
            uint256 before = manager.balance;
            vm.prank(manager);
            vault.withdrawEntryFee();
            assertEq(manager.balance, before + entry);
        }
        if (protocol > 0) {
            uint256 before = feeTo.balance;
            vault.withdrawProtocolFee();
            assertEq(feeTo.balance, before + protocol);
        }
        assertEq(address(vault).balance, principal);
        vm.prank(alice);
        vm.expectRevert(FundNFT.NotRaising.selector);
        nft.mint{value: price}(1);
    }

    function _expectInvalid(FundFactory.Params memory p) internal {
        vm.prank(manager);
        vm.expectRevert(FundFactory.InvalidParams.selector);
        factory.createFund(p);
    }
}
