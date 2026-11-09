// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../src/fund/phase2/FundFactoryInvest.sol";
import {FundFactoryPhase3} from "../../src/fund/phase3/FundFactoryPhase3.sol";
import {FundNFTPhase3} from "../../src/fund/phase3/FundNFTPhase3.sol";
import {FundSwapFacetPhase3} from "../../src/fund/phase3/FundSwapFacetPhase3.sol";
import {FundVaultPhase3} from "../../src/fund/phase3/FundVaultPhase3.sol";
import {StrategyTemplate} from "../../src/fund/phase3/StrategyTemplate.sol";

/// @notice Phase 3 on a fork of the live Phase 2 deployment. Nothing is broadcast.
///         The live factory, allowlist, facet, and adapter code hashes must be unchanged.
contract FundPhase3ForkTest is Test {
    address constant OWNER = 0x9a21c75aC263cC43125E70200636f6397f8776d0;
    address constant LIVE_FACTORY = 0xd3c6ae470c25989cC8d2876c1855fB570B98894E;
    address constant LIVE_ALLOW = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address constant LIVE_FACET = 0xA2620b14d1A39d4afbEAA4b87a7E7871050b50a0;
    address constant LIVE_ADAPTER = 0xA5187f8e56Dd0784624D833CEE3bF6f2Aa5E7581;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    bool on;
    bytes32 factoryCode;
    bytes32 allowCode;
    bytes32 facetCode;
    bytes32 adapterCode;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        if (block.chainid != 4663) return;
        on = true;
        factoryCode = LIVE_FACTORY.codehash;
        allowCode = LIVE_ALLOW.codehash;
        facetCode = LIVE_FACET.codehash;
        adapterCode = LIVE_ADAPTER.codehash;
    }

    function test_phase3_on_the_live_allowlist() public {
        if (!on) return;
        uint256 gasTemplate = gasleft();
        StrategyTemplate templates = new StrategyTemplate(OWNER);
        gasTemplate = gasTemplate - gasleft();
        uint256 gasFacet = gasleft();
        FundSwapFacetPhase3 facet = new FundSwapFacetPhase3();
        gasFacet = gasFacet - gasleft();
        uint256 gasFactory = gasleft();
        FundFactoryPhase3 phase3 = new FundFactoryPhase3(OWNER, LIVE_ALLOW, WETH, address(facet), address(templates));
        gasFactory = gasFactory - gasleft();
        console2.log("phase3 template gas", gasTemplate);
        console2.log("phase3 facet gas", gasFacet);
        console2.log("phase3 factory gas", gasFactory);

        assertEq(phase3.allowlist().quoteAsset(), WETH);
        assertEq(phase3.weth(), WETH);
        assertEq(FundAllowlist(LIVE_ALLOW).routerAllowed(LIVE_ADAPTER), true);
        assertEq(FundFactoryInvest(LIVE_FACTORY).allFundsLength(), 0);

        address[] memory noAssets = new address[](0);
        vm.prank(OWNER);
        uint256 id = templates.publish(
            keccak256("quote-only"), "ipfs://phase3-quote", noAssets, 7500, 7500, 5000, 1000, 2000, 1 days
        );

        address manager = makeAddr("p3manager");
        address buyer = makeAddr("p3buyer");
        vm.deal(manager, 5 ether);
        vm.deal(buyer, 5 ether);
        vm.prank(manager);
        FundNFTPhase3 nft = FundNFTPhase3(
            phase3.createFund(
                FundFactoryPhase3.Params({
                    templateId: id,
                    name: "Quote",
                    symbol: "QT",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 1 ether,
                    raiseCap: 2 ether,
                    entryFeeBps: 0,
                    minSkinBps: 5000,
                    raiseDuration: 7 days
                })
            )
        );
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(manager);
        vm.expectRevert(FundNFTPhase3.SkinLocked.selector);
        nft.transferFrom(manager, buyer, 1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        FundVaultPhase3 vault = nft.vault();
        assertEq(vault.templateId(), id);
        assertEq(vault.protocolFeeBps(), 20);
        assertEq(vault.claimableProtocolFee(), 0.004 ether);
        vm.prank(manager);
        vault.enableInvesting();

        uint256 before = address(vault).balance;
        vm.prank(manager);
        vault.swap(address(0), address(0), WETH, 0.2 ether, 0.2 ether, "");
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0.2 ether);
        vm.prank(manager);
        vault.swap(address(0), WETH, address(0), 0.2 ether, 0.2 ether, "");
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0);
        assertEq(address(vault).balance, before);

        vm.prank(manager);
        vault.distribute(0.2 ether);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        uint256 spendable = vault.spendableEth();
        uint256 managerBefore = manager.balance;
        vm.prank(manager);
        nft.exit(ids);
        assertEq(manager.balance - managerBefore, 0.1 ether + spendable / 2);
        assertEq(nft.balanceOf(manager), 0);
        assertEq(vault.distributionClaimed(1, 1), true);

        assertEq(LIVE_FACTORY.codehash, factoryCode);
        assertEq(LIVE_ALLOW.codehash, allowCode);
        assertEq(LIVE_FACET.codehash, facetCode);
        assertEq(LIVE_ADAPTER.codehash, adapterCode);
    }
}
