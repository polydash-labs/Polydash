// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundFactory} from "../../src/fund/FundFactory.sol";
import {FundAllowlistV2} from "../../src/fund/phase2v2/FundAllowlistV2.sol";
import {FundFactoryV2} from "../../src/fund/phase2v2/FundFactoryV2.sol";
import {FundNFTV2} from "../../src/fund/phase2v2/FundNFTV2.sol";
import {FundSwapFacetV2} from "../../src/fund/phase2v2/FundSwapFacetV2.sol";
import {FundV2Store} from "../../src/fund/phase2v2/FundV2Store.sol";
import {FundVaultV2} from "../../src/fund/phase2v2/FundVaultV2.sol";

/// @notice Fork coverage for Phase 2 v2. Nothing is broadcast.
///         Phase 1 and the deployed Phase 2 v1 factory are read, then checked again.
contract FundV2ForkTest is Test {
    address constant PHASE1 = 0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878;
    address constant PHASE2_V1 = 0x0849195DCBCD4a06265563dC3ebC4eb1a656aabe;
    address constant BUYBACK = 0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193;

    bool internal on;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
    }

    function test_fork_v2_refund_and_quote_nav_leave_live_factories() public {
        if (!on || block.chainid != 4663) return;
        bytes32 phase1Code = PHASE1.codehash;
        bytes32 v1Code = PHASE2_V1.codehash;
        assertGt(PHASE1.code.length, 0);
        assertGt(PHASE2_V1.code.length, 0);
        assertEq(FundFactory(PHASE1).PROTOCOL_FEE_BPS(), 20);

        (bool ok, bytes memory data) = BUYBACK.staticcall(abi.encodeWithSignature("weth()"));
        assertTrue(ok);
        address realWeth = abi.decode(data, (address));

        address[] memory routers = new address[](0);
        address[] memory assets = new address[](1);
        assets[0] = realWeth;
        FundAllowlistV2 allowlist = new FundAllowlistV2(address(this), 1 days, routers, assets);
        FundFactoryV2 factory =
            new FundFactoryV2(address(this), address(allowlist), realWeth, address(new FundSwapFacetV2()));

        address manager = makeAddr("manager");
        vm.deal(manager, 5 ether);
        address[] memory none = new address[](0);
        vm.prank(manager);
        FundNFTV2 nft = FundNFTV2(
            factory.createFund(
                FundFactoryV2.Params({
                    name: "Fork V2",
                    symbol: "FV2",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 0.1 ether,
                    raiseCap: 0.2 ether,
                    entryFeeBps: 500,
                    minSkinBps: 10_000,
                    raiseDuration: 1 days,
                    mandateHash: keccak256("fork-v2"),
                    assets: none
                })
            )
        );
        vm.prank(manager);
        nft.mint{value: 0.2 ether}(2);
        FundVaultV2 vault = nft.vault();
        assertEq(uint8(vault.status()), uint8(FundV2Store.Status.RaisingClosed));
        uint256 quote = vault.nav();
        vm.prank(manager);
        vault.enableInvesting();
        vm.prank(manager);
        vault.swap(address(0), address(0), realWeth, 0.05 ether, 0.05 ether, "");
        assertEq(IERC20(realWeth).balanceOf(address(vault)), 0.05 ether);
        assertEq(vault.nav(), quote);
        assertEq(vault.totalCostBasis(), 0);
        (uint256 indicated, bool live) = vault.indicatedQuote(realWeth, 0.05 ether);
        assertEq(indicated, 0);
        assertFalse(live);

        vm.prank(manager);
        vault.startWindDown();
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        uint256 before = manager.balance;
        vm.prank(manager);
        nft.redeem(ids);
        assertGt(manager.balance, before);
        assertEq(nft.outstanding(), 0);
        assertEq(PHASE1.codehash, phase1Code);
        assertEq(PHASE2_V1.codehash, v1Code);
        assertFalse(FundFactory(PHASE1).isFund(address(nft)));
    }
}
