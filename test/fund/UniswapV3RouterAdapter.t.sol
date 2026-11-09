// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../src/fund/phase2/FundFactoryInvest.sol";
import {FundSwapFacet} from "../../src/fund/phase2/FundSwapFacet.sol";
import {FundNFTInvest} from "../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../src/fund/phase2/FundVaultInvest.sol";
import {UniswapV3RouterAdapter} from "../../src/fund/phase2/UniswapV3RouterAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed, MockSwapRouter02, MockWETH} from "./InvestMocks.sol";

/// @notice SwapRouter02 has no `swap(address,address,uint256,uint256,bytes)` function, so the vault
///         cannot call it directly. This adapter translates the vault's narrow interface into
///         `exactInputSingle`. These tests prove the translation with a mock V3 router, and then
///         through a real vault end to end.
contract UniswapV3RouterAdapterTest is Test {
    MockWETH weth;
    MockERC20 alpha;
    MockSwapRouter02 v3;
    UniswapV3RouterAdapter adapter;

    address feeTo = makeAddr("fee");

    function setUp() public {
        weth = new MockWETH();
        alpha = new MockERC20("Alpha", "ALP", 0);
        v3 = new MockSwapRouter02(address(weth), 1e18, 1e18);
        adapter = new UniswapV3RouterAdapter(address(v3), address(weth));
        alpha.transfer(address(v3), 1_000_000 ether);
        weth.deposit{value: 1000 ether}();
        weth.transfer(address(v3), 1000 ether);
        vm.deal(address(this), 1000 ether);
    }

    function test_constructor_rejects_a_router_whose_weth9_differs() public {
        MockWETH other = new MockWETH();
        vm.expectRevert(UniswapV3RouterAdapter.BadPair.selector);
        new UniswapV3RouterAdapter(address(v3), address(other));
    }

    function test_eth_in_token_out_uses_the_default_3000_fee() public {
        uint256 before = alpha.balanceOf(address(this));
        uint256 out = adapter.swap{value: 1 ether}(address(0), address(alpha), 1 ether, 1 ether, "");
        assertEq(out, 1 ether);
        assertEq(v3.lastFee(), 3000);
        assertEq(alpha.balanceOf(address(this)), before + 1 ether);
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(alpha.balanceOf(address(adapter)), 0);
    }

    function test_fee_comes_from_data_when_given() public {
        uint256 before = alpha.balanceOf(address(this));
        adapter.swap{value: 0.5 ether}(address(0), address(alpha), 0.5 ether, 0.5 ether, abi.encode(uint24(500)));
        assertEq(v3.lastFee(), 500);
        assertEq(alpha.balanceOf(address(this)), before + 0.5 ether);
    }

    function test_token_in_eth_out_unwraps_and_pays_native_eth() public {
        alpha.transfer(address(adapter), 1 ether);
        uint256 before = address(this).balance;
        uint256 out = adapter.swap(address(alpha), address(0), 1 ether, 1 ether, "");
        assertEq(out, 1 ether);
        assertEq(address(this).balance, before + 1 ether);
        assertEq(weth.balanceOf(address(adapter)), 0);
    }

    function test_zero_fee_reverts() public {
        vm.expectRevert(UniswapV3RouterAdapter.BadFee.selector);
        adapter.swap{value: 1 ether}(address(0), address(alpha), 1 ether, 1 ether, abi.encode(uint24(0)));
    }

    function test_adapter_holds_nothing_after_a_round_trip() public {
        adapter.swap{value: 1 ether}(address(0), address(alpha), 1 ether, 1 ether, "");
        alpha.transfer(address(adapter), 1 ether);
        adapter.swap(address(alpha), address(0), 1 ether, 1 ether, "");
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(alpha.balanceOf(address(adapter)), 0);
    }

    function test_vault_swaps_through_the_adapter_end_to_end() public {
        address[] memory routers = new address[](1);
        routers[0] = address(adapter);
        MockFeed feed = new MockFeed();
        FundAllowlist.AssetInit[] memory assets = new FundAllowlist.AssetInit[](2);
        assets[0] = FundAllowlist.AssetInit(address(weth), true, address(0), 0, 0, 0);
        assets[1] = FundAllowlist.AssetInit(address(alpha), false, address(feed), 1 hours, 0.5 ether, 1.5 ether);
        FundAllowlist allowlist = new FundAllowlist(address(this), 2 days, routers, assets);
        FundFactoryInvest factory =
            new FundFactoryInvest(feeTo, address(allowlist), address(weth), address(new FundSwapFacet()));

        address manager = makeAddr("manager");
        vm.deal(manager, 100 ether);
        address[] memory universe = new address[](1);
        universe[0] = address(alpha);
        vm.prank(manager);
        FundNFTInvest nft = FundNFTInvest(
            factory.createFund(
                FundFactoryInvest.Params({
                    name: "Adapter Fund",
                    symbol: "AF",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 1 ether,
                    raiseCap: 2 ether,
                    entryFeeBps: 0,
                    minSkinBps: 10_000,
                    raiseDuration: 7 days,
                    mandateHash: keccak256("adapter"),
                    assets: universe,
                    mandateUri: "ipfs://adapter",
                    maxPositionBps: 0,
                    maxTradeBps: 0,
                    maxDeviationBps: 0
                })
            )
        );
        vm.prank(manager);
        nft.mint{value: 2 ether}(2);
        FundVaultInvest vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
        uint256 navBefore = vault.nav();

        // Buy 1 ETH of alpha through the adapter (default 0.3% fee tier in `data`).
        vm.prank(manager);
        vault.swap(address(adapter), address(0), address(alpha), 1 ether, 1 ether, abi.encode(uint24(3000)));
        assertEq(alpha.balanceOf(address(vault)), 1 ether);
        assertEq(vault.nav(), navBefore);
        assertEq(vault.tradeCount(), 1);
        assertEq(v3.lastFee(), 3000);

        // Sell it back for ETH.
        vm.prank(manager);
        vault.swap(address(adapter), address(alpha), address(0), 1 ether, 1 ether, abi.encode(uint24(3000)));
        assertEq(alpha.balanceOf(address(vault)), 0);
        assertEq(vault.nav(), navBefore);
        assertEq(vault.tradeCount(), 2);
    }

    receive() external payable {}
}
