// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolypadGatedNFTFactory} from "../../src/gatedmint/PolypadGatedNFTFactory.sol";
import {PolypadGatedCollection} from "../../src/gatedmint/PolypadGatedCollection.sol";
import {MockERC20} from "../mocks/CreatorMocks.sol";

contract GLaunch {
    address public creator;
    address public token;

    constructor(address c, address t) {
        creator = c;
        token = t;
    }
}

contract GLaunchFactory {
    mapping(address => address) public launchOfToken;
    mapping(address => bool) public isLaunch;

    function set(address t, address l) external {
        launchOfToken[t] = l;
        isLaunch[l] = true;
    }
}

contract GFeeSource {
    address public platformFeeWallet = address(0xFEE);
}

contract FlashMinter {
    function go(PolypadGatedCollection c) external {
        c.holderMint{value: c.holderPrice()}(1);
    }
    receive() external payable {}
}

contract Rejecter {
    receive() external payable {
        revert();
    }
}

contract GatedMintTest is Test {
    PolypadGatedNFTFactory f;
    GLaunchFactory lfA;
    GLaunchFactory lfB;
    MockERC20 tok;
    MockERC20 tokB;
    MockERC20 rando;
    address creator = address(0xC0);
    address alice = address(0xA1);
    address bob = address(0xB0);
    uint256 constant MINB = 1000e18;

    function setUp() public {
        vm.warp(1_000_000);
        lfA = new GLaunchFactory();
        lfB = new GLaunchFactory();
        tok = new MockERC20("TOK");
        tokB = new MockERC20("TKB");
        rando = new MockERC20("RND");
        lfA.set(address(tok), address(new GLaunch(creator, address(tok))));
        lfB.set(address(tokB), address(new GLaunch(creator, address(tokB))));
        f = new PolypadGatedNFTFactory(address(lfA), address(lfB), address(new GFeeSource()));
        tok.mint(alice, 5000e18);
        tok.mint(bob, 500e18);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _p(address gate) internal pure returns (PolypadGatedNFTFactory.Params memory p) {
        p.name = "Gated";
        p.symbol = "GTD";
        p.baseURI = "ipfs://x/";
        p.maxSupply = 10;
        p.holderPrice = 0.001 ether;
        p.publicPrice = 0.002 ether;
        p.floorBps = 5000;
        p.royaltyBps = 500;
        p.holderMaxPerWallet = 2;
        p.maxPerWallet = 3;
        p.gateToken = gate;
        p.minBalance = MINB;
        p.holderDuration = 1 days;
    }

    function _make() internal returns (PolypadGatedCollection c) {
        vm.prank(creator);
        c = PolypadGatedCollection(f.createCollection(_p(address(tok))));
    }

    function _hMint(PolypadGatedCollection c, address u, uint256 q) internal {
        uint256 v = q * c.holderPrice();
        vm.prank(u, u);
        c.holderMint{value: v}(q);
    }

    // ---------------- factory
    function test_rejectsNonLaunchToken() public {
        vm.prank(creator);
        vm.expectRevert(PolypadGatedNFTFactory.NotPolydashToken.selector);
        f.createCollection(_p(address(rando)));
    }

    function test_acceptsFactoryBToken() public {
        vm.prank(creator);
        address c = f.createCollection(_p(address(tokB)));
        assertTrue(f.isCollection(c));
        assertEq(f.collectionsOfToken(address(tokB)).length, 1);
        assertEq(f.collectionsOf(creator).length, 1);
    }

    function test_onlyLaunchCreator() public {
        vm.prank(alice);
        vm.expectRevert(PolypadGatedNFTFactory.NotTokenCreator.selector);
        f.createCollection(_p(address(tok)));
    }

    function test_launchTokenMismatch() public {
        // factory maps token -> launch whose token() differs
        lfA.set(address(rando), address(new GLaunch(creator, address(tok))));
        vm.prank(creator);
        vm.expectRevert(PolypadGatedNFTFactory.NotPolydashToken.selector);
        f.createCollection(_p(address(rando)));
    }

    function test_paramChecks() public {
        vm.startPrank(creator);
        PolypadGatedNFTFactory.Params memory p = _p(address(tok));
        p.publicPrice = 0.0005 ether;
        vm.expectRevert(abi.encodeWithSelector(PolypadGatedNFTFactory.InvalidParam.selector, "publicPrice"));
        f.createCollection(p);
        p = _p(address(tok));
        p.holderMaxPerWallet = 4;
        vm.expectRevert(abi.encodeWithSelector(PolypadGatedNFTFactory.InvalidParam.selector, "holderMaxPerWallet"));
        f.createCollection(p);
        p = _p(address(tok));
        p.minBalance = 0;
        vm.expectRevert(abi.encodeWithSelector(PolypadGatedNFTFactory.InvalidParam.selector, "minBalance"));
        f.createCollection(p);
        p = _p(address(tok));
        p.holderDuration = 10 minutes;
        vm.expectRevert(abi.encodeWithSelector(PolypadGatedNFTFactory.InvalidParam.selector, "holderDuration"));
        f.createCollection(p);
        p = _p(address(tok));
        p.holderStart = uint64(block.timestamp - 1);
        vm.expectRevert(abi.encodeWithSelector(PolypadGatedNFTFactory.InvalidParam.selector, "holderStart"));
        f.createCollection(p);
        vm.stopPrank();
    }

    // ---------------- holder phase
    function test_holderMint() public {
        PolypadGatedCollection c = _make();
        _hMint(c, alice, 2);
        assertEq(c.balanceOf(alice), 2);
        assertEq(c.holderMinted(alice), 2);
        assertEq(tok.balanceOf(alice), 5000e18); // tokens untouched
        assertEq(address(c).balance, 0.002 ether);
    }

    function test_belowMinBalance_reverts() public {
        PolypadGatedCollection c = _make();
        vm.prank(bob, bob);
        vm.expectRevert(PolypadGatedCollection.NotHolder.selector);
        c.holderMint{value: 0.001 ether}(1);
    }

    function test_exactMinBalance_ok() public {
        PolypadGatedCollection c = _make();
        tok.mint(bob, 500e18); // 1,000 total
        _hMint(c, bob, 1);
        assertEq(c.balanceOf(bob), 1);
    }

    function test_contractCaller_blocked() public {
        PolypadGatedCollection c = _make();
        FlashMinter fm = new FlashMinter();
        tok.mint(address(fm), MINB);
        vm.deal(address(fm), 1 ether);
        vm.prank(alice, alice);
        vm.expectRevert(PolypadGatedCollection.NotEOA.selector);
        fm.go(c);
    }

    function test_holderCap() public {
        PolypadGatedCollection c = _make();
        _hMint(c, alice, 2);
        vm.prank(alice, alice);
        vm.expectRevert(PolypadGatedCollection.WalletLimit.selector);
        c.holderMint{value: 0.001 ether}(1);
    }

    function test_holderCap_survivesTransfers() public {
        // Moving tokens out and back does not reset the per-wallet holder count.
        PolypadGatedCollection c = _make();
        _hMint(c, alice, 2);
        vm.prank(alice);
        tok.transfer(bob, 5000e18);
        vm.prank(bob);
        tok.transfer(alice, 5000e18);
        vm.prank(alice, alice);
        vm.expectRevert(PolypadGatedCollection.WalletLimit.selector);
        c.holderMint{value: 0.001 ether}(1);
    }

    function test_walletHopping_documentedLimit() public {
        // Known limit of a balance check: tokens moved to a fresh wallet qualify it too (bounded by caps).
        PolypadGatedCollection c = _make();
        _hMint(c, alice, 2);
        vm.prank(alice);
        tok.transfer(bob, MINB);
        _hMint(c, bob, 2);
        assertEq(c.balanceOf(bob), 2);
    }

    function test_notStarted() public {
        PolypadGatedNFTFactory.Params memory p = _p(address(tok));
        p.holderStart = uint64(block.timestamp + 1 hours);
        vm.prank(creator);
        PolypadGatedCollection c = PolypadGatedCollection(f.createCollection(p));
        assertEq(c.phase(), 0);
        vm.prank(alice, alice);
        vm.expectRevert(PolypadGatedCollection.NotHolderPhase.selector);
        c.holderMint{value: 0.001 ether}(1);
    }

    // ---------------- public phase
    function test_publicPhase() public {
        PolypadGatedCollection c = _make();
        _hMint(c, alice, 2);
        vm.prank(bob);
        vm.expectRevert(PolypadGatedCollection.NotPublicPhase.selector);
        c.mint{value: 0.002 ether}(1);
        vm.warp(c.publicStart());
        assertEq(c.phase(), 2);
        vm.prank(bob);
        c.mint{value: 0.002 ether}(1);
        vm.prank(alice);
        c.mint{value: 0.002 ether}(1);
        vm.prank(alice);
        vm.expectRevert(PolypadGatedCollection.WalletLimit.selector);
        c.mint{value: 0.002 ether}(1);
        vm.prank(alice, alice);
        vm.expectRevert(PolypadGatedCollection.NotHolderPhase.selector);
        c.holderMint{value: 0.001 ether}(1);
    }

    function test_holderOnly_noPublic() public {
        PolypadGatedNFTFactory.Params memory p = _p(address(tok));
        p.publicPrice = 0;
        vm.prank(creator);
        PolypadGatedCollection c = PolypadGatedCollection(f.createCollection(p));
        vm.warp(c.publicStart());
        assertEq(c.phase(), 3);
        vm.prank(bob);
        vm.expectRevert(PolypadGatedCollection.NotPublicPhase.selector);
        c.mint{value: 0}(1);
    }

    function test_soldOut() public {
        PolypadGatedNFTFactory.Params memory p = _p(address(tok));
        p.maxSupply = 3;
        p.maxPerWallet = 3;
        p.holderMaxPerWallet = 2;
        vm.prank(creator);
        PolypadGatedCollection c = PolypadGatedCollection(f.createCollection(p));
        _hMint(c, alice, 2);
        vm.warp(c.publicStart());
        vm.prank(bob);
        c.mint{value: 0.002 ether}(1);
        vm.prank(bob);
        vm.expectRevert(PolypadGatedCollection.SoldOut.selector);
        c.mint{value: 0.002 ether}(1);
    }

    // ---------------- ungated option
    function _ungated() internal view returns (PolypadGatedNFTFactory.Params memory p) {
        p = _p(address(tok));
        p.holderDuration = 0;
        p.holderPrice = 0;
        p.minBalance = 0;
        p.holderMaxPerWallet = 0;
    }

    function test_ungated_openMintNow() public {
        vm.prank(creator);
        PolypadGatedCollection c = PolypadGatedCollection(f.createCollection(_ungated()));
        assertFalse(c.gated());
        assertEq(c.phase(), 2);
        assertEq(c.floorPerToken(), 0.001 ether);
        vm.prank(bob); // bob holds < min, irrelevant
        c.mint{value: 0.002 ether}(1);
        assertEq(c.balanceOf(bob), 1);
        vm.prank(alice, alice);
        vm.expectRevert(PolypadGatedCollection.NotHolderPhase.selector);
        c.holderMint{value: 0}(1);
        assertFalse(c.isHolder(alice));
        assertEq(address(c).balance, c.floorReserve() + c.creatorBalance() + c.platformBalance());
    }

    function test_ungated_scheduledStart() public {
        PolypadGatedNFTFactory.Params memory p = _ungated();
        p.holderStart = uint64(block.timestamp + 1 hours);
        vm.prank(creator);
        PolypadGatedCollection c = PolypadGatedCollection(f.createCollection(p));
        vm.prank(bob);
        vm.expectRevert(PolypadGatedCollection.NotPublicPhase.selector);
        c.mint{value: 0.002 ether}(1);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(bob);
        c.mint{value: 0.002 ether}(1);
    }

    function test_ungated_paramChecks() public {
        vm.startPrank(creator);
        PolypadGatedNFTFactory.Params memory p = _ungated();
        p.minBalance = 1;
        vm.expectRevert(abi.encodeWithSelector(PolypadGatedNFTFactory.InvalidParam.selector, "ungated"));
        f.createCollection(p);
        p = _ungated();
        p.publicPrice = 0;
        vm.expectRevert(abi.encodeWithSelector(PolypadGatedNFTFactory.InvalidParam.selector, "publicPrice"));
        f.createCollection(p);
        vm.stopPrank();
    }

    function test_ungated_stillCreatorOnly() public {
        vm.prank(alice);
        vm.expectRevert(PolypadGatedNFTFactory.NotTokenCreator.selector);
        f.createCollection(_ungated());
    }

    function test_gatedFlagTrue() public {
        assertTrue(_make().gated());
    }

    // ---------------- money
    function test_accounting_floorAndPayouts() public {
        PolypadGatedCollection c = _make();
        _hMint(c, alice, 2); // 2 x 0.001
        vm.warp(c.publicStart());
        vm.prank(bob);
        c.mint{value: 0.002 ether}(1);
        uint256 floor = c.floorPerToken();
        assertEq(floor, 0.0005 ether);
        uint256 fees = 2 * (0.001 ether * 20 / 10_000) + (0.002 ether * 20 / 10_000);
        assertEq(c.platformBalance(), fees);
        assertEq(c.creatorBalance() + c.platformBalance() + 3 * floor, 0.004 ether);
        c.withdrawCreator();
        c.withdrawPlatform();
        assertEq(address(0xFEE).balance, fees);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 3;
        uint256 b0 = bob.balance;
        vm.prank(bob);
        c.redeem(ids);
        assertEq(bob.balance - b0, floor);
        assertEq(address(c).balance, 2 * floor);
    }

    function test_redeemNotOwner() public {
        PolypadGatedCollection c = _make();
        _hMint(c, alice, 1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(bob);
        vm.expectRevert(PolypadGatedCollection.NotOwner.selector);
        c.redeem(ids);
    }

    function test_badValue() public {
        PolypadGatedCollection c = _make();
        vm.prank(alice, alice);
        vm.expectRevert(PolypadGatedCollection.BadValue.selector);
        c.holderMint{value: 0.0011 ether}(1);
    }

    function test_metadataFrozenAfterFirstMint() public {
        PolypadGatedCollection c = _make();
        vm.prank(creator);
        c.setBaseURI("ipfs://y/");
        _hMint(c, alice, 1);
        vm.prank(creator);
        vm.expectRevert(PolypadGatedCollection.Frozen.selector);
        c.setBaseURI("ipfs://z/");
        assertEq(bytes(c.tokenURI(1)).length > 0, true);
    }

    function test_payoutRejecter_doesNotBlockMint() public {
        Rejecter r = new Rejecter();
        PolypadGatedNFTFactory.Params memory p = _p(address(tok));
        p.payoutWallet = address(r);
        vm.prank(creator);
        PolypadGatedCollection c = PolypadGatedCollection(f.createCollection(p));
        _hMint(c, alice, 1);
        vm.expectRevert(PolypadGatedCollection.TransferFailed.selector);
        c.withdrawCreator();
        assertEq(c.balanceOf(alice), 1);
    }

    // ---------------- fuzz: ETH in == floor reserve + creator + platform
    function testFuzz_conservation(uint8 h, uint8 pub) public {
        h = uint8(bound(h, 1, 2));
        pub = uint8(bound(pub, 0, 1));
        PolypadGatedCollection c = _make();
        _hMint(c, alice, h);
        vm.warp(c.publicStart());
        if (pub > 0) {
            vm.prank(bob);
            c.mint{value: pub * 0.002 ether}(pub);
        }
        assertEq(address(c).balance, c.floorReserve() + c.creatorBalance() + c.platformBalance());
    }
}
