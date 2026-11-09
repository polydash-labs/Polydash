// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundFactory} from "../../src/fund/FundFactory.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../src/fund/phase2/FundFactoryInvest.sol";
import {FundSwapFacet} from "../../src/fund/phase2/FundSwapFacet.sol";
import {FundNFTInvest} from "../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../src/fund/phase2/FundVaultInvest.sol";
import {FundVaultStore} from "../../src/fund/phase2/FundVaultStore.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed, RateRouter} from "../fund/InvestMocks.sol";
import {ChainlinkNavFeed} from "../../src/fund/phase2/ChainlinkNavFeed.sol";

/// @notice Fork coverage for the Phase 2 invest path. Nothing is broadcast.
///         The live Phase 1a factory is read and then checked again so this test cannot rewrite it.
///         Run with FORK_RPC set. Without it, the test returns before any fork.
contract FundInvestForkTest is Test {
    address constant LIVE_FACTORY = 0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878;
    /// @dev Recorded from Uniswap's Robinhood Chain V3 deployment list. Not allowlisted. Not called.
    address constant SWAP_ROUTER02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    /// @dev Shared SVR proxies from the public Robinhood mainnet feed dataset. Not allowlisted. Secondary proxies are not read.
    address constant ETH_USD = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    address constant USDC_USD = 0x9e6f4605992a899eE2999999F3Ec80C41F452546;
    address constant USDT_USD = 0xbf3550B6fAe1671da7C238Af12e03Ac586BEf3B1;
    address constant WBTC_USD = 0x62107b0d3adA75fc1697fD342d99eed947a3aA5E;
    address constant BUYBACK = 0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193;
    address constant FEE_RECIPIENT = 0x9a21c75aC263cC43125E70200636f6397f8776d0;
    /// @dev Robinhood's contract page lists this as WETH. Not a feed. Not an allowlisted router target.
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant V2_ROUTER = 0x89e5DB8B5aA49aA85AC63f691524311AEB649eba;
    /// @dev Listed by Uniswap. Code is read below and the contract is not called.
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;

    bool internal on;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
    }

    function test_fork_invest_path_leaves_the_live_factory() public {
        if (!on) return;
        if (block.chainid != 4663) return;

        FundFactory live = FundFactory(LIVE_FACTORY);
        bytes32 codehash = LIVE_FACTORY.codehash;
        assertGt(LIVE_FACTORY.code.length, 0);
        assertEq(live.PROTOCOL_FEE_BPS(), 20);
        assertEq(live.feeRecipient(), FEE_RECIPIENT);

        (bool ok, bytes memory data) = BUYBACK.staticcall(abi.encodeWithSignature("weth()"));
        assertTrue(ok);
        address realWeth = abi.decode(data, (address));
        assertGt(realWeth.code.length, 0);

        MockERC20 alpha = new MockERC20("Alpha", "ALP", 0);
        MockERC20 beta = new MockERC20("Beta", "BET", 0);
        RateRouter router = new RateRouter(1e18, 1e18);
        alpha.transfer(address(router), 100 ether);
        vm.deal(address(router), 100 ether);

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        MockFeed feed = new MockFeed();
        FundAllowlist.AssetInit[] memory seeded = new FundAllowlist.AssetInit[](2);
        seeded[0] = FundAllowlist.AssetInit({
            asset: realWeth, quote: true, feed: address(0), maxStale: 0, minPriceX18: 0, maxPriceX18: 0
        });
        seeded[1] = FundAllowlist.AssetInit({
            asset: address(alpha),
            quote: false,
            feed: address(feed),
            maxStale: 1 hours,
            minPriceX18: 0.5 ether,
            maxPriceX18: 1.5 ether
        });
        FundAllowlist allowlist = new FundAllowlist(address(this), 1 days, routers, seeded);
        FundFactoryInvest factory =
            new FundFactoryInvest(FEE_RECIPIENT, address(allowlist), realWeth, address(new FundSwapFacet()));

        address manager = makeAddr("manager");
        vm.deal(manager, 10 ether);
        address[] memory universe = new address[](1);
        universe[0] = address(alpha);
        vm.prank(manager);
        FundNFTInvest nft = FundNFTInvest(
            factory.createFund(
                FundFactoryInvest.Params({
                    name: "Fork Fund",
                    symbol: "FF",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 0.1 ether,
                    raiseCap: 0.1 ether,
                    entryFeeBps: 0,
                    minSkinBps: 10_000,
                    raiseDuration: 1 hours,
                    mandateHash: keccak256("fork-mandate"),
                    assets: universe,
                    mandateUri: "ipfs://fork-mandate",
                    maxPositionBps: 0,
                    maxTradeBps: 0,
                    maxDeviationBps: 0
                })
            )
        );
        vm.prank(manager);
        nft.mint{value: 0.1 ether}(1);
        FundVaultInvest vault = nft.vault();
        assertEq(uint8(vault.status()), uint8(FundVaultStore.Status.RaisingClosed));
        vm.prank(manager);
        vault.enableInvesting();
        assertEq(uint8(vault.status()), uint8(FundVaultStore.Status.Investing));

        uint256 navBefore = vault.nav();
        vm.prank(manager);
        vault.swap(address(0), address(0), realWeth, 0.01 ether, 0.01 ether, "");
        assertEq(IERC20(realWeth).balanceOf(address(vault)), 0.01 ether);
        assertEq(vault.nav(), navBefore);

        vm.prank(manager);
        vault.swap(address(0), realWeth, address(0), 0.01 ether, 0.01 ether, "");
        assertEq(IERC20(realWeth).balanceOf(address(vault)), 0);
        assertEq(vault.nav(), navBefore);

        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 0.02 ether, 0.02 ether, "");
        assertEq(alpha.balanceOf(address(vault)), 0.02 ether);
        assertEq(vault.nav(), navBefore);
        assertEq(vault.tradeCount(), 3);
        assertEq(nft.navPerNft(), vault.navPerNft());

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotInMandate.selector);
        vault.swap(address(router), address(0), address(beta), 0.01 ether, 1, "");

        uint256 blocked = allowlist.propose(address(router), true, false);
        vm.expectRevert(FundAllowlist.Timelock.selector);
        allowlist.execute(blocked);

        assertEq(LIVE_FACTORY.codehash, codehash);
        assertEq(live.feeRecipient(), FEE_RECIPIENT);
        assertEq(factory.allFundsLength(), 1);
        assertFalse(live.isFund(address(nft)));
    }

    /// @notice Code size only. These addresses are not called and are not put on an allowlist.
    ///         QuoterV2 is on Uniswap's list and is not checked here; its code was not part of the size report.
    function test_fork_recorded_v3_venues_have_code() public view {
        if (!on) return;
        if (block.chainid != 4663) return;
        assertEq(SWAP_ROUTER02.code.length, 24_497);
        assertEq(UNIVERSAL_ROUTER.code.length, 24_546);
        assertEq(V3_FACTORY.code.length, 24_535);
        assertEq(QUOTER_V2.code.length, 8273);
        assertEq(_addr("WETH9()", SWAP_ROUTER02), WETH);
        assertEq(_addr("WETH()", V2_ROUTER), WETH);
    }

    /// @notice Robinhood lists this WETH. deposit, withdraw, and transfer move 1:1. Nothing is broadcast.
    function test_fork_weth_identity_and_one_for_one_flow() public {
        if (!on) return;
        if (block.chainid != 4663) return;
        (bool ok, bytes memory data) = BUYBACK.staticcall(abi.encodeWithSignature("weth()"));
        assertTrue(ok);
        assertEq(abi.decode(data, (address)), WETH);
        assertEq(_str("name()", WETH), "WETH");
        assertEq(_str("symbol()", WETH), "WETH");
        assertEq(_u8("decimals()", WETH), 18);
        assertGt(WETH.code.length, 0);
        address impl = address(
            uint160(
                uint256(
                    vm.load(WETH, bytes32(uint256(0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc)))
                )
            )
        );
        assertEq(impl, 0xC6B81b429797E0f555440b70cD99e032D7AE947e);
        assertGt(impl.code.length, 0);

        uint256 supply = IERC20(WETH).totalSupply();
        address holder = makeAddr("wethHolder");
        assertEq(IERC20(WETH).balanceOf(holder), 0);
        vm.deal(address(this), 1 ether);
        IWETH(WETH).deposit{value: 0.01 ether}();
        assertEq(IERC20(WETH).balanceOf(address(this)), 0.01 ether);
        assertEq(IERC20(WETH).totalSupply(), supply + 0.01 ether);
        assertTrue(IERC20(WETH).transfer(holder, 0.01 ether));
        assertEq(IERC20(WETH).balanceOf(holder), 0.01 ether);
        assertEq(IERC20(WETH).balanceOf(address(this)), 0);
        uint256 ethBefore = holder.balance;
        vm.prank(holder);
        IWETH(WETH).withdraw(0.01 ether);
        assertEq(holder.balance - ethBefore, 0.01 ether);
        assertEq(IERC20(WETH).balanceOf(holder), 0);
        assertEq(IERC20(WETH).totalSupply(), supply);
    }

    /// @notice A failed refund and a closed exit both read a zero WETH balance and still pay spendable ETH.
    function test_fork_refund_and_exit_with_no_weth() public {
        if (!on) return;
        if (block.chainid != 4663) return;
        address[] memory routers = new address[](0);
        FundAllowlist.AssetInit[] memory seeded = new FundAllowlist.AssetInit[](1);
        seeded[0] = FundAllowlist.AssetInit({
            asset: WETH, quote: true, feed: address(0), maxStale: 0, minPriceX18: 0, maxPriceX18: 0
        });
        FundAllowlist allowlist = new FundAllowlist(address(this), 1 days, routers, seeded);
        FundFactoryInvest factory =
            new FundFactoryInvest(FEE_RECIPIENT, address(allowlist), WETH, address(new FundSwapFacet()));
        address manager = makeAddr("wethManager");
        vm.deal(manager, 10 ether);

        FundNFTInvest missed = _bare(factory, manager, 2, 0.1 ether);
        vm.prank(manager);
        missed.mint{value: 0.1 ether}(1);
        assertEq(IERC20(WETH).balanceOf(address(missed.vault())), 0);
        vm.warp(missed.vault().raiseDeadline() + 1);
        missed.vault().failRaise();
        uint256 before = manager.balance;
        vm.prank(manager);
        missed.refund(_one(1));
        assertEq(manager.balance - before, 0.0998 ether);
        assertEq(IERC20(WETH).balanceOf(address(missed.vault())), 0);
        assertEq(address(missed.vault()).balance, 0.0002 ether);

        FundNFTInvest filled = _bare(factory, manager, 1, 0.1 ether);
        vm.prank(manager);
        filled.mint{value: 0.1 ether}(1);
        FundVaultInvest vault = filled.vault();
        assertEq(uint8(vault.status()), uint8(FundVaultStore.Status.RaisingClosed));
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0);
        before = manager.balance;
        vm.prank(manager);
        filled.exit(_one(1));
        assertEq(manager.balance - before, 0.0998 ether);
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0);
        assertEq(filled.outstanding(), 0);
    }

    function _bare(FundFactoryInvest factory, address manager, uint256 supply, uint256 price)
        internal
        returns (FundNFTInvest nft)
    {
        vm.prank(manager);
        nft = FundNFTInvest(
            factory.createFund(
                FundFactoryInvest.Params({
                    name: "WETH Check",
                    symbol: "WC",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: price,
                    raiseCap: price * supply,
                    entryFeeBps: 0,
                    minSkinBps: 10_000,
                    raiseDuration: 1 hours,
                    mandateHash: keccak256("weth-check"),
                    assets: new address[](0),
                    mandateUri: "ipfs://weth-check",
                    maxPositionBps: 0,
                    maxTradeBps: 0,
                    maxDeviationBps: 0
                })
            )
        );
    }

    function _one(uint256 id) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = id;
    }

    function _addr(string memory sig, address target) internal view returns (address) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSignature(sig));
        assertTrue(ok);
        return abi.decode(data, (address));
    }

    function _str(string memory sig, address target) internal view returns (string memory) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSignature(sig));
        assertTrue(ok);
        return abi.decode(data, (string));
    }

    function _u8(string memory sig, address target) internal view returns (uint8) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSignature(sig));
        assertTrue(ok);
        return abi.decode(data, (uint8));
    }

    /// @notice Read-only health of the four primary Shared SVR proxies. Does not allowlist them or compute a mandate NAV.
    function test_fork_primary_svr_proxies_answer() public {
        if (!on) return;
        if (block.chainid != 4663) return;
        _proxy(ETH_USD);
        _proxy(USDC_USD);
        _proxy(USDT_USD);
        _proxy(WBTC_USD);
        ChainlinkNavFeed feed = new ChainlinkNavFeed(ETH_USD, 18, ETH_USD, ETH_USD, false, address(0), 0);
        (uint256 one,) = feed.latestPrice(ETH_USD);
        assertEq(one, 1e18);
        vm.expectRevert(ChainlinkNavFeed.OutageGuardMissing.selector);
        new ChainlinkNavFeed(ETH_USD, 18, ETH_USD, ETH_USD, true, address(0), 1 hours);
    }

    function _proxy(address feed) internal view {
        assertEq(feed.code.length, 9571);
        (bool decOk, bytes memory decData) = feed.staticcall(abi.encodeWithSignature("decimals()"));
        assertTrue(decOk);
        assertEq(abi.decode(decData, (uint8)), 8);
        (bool ok, bytes memory data) = feed.staticcall(abi.encodeWithSignature("latestRoundData()"));
        assertTrue(ok);
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            abi.decode(data, (uint80, int256, uint256, uint256, uint80));
        assertGt(answer, 0);
        assertGt(updatedAt, 0);
        assertEq(answeredInRound, roundId);
    }
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
